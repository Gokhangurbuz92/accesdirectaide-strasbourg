import crypto from 'node:crypto';
import { db } from '../../../src/db/index.js';
import { StructureRdvSettings, Structure } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { AUTH_ROLE, logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { getProRdvReadiness } from '../../_utils/pro-rdv-readiness.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { flagsOf, requestGuestSchema, settingsTable } from '../../_utils/schema-features.js';

const BOOKING_MODES = new Set(['IN_PERSON', 'VIDEO', 'BOTH']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeOptionalString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeBookingMode(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toUpperCase();
  return BOOKING_MODES.has(mode) ? mode : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeEmail(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  return EMAIL_RE.test(lower) ? lower : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePhone(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, '');
  const safe = compact.replace(/[^\d+().-]/g, '');
  if (!safe) return null;
  return safe.slice(0, 32);
}

/**
 * @param {any} row
 */
function serialize(row) {
  return {
    id: row.id,
    structureId: row.structureId,
    structure_id: row.structureId,
    isPublished: row.isPublished,
    is_published: row.isPublished,
    bookingMode: row.bookingMode,
    booking_mode: row.bookingMode,
    contactEmail: row.contactEmail || null,
    contact_email: row.contactEmail || null,
    contactPhone: row.contactPhone || null,
    contact_phone: row.contactPhone || null,
    publishedAt: row.publishedAt || null,
    published_at: row.publishedAt || null,
    // R38: account-free (« sans compte ») booking, opted in by an administrator of the structure (default off)
    allowGuestBooking: Boolean(row.allowGuestBooking),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * @param {string} structureId
 */
async function getOrCreateSettings(structureId) {
  // R41-B: before migration 0043 (Production 0042) the table has no allowGuestBooking column: it is never named (select, insert, returning)
  const T = settingsTable(await requestGuestSchema(db));
  let settings = await db.query.StructureRdvSettings.findFirst({
    columns: flagsOf(T),
    where: eq(StructureRdvSettings.structureId, structureId),
  });

  if (settings) return settings;

  const structure = await db.query.Structure.findFirst({
    where: eq(Structure.id, structureId),
    columns: { id: true, is_pro_enabled: true },
  });

  const initialPublished = Boolean(structure?.is_pro_enabled);
  const [newSettings] = await db.insert(T).values({
      id: crypto.randomUUID(),
      structureId,
      isPublished: initialPublished,
      bookingMode: 'IN_PERSON',
      contactEmail: null,
      contactPhone: null,
      updatedAt: new Date(),
      ...(initialPublished ? { publishedAt: new Date() } : { publishedAt: null }),
  }).returning();
  
  settings = newSettings;

  return settings;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  const { structureId, role } = proCtx;
  const canWrite = role === AUTH_ROLE.STRUCTURE_ADMIN || role === AUTH_ROLE.SUPERADMIN;

  if (req.method === 'GET') {
    const settings = await getOrCreateSettings(structureId);
    return res.status(200).json(serialize(settings));
  }

  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!canWrite) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const current = await getOrCreateSettings(structureId);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const hasIsPublished = typeof body.isPublished !== 'undefined' || typeof body.is_published !== 'undefined';
  const requestedPublished = hasIsPublished
    ? Boolean(body.isPublished ?? body.is_published)
    : current.isPublished;

  const hasBookingMode = typeof body.bookingMode !== 'undefined' || typeof body.booking_mode !== 'undefined';
  const nextBookingMode = hasBookingMode
    ? normalizeBookingMode(body.bookingMode ?? body.booking_mode)
    : current.bookingMode;

  if (!nextBookingMode) {
    return res.status(400).json({ error: 'Invalid bookingMode' });
  }

  const hasContactEmail = typeof body.contactEmail !== 'undefined' || typeof body.contact_email !== 'undefined';
  const nextContactEmail = hasContactEmail
    ? normalizeEmail(body.contactEmail ?? body.contact_email)
    : current.contactEmail;

  if (hasContactEmail && body.contactEmail != null && body.contactEmail !== '' && !nextContactEmail) {
    return res.status(400).json({ error: 'Invalid contactEmail' });
  }
  if (hasContactEmail && body.contact_email != null && body.contact_email !== '' && !nextContactEmail) {
    return res.status(400).json({ error: 'Invalid contactEmail' });
  }

  const hasContactPhone = typeof body.contactPhone !== 'undefined' || typeof body.contact_phone !== 'undefined';
  const nextContactPhone = hasContactPhone
    ? normalizePhone(body.contactPhone ?? body.contact_phone)
    : current.contactPhone;

  if (requestedPublished && !current.isPublished) {
    // getProRdvReadiness checks table presence via information_schema.
    const readiness = await getProRdvReadiness(db);
    if (!readiness.ok) {
      return res.status(409).json({
        error: 'rdv_not_ready',
        message: 'Base RDV non prete',
        missingTables: readiness.missingTables,
      });
    }
  }

  // R38: account-free booking is an explicit opt-in of the structure (admin only, like publishing); a boolean or nothing
  const hasAllowGuest = typeof body.allowGuestBooking !== 'undefined';
  if (hasAllowGuest && typeof body.allowGuestBooking !== 'boolean') {
    return res.status(400).json({ error: 'Invalid allowGuestBooking' });
  }
  // R41-B: nothing to store the opt-in in before migration 0043: « no » is already true, « yes » is refused (never silently dropped)
  const features = await requestGuestSchema(db);
  if (!features.guestBooking && body.allowGuestBooking === true) {
    return res.status(409).json({ error: 'GUEST_BOOKING_NOT_AVAILABLE', code: 'GUEST_BOOKING_NOT_AVAILABLE', message: 'La réservation sans compte n’est pas disponible sur cette installation.' });
  }
  const nextAllowGuest = hasAllowGuest ? body.allowGuestBooking : Boolean(current.allowGuestBooking);

  const noChanges =
    nextAllowGuest === Boolean(current.allowGuestBooking) &&
    requestedPublished === current.isPublished &&
    nextBookingMode === current.bookingMode &&
    (nextContactEmail || null) === (current.contactEmail || null) &&
    (nextContactPhone || null) === (current.contactPhone || null);

  if (noChanges) {
    return res.status(200).json(serialize(current));
  }

  const now = new Date();
  // Sequential operations (neon-http driver doesn't support transactions)
  const [settings] = await db.update(settingsTable(features)).set({
      isPublished: requestedPublished,
      bookingMode: nextBookingMode === 'IN_PERSON' || nextBookingMode === 'VIDEO' || nextBookingMode === 'BOTH' ? nextBookingMode : current.bookingMode,
      contactEmail: nextContactEmail || null,
      contactPhone: nextContactPhone || null,
      publishedAt: requestedPublished ? current.publishedAt || now : current.publishedAt,
      ...(features.guestBooking ? { allowGuestBooking: nextAllowGuest } : {}),
  }).where(eq(StructureRdvSettings.id, current.id)).returning();

  await db.update(Structure).set({
      is_pro_enabled: requestedPublished,
  }).where(eq(Structure.id, structureId));
  // R14: publishing or withdrawing the organization's public booking is journaled
  await logProAudit(requestedPublished === Boolean(current.isPublished) ? 'RDV_SETTINGS_UPDATED' : requestedPublished ? 'RDV_BOOKING_PUBLISHED' : 'RDV_BOOKING_UNPUBLISHED', proCtx.userId, structureId, { bookingMode: settings?.bookingMode || null }, clientIp(req));
  if (nextAllowGuest !== Boolean(current.allowGuestBooking)) {
    await logProAudit(nextAllowGuest ? 'RDV_GUEST_BOOKING_ENABLED' : 'RDV_GUEST_BOOKING_DISABLED', proCtx.userId, structureId, { allowGuestBooking: nextAllowGuest }, clientIp(req));
  }

  const updated = settings;

  return res.status(200).json(serialize(updated));
}

export default withProRdvHandler('pro.rdv.settings', handler);
