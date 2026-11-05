import crypto from 'node:crypto';
import { db } from '../../../src/db/index.js';
import { StructureRdvSettings, Structure } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { AUTH_ROLE, logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { getProRdvReadiness } from '../../_utils/pro-rdv-readiness.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { flagsOf, requestGuestSchema, settingsTable } from '../../_utils/schema-features.js';
import { asConfirmation, parseBookingConfig, readBookingConfig, writeBookingConfig } from '../../_services/rdv-booking-config.js';
import { sql } from 'drizzle-orm';

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
    // R42 (DEC-R42-01): account-free booking is retired — always false; an account is required to ask for an appointment
    allowGuestBooking: false,
    accountRequired: true,
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
    // R46: one honest status line per communication channel (e-mail, SMS, video, connected calendar) — states and variable NAMES only, never a secret
    const { channelStatuses } = await import('../../lib/communication-channels.js');
    return res.status(200).json({ ...serialize(settings), booking: await bookingView(structureId), channels: channelStatuses() });
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

  // R38 account-free booking — R42 (DEC-R42-01): retired. « yes » is refused on every database level (never silently dropped); « no » turns a LAB 0044
  // opt-in off. The opt-in can no longer re-enable anything (the guest routes answer 410 whatever it says).
  const hasAllowGuest = typeof body.allowGuestBooking !== 'undefined';
  if (hasAllowGuest && typeof body.allowGuestBooking !== 'boolean') {
    return res.status(400).json({ error: 'Invalid allowGuestBooking' });
  }
  if (body.allowGuestBooking === true) {
    return res.status(409).json({ error: 'GUEST_BOOKING_RETIRED', code: 'GUEST_BOOKING_RETIRED', message: 'La réservation sans compte n’existe plus : un compte est nécessaire pour demander un rendez-vous.' });
  }
  const features = await requestGuestSchema(db);
  const nextAllowGuest = false;

  // R42-A03 / A04: confirmation mode (structure / per service) and team choice — validated against this structure's services and members
  const booking = await readBookingPatch(structureId, body);
  if ('error' in booking) return res.status(400).json({ error: booking.error, code: 'INVALID_BOOKING_CONFIG' });
  if (booking.changed) {
    const saved = await writeBookingConfig(structureId, booking.config);
    await logProAudit('RDV_BOOKING_CONFIG_UPDATED', proCtx.userId, structureId, { confirmation: saved.confirmation, serviceOverrides: Object.keys(saved.services).length,
      teamEnabled: saved.team.enabled, bookableMembers: Object.values(saved.team.members).filter((m) => m.bookable).length,
      selectableMembers: Object.values(saved.team.members).filter((m) => m.selectable).length }, clientIp(req));
  }

  const noChanges =
    nextAllowGuest === Boolean(current.allowGuestBooking) &&
    requestedPublished === current.isPublished &&
    nextBookingMode === current.bookingMode &&
    (nextContactEmail || null) === (current.contactEmail || null) &&
    (nextContactPhone || null) === (current.contactPhone || null);

  if (noChanges) {
    return res.status(200).json({ ...serialize(current), booking: await bookingView(structureId) });
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

  return res.status(200).json({ ...serialize(updated), booking: await bookingView(structureId) });
}

/**
 * R42 — the booking configuration with what an administrator needs to set it: the structure's services and its active members (with whether their
 * sign-in is verified by MFA and whether they have a public display name — a professional is never shown publicly by e-mail).
 * @param {string} structureId
 */
async function bookingView(structureId) {
  const config = await readBookingConfig(structureId);
  const members = await db.execute(sql`SELECT u.id, u.email, u.role, u.mfa_enabled AS "mfaEnabled", p."displayName" AS "displayName", p."jobTitle" AS "jobTitle"
    FROM "ProUser" u LEFT JOIN "ProProfile" p ON p."proUserId" = u.id WHERE u."structureId" = ${structureId} AND u.status = 'active' ORDER BY u.email`);
  const services = await db.execute(sql`SELECT id, name FROM "ProRdvService" WHERE "structureId" = ${structureId} ORDER BY name`);
  return {
    confirmation: config.confirmation,
    serviceConfirmation: Object.fromEntries(Object.entries(config.services).map(([id, v]) => [id, v.confirmation])),
    team: config.team,
    members: members.rows.map((m) => ({ id: String(m.id), email: String(m.email), role: String(m.role), verified: m.mfaEnabled === true,
      displayName: typeof m.displayName === 'string' ? m.displayName : null, jobTitle: typeof m.jobTitle === 'string' ? m.jobTitle : null })),
    services: services.rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
  };
}

/**
 * The next booking configuration from a PUT / PATCH body: `confirmation` ('DIRECT' | 'APPROVAL'), `serviceConfirmation` ({ serviceId: mode | null }),
 * `team` ({ enabled, members: { proUserId: { bookable, selectable, serviceIds } } }). Only this structure's services and active members are accepted.
 * @param {string} structureId @param {Record<string, unknown>} body
 * @returns {Promise<{ error: string } | { changed: boolean, config: import('../../_services/rdv-booking-config.js').BookingConfig }>}
 */
async function readBookingPatch(structureId, body) {
  const touches = ['confirmation', 'serviceConfirmation', 'team'].some((k) => typeof body[k] !== 'undefined');
  const current = await readBookingConfig(structureId);
  if (!touches) return { changed: false, config: current };
  const serviceRows = await db.execute(sql`SELECT id FROM "ProRdvService" WHERE "structureId" = ${structureId}`);
  const serviceIds = new Set(serviceRows.rows.map((r) => String(r.id)));
  const memberRows = await db.execute(sql`SELECT id FROM "ProUser" WHERE "structureId" = ${structureId} AND status = 'active'`);
  const memberIds = new Set(memberRows.rows.map((r) => String(r.id)));
  const next = parseBookingConfig(current);
  if (typeof body.confirmation !== 'undefined') {
    const mode = asConfirmation(body.confirmation);
    if (!mode) return { error: 'confirmation doit valoir DIRECT ou APPROVAL.' };
    next.confirmation = mode;
  }
  if (typeof body.serviceConfirmation !== 'undefined') {
    const map = body.serviceConfirmation;
    if (typeof map !== 'object' || map === null || Array.isArray(map)) return { error: 'serviceConfirmation doit être un objet { service: mode }.' };
    for (const [id, value] of Object.entries(map)) {
      if (!serviceIds.has(id)) return { error: 'Service inconnu pour cette structure.' };
      if (value === null) { delete next.services[id]; continue; }
      const mode = asConfirmation(value);
      if (!mode) return { error: 'Le mode de confirmation d’un service doit valoir DIRECT ou APPROVAL.' };
      next.services[id] = { confirmation: mode };
    }
  }
  if (typeof body.team !== 'undefined') {
    const team = body.team;
    if (typeof team !== 'object' || team === null || Array.isArray(team)) return { error: 'team doit être un objet.' };
    const t = /** @type {Record<string, unknown>} */ (team);
    if (typeof t.enabled !== 'undefined') {
      if (typeof t.enabled !== 'boolean') return { error: 'team.enabled doit être vrai ou faux.' };
      next.team.enabled = t.enabled;
    }
    if (typeof t.members !== 'undefined') {
      if (typeof t.members !== 'object' || t.members === null || Array.isArray(t.members)) return { error: 'team.members doit être un objet.' };
      for (const [id, value] of Object.entries(t.members)) {
        if (!memberIds.has(id)) return { error: 'Membre inconnu pour cette structure.' };
        if (value === null) { delete next.team.members[id]; continue; }
        if (typeof value !== 'object' || Array.isArray(value)) return { error: 'Réglage de membre invalide.' };
        const m = /** @type {Record<string, unknown>} */ (value);
        if ((typeof m.bookable !== 'undefined' && typeof m.bookable !== 'boolean') || (typeof m.selectable !== 'undefined' && typeof m.selectable !== 'boolean')) return { error: 'bookable et selectable doivent être vrai ou faux.' };
        const ids = typeof m.serviceIds === 'undefined' ? (next.team.members[id]?.serviceIds || []) : m.serviceIds;
        if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !serviceIds.has(x))) return { error: 'serviceIds doit lister des services de cette structure.' };
        const bookable = typeof m.bookable === 'boolean' ? m.bookable : Boolean(next.team.members[id]?.bookable);
        const selectable = typeof m.selectable === 'boolean' ? m.selectable : Boolean(next.team.members[id]?.selectable);
        next.team.members[id] = { bookable, selectable: bookable && selectable, serviceIds: ids.map(String) };
      }
    }
  }
  return { changed: true, config: next };
}

export default withProRdvHandler('pro.rdv.settings', handler);
