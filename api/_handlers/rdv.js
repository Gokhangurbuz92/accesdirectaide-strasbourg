// @ts-nocheck
import crypto from 'node:crypto';
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, and, inArray, lt, gt, asc, count , sql, isNull } from 'drizzle-orm';
import { buildAppointmentIcs } from '../_utils/ics.js';
import { calendarAttachment } from '../_services/appointment-notices.js';
import { sendMail } from '../_utils/mailer.js';
import { ACTIVE_APPOINTMENT_STATUSES, generateSlots, toBusyWindows, validateDateRange } from '../_utils/pro-rdv.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { requireCitizenUser } from '../_utils/rdv-public-auth.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { formatParis, noticeCitizen, noticeStructure } from '../_services/appointment-notices.js';
import { MODE_LABELS, modeLabel, locationOf, locationText, normalizeMode, offeredModes, rulesFor } from '../lib/appointment-modes.js';
import { issueJoin, joinRefusal, joinWindow, publicVideoStatus } from '../lib/video-provider.js';

const MAX_RANGE_DAYS = 14;
const MAX_BOOKING_AHEAD_DAYS = 60;
const MIN_BOOKING_DELAY_MINUTES = 5;
// PKG-3 / D-2 (owner decision 2026-10-19): an appointment may be moved while it starts at least 24 hours later, at most twice, as an atomic swap under the booking lock.
export const RESCHEDULE_MIN_NOTICE_HOURS = 24;
export const MAX_RESCHEDULES = 2;
const RESCHEDULABLE_STATUSES = ['booked', 'requested', 'confirmed'];
const CONFIRMATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_TOKEN_VERSION = 1;
const PROCESS_LOCAL_CONFIRMATION_SECRET = crypto.randomBytes(32);
const bookingCollisionLocks = new Map();

function getConfirmationTokenSecret() {
  const configured = [
    process.env.RDV_CONFIRMATION_TOKEN_SECRET,
    process.env.AUTH_SECRET,
    process.env.JWT_SECRET,
    process.env.SESSION_SECRET,
  ].find((value) => typeof value === 'string' && value.length >= 32);

  if (configured) return Buffer.from(configured, 'utf8');
  if (process.env.NODE_ENV === 'production' || process.env.WS7_REQUIRE_DURABLE_RDV_SECRET === '1') {
    throw new Error('A durable RDV confirmation secret of at least 32 characters is required');
  }
  return PROCESS_LOCAL_CONFIRMATION_SECRET;
}

function digestIdentifier(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function signConfirmationPayload(encodedPayload) {
  return crypto
    .createHmac('sha256', getConfirmationTokenSecret())
    .update(encodedPayload, 'utf8')
    .digest('base64url');
}

/**
 * Issues a short-lived, signed, non-sequential appointment confirmation token.
 * Raw user identifiers are never embedded in the token payload.
 *
 * @param {{
 *  appointmentId: string,
 *  citizenUserId: string,
 *  nowMs?: number,
 *  ttlMs?: number,
 * }} input
 */
export function issueAppointmentConfirmationToken(input) {
  const appointmentId = toTrimmedString(input?.appointmentId);
  const citizenUserId = toTrimmedString(input?.citizenUserId);
  const nowMs = Number(input?.nowMs ?? Date.now());
  const ttlMs = Number(input?.ttlMs ?? CONFIRMATION_TOKEN_TTL_MS);

  if (!appointmentId || !citizenUserId) {
    throw new Error('appointmentId and citizenUserId are required');
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Invalid confirmation token lifetime');
  }

  const expiresAtMs = nowMs + ttlMs;
  const payload = {
    v: CONFIRMATION_TOKEN_VERSION,
    ah: digestIdentifier(appointmentId),
    uh: digestIdentifier(citizenUserId),
    exp: expiresAtMs,
    n: crypto.randomBytes(18).toString('base64url'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signConfirmationPayload(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * @param {unknown} token
 * @param {{
 *  appointmentId?: string,
 *  citizenUserId?: string,
 *  nowMs?: number,
 * }=} expected
 */
export function verifyAppointmentConfirmationToken(token, expected = {}) {
  const raw = toTrimmedString(token);
  if (!raw || raw.length > 2048) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  const parts = raw.split('.');
  if (
    parts.length !== 2
    || !/^[A-Za-z0-9_-]+$/.test(parts[0])
    || !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = signConfirmationPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (
    providedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  const nowMs = Number(expected.nowMs ?? Date.now());
  if (
    payload?.v !== CONFIRMATION_TOKEN_VERSION
    || !Number.isFinite(payload?.exp)
    || payload.exp <= nowMs
    || typeof payload?.n !== 'string'
    || !/^[A-Za-z0-9_-]{20,}$/.test(payload.n)
  ) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  if (
    expected.appointmentId
    && payload.ah !== digestIdentifier(expected.appointmentId)
  ) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  if (
    expected.citizenUserId
    && payload.uh !== digestIdentifier(expected.citizenUserId)
  ) {
    return { ok: false, code: 'INVALID_APPOINTMENT_TOKEN' };
  }

  return {
    ok: true,
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

/**
 * Local-release collision guard. Serializes booking mutations for one
 * structure/day so the second contender re-runs the DB overlap check after
 * the first mutation has completed.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function withBookingCollisionLock(key, task) {
  const lockKey = toTrimmedString(key);
  if (!lockKey || typeof task !== 'function') {
    throw new TypeError('A booking lock key and task are required');
  }

  const previous = bookingCollisionLocks.get(lockKey) || Promise.resolve();
  let releaseCurrent;
  const currentGate = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(
    () => currentGate,
    () => currentGate,
  );
  bookingCollisionLocks.set(lockKey, tail);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrent();
    if (bookingCollisionLocks.get(lockKey) === tail) {
      bookingCollisionLocks.delete(lockKey);
    }
  }
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @returns {URL}
 */
function getUrl(req) {
  return new URL(req.url || '/api/rdv', `https://${req.headers?.host || 'localhost'}`);
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @returns {string[]}
 */
function getPathSegments(req) {
  const pathname = getUrl(req).pathname || '';
  const normalized = pathname
    .replace(/^\/api\/rdv\/?/i, '')
    .replace(/^\/rdv\/?/i, '')
    .replace(/\/+$/, '');
  if (!normalized) return [];
  return normalized.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toTrimmedString(value) {
  return String(value || '').trim();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeDateInput(value) {
  const raw = toTrimmedString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00.000Z`;
  }
  return raw;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeToDateInput(value) {
  const raw = toTrimmedString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T23:59:59.999Z`;
  }
  return raw;
}

/**
 * @param {Date} value
 * @returns {Date}
 */
function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

/**
 * @param {Date} value
 * @returns {Date}
 */
function endOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
}

/**
 * @param {Date} value
 * @returns {Date}
 */
function addDaysUtc(value, days) {
  return new Date(value.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

/**
 * @param {Array<{ startAt: string, endAt: string }>} slots
 */
function groupSlotsByDay(slots) {
  /** @type {Map<string, Array<{ startAt: string, endAt: string }>>} */
  const byDay = new Map();
  for (const slot of slots) {
    const day = String(slot.startAt || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(slot);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({
      date,
      slots: daySlots,
    }));
}

/**
 * @param {string} slug
 */
async function loadStructureBySlug(slug) {
  const structure = await db.query.Structure.findFirst({
    where: (t, { eq, and }) => and(eq(t.slug, slug), eq(t.statut, 'actif')),
    columns: {
      id: true,
      slug: true,
      nom: true,
      is_pro_enabled: true,
      adresse: true,
      code_postal: true,
      ville: true,
      accessibilite_pmr: true,
      verification_status: true,
    },
    with: {
      rdvSettings: {
        columns: {
          isPublished: true,
          bookingMode: true,
        },
      },
    },
  });

  if (!structure) return null;

  // rdvSettings is a `many` relation → array in Drizzle
  const settings = Array.isArray(structure.rdvSettings) ? structure.rdvSettings[0] : structure.rdvSettings;
  const isPublished =
    settings && typeof settings.isPublished === 'boolean'
      ? settings.isPublished
      : Boolean(structure.is_pro_enabled);

  return {
    id: structure.id,
    slug: structure.slug,
    nom: structure.nom,
    isPublished,
    // PKG-5 / E01: NEW bookings (services, slots, booking, a move to a new slot) need an active, identity-verified organization (api/_utils/org-eligibility.js)
    bookable: Boolean(isPublished) && structure.verification_status === 'VERIFIED',
    bookingMode: settings?.bookingMode || 'IN_PERSON',
    location: locationOf(structure),
    // raw address fields, so appointment payloads composed in this request carry the same location as reloaded ones
    adresse: structure.adresse, code_postal: structure.code_postal, ville: structure.ville, accessibilite_pmr: structure.accessibilite_pmr, verification_status: structure.verification_status,
  };
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {string} kind
 * @param {string} userId
 */
async function enforcePublicRdvRateLimit(req, kind, userId) {
  const ip = getClientIp(req);
  const action = kind === 'write' ? 'RDV_PUBLIC_WRITE' : 'RDV_PUBLIC_READ';
  const key = `${userId || 'anonymous'}:${ip}`;
  const result = await checkRateLimit(action, key);
  if (!result.allowed) {
    return {
      allowed: false,
      status: getRateLimitStatus(result),
      error: result.error || { error: 'Too many requests' },
    };
  }

  return { allowed: true };
}

function buildAppointmentManageUrl(appointmentId, structureSlug, confirmationToken = '') {
  const safeSlug = toTrimmedString(structureSlug);
  if (!safeSlug) return null;

  const params = new URLSearchParams({
    appointment: toTrimmedString(appointmentId),
  });
  const token = toTrimmedString(confirmationToken);
  const fragment = new URLSearchParams();
  if (token) fragment.set('token', token);

  const url = new URL(buildAppUrl(`/rdv/${encodeURIComponent(safeSlug)}/booking?${params.toString()}`));
  if (token) url.hash = fragment.toString();
  return url.toString();
}

/**
 * @param {any} appointment
 * @param {{
 *  structureSlug?: string | null,
 *  confirmationToken?: string | null,
 *  confirmationExpiresAt?: string | null,
 *  includeCalendar?: boolean,
 * }=} options
 */
function serializeAppointment(appointment, options = {}) {
  const structureSlug = toTrimmedString(options.structureSlug || appointment?.structure?.slug || '');
  const manageUrl = buildAppointmentManageUrl(
    appointment.id,
    structureSlug,
    options.confirmationToken || '',
  );

  const startsAt = appointment.startAt instanceof Date ? appointment.startAt : null;
  const endsAt = appointment.endAt instanceof Date ? appointment.endAt : null;
  const structureName = appointment?.structure?.nom || '';
  const serviceName = appointment?.service?.name || '';
  const calendar = options.includeCalendar && startsAt && endsAt && structureName && serviceName
    ? {
        filename: `acces-direct-aide-rdv-${appointment.id}.ics`,
        contentType: 'text/calendar; charset=utf-8',
        content: buildAppointmentIcs({
          appointmentId: appointment.id,
          startAt: startsAt,
          endAt: endsAt,
          structureName,
          serviceName,
          manageUrl,
          sequence: Number(appointment.rescheduleCount || 0),
          location: icsLocation(appointment),
        }),
      }
    : null;

  return {
    id: appointment.id,
    status: String(appointment.status || '').toUpperCase(),
    startsAt: startsAt ? startsAt.toISOString() : null,
    endsAt: endsAt ? endsAt.toISOString() : null,
    cancelledAt: appointment.cancelledAt instanceof Date ? appointment.cancelledAt.toISOString() : null,
    cancelledBy: appointment.cancelledBy || null,
    mode: appointment.mode || 'IN_PERSON',
    location: (appointment.mode || 'IN_PERSON') === 'IN_PERSON' ? locationOf(appointment.structure) : null,
    video: appointment.mode === 'VIDEO'
      ? {
          approved: Boolean(appointment.visioApprovedAt),
          consent: Boolean(appointment.visioCitizenConsentAt),
          opensAt: startsAt && endsAt ? joinWindow(appointment).opensAt.toISOString() : null,
          closesAt: startsAt && endsAt ? joinWindow(appointment).closesAt.toISOString() : null,
          service: publicVideoStatus(),
        }
      : null,
    reschedule: startsAt
      ? {
          count: Number(appointment.rescheduleCount || 0),
          max: MAX_RESCHEDULES,
          until: new Date(startsAt.getTime() - RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000).toISOString(),
        }
      : null,
    structure: appointment.structure
      ? {
          id: appointment.structure.id,
          slug: appointment.structure.slug,
          name: appointment.structure.nom,
        }
      : null,
    service: appointment.service
      ? {
          id: appointment.service.id,
          name: appointment.service.name,
          durationMinutes: appointment.service.durationMinutes,
        }
      : null,
    manageUrl,
    confirmation: options.confirmationToken
      ? {
          token: options.confirmationToken,
          expiresAt: options.confirmationExpiresAt || null,
        }
      : null,
    calendar,
  };
}

/** LOCATION of the calendar event: the address for an in-person appointment; never a meeting link for a video one (the secure access is in Mes rendez-vous). */
function icsLocation(appointment) {
  if (appointment.mode === 'VIDEO') return 'À distance (visio) - accès sécurisé depuis Mes rendez-vous';
  const loc = locationOf(appointment.structure);
  return loc ? loc.address : '';
}

/** The modality part of a confirmation / reminder text. */
export function modalityText(appointment) {
  if (appointment.mode === 'VIDEO') {
    return `Modalité : ${MODE_LABELS.VIDEO}. L’accès sécurisé à la visio se fait depuis Mes rendez-vous (${buildAppUrl('/compte/rendez-vous')}), `
      + `à partir de 15 minutes avant l’heure, une fois la visio validée par la structure. Aucun lien n’est envoyé par e-mail. Aucun enregistrement.`;
  }
  return `Modalité : ${MODE_LABELS.IN_PERSON}.\n${locationText(locationOf(appointment.structure))}`;
}

function createConfirmedAppointmentPayload(appointment, options = {}) {
  const citizenUserId = toTrimmedString(options.citizenUserId || appointment?.citizenUserId || '');
  const structureSlug = toTrimmedString(options.structureSlug || appointment?.structure?.slug || '');

  const confirmation = issueAppointmentConfirmationToken({
    appointmentId: appointment.id,
    citizenUserId,
  });

  return {
    confirmation,
    payload: serializeAppointment(appointment, {
      structureSlug,
      confirmationToken: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
      includeCalendar: true,
    }),
  };
}

/**
 * @param {{
 *  appointment: any,
 *  structureName: string,
 *  structureSlug: string,
 *  serviceName: string,
 *  toEmail: string,
 *  confirmationToken: string,
 * }} input
 */
async function sendAppointmentConfirmationEmail(input) {
  const startsAt = new Date(input.appointment.startAt);
  const endsAt = new Date(input.appointment.endAt);
  const manageUrl = buildAppointmentManageUrl(
    input.appointment.id,
    input.structureSlug,
    input.confirmationToken,
  );

  const startsAtLocal = startsAt.toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });

  const calendar = calendarAttachment({
    appointmentId: input.appointment.id,
    startAt: startsAt,
    endAt: endsAt,
    structureName: input.structureName,
    serviceName: input.serviceName,
    manageUrl,
    location: icsLocation(input.appointment),
  }, input.toEmail);

  const text = [
    `Votre rendez-vous est confirme avec ${input.structureName}.`,
    '',
    `Service: ${input.serviceName}`,
    `Date: ${startsAtLocal} (Europe/Paris)`,
    modalityText(input.appointment),
    '',
    `Gerer mon rendez-vous: ${manageUrl}`,
    '',
    "Si vous n'etes pas a l'origine de cette demande, ignorez cet email.",
  ].join('\n');

  await sendMail({
    to: input.toEmail,
    subject: `Confirmation de votre rendez-vous - ${input.structureName}`,
    text,
    category: 'appointment_confirmation',
    attachments: [calendar],
  });
}

/**
 * Helper: load appointment with service + structure relations
 * @param {string} appointmentId
 * @param {{ citizenUserId?: string, idempotencyKey?: string }=} where
 */
async function loadAppointmentWithRelations(appointmentId, where = {}) {
  if (appointmentId) {
    return db.query.ProAppointment.findFirst({
      where: (a, { eq }) => eq(a.id, appointmentId),
      with: {
        service: { columns: { id: true, name: true, durationMinutes: true } },
        structure: { columns: { id: true, slug: true, nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true, verification_status: true } },
      },
    });
  }
  if (where.citizenUserId && where.idempotencyKey) {
    return db.query.ProAppointment.findFirst({
      where: (a, { eq, and }) => and(eq(a.citizenUserId, where.citizenUserId), eq(a.idempotencyKey, where.idempotencyKey)),
      with: {
        service: { columns: { id: true, name: true, durationMinutes: true } },
        structure: { columns: { id: true, slug: true, nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true, verification_status: true } },
      },
    });
  }
  return null;
}

/**
 * Helper: find overlapping appointments using Query Builder (supports lt/gt/in)
 * @param {any} dbOrTx - db or tx instance
 * @param {{ structureId: string, statuses: string[], startBefore: Date, endAfter: Date }} params
 */
async function findOverlappingAppointments(dbOrTx, params) {
  const rows = await dbOrTx
    .select()
    .from(schema.ProAppointment)
    .where(
      and(
        eq(schema.ProAppointment.structureId, params.structureId),
        inArray(schema.ProAppointment.status, params.statuses),
        lt(schema.ProAppointment.startAt, params.startBefore),
        gt(schema.ProAppointment.endAt, params.endAfter),
      ),
    );

  // Load service relation for buffer minutes
  const withService = await Promise.all(
    rows.map(async (appt) => {
      const service = appt.serviceId
        ? await db.query.ProRdvService.findFirst({
            where: (s, { eq }) => eq(s.id, appt.serviceId),
            columns: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
          })
        : null;
      return { ...appt, service };
    }),
  );

  return withService;
}

/**
 * Helper: find time-offs overlapping a range using Query Builder
 * @param {any} dbOrTx
 * @param {{ structureId: string, startBefore: Date, endAfter: Date }} params
 */
async function findOverlappingTimeOffs(dbOrTx, params) {
  return dbOrTx
    .select({ startAt: schema.ProTimeOff.startAt, endAt: schema.ProTimeOff.endAt })
    .from(schema.ProTimeOff)
    .where(
      and(
        eq(schema.ProTimeOff.structureId, params.structureId),
        isNull(schema.ProTimeOff.proUserId),   // R24 (owner decision R18.5): only a closure of the structure removes public slots, not one member's absence
        lt(schema.ProTimeOff.startAt, params.startBefore),
        gt(schema.ProTimeOff.endAt, params.endAfter),
      ),
    );
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function getServices(req, res) {
  const segments = getPathSegments(req);
  const structureSlug = toTrimmedString(segments[1]);

  if (!structureSlug) {
    return res.status(400).json({ error: 'structure slug is required' });
  }

  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }

  const rateLimit = await enforcePublicRdvRateLimit(req, 'read', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }

  const structure = await loadStructureBySlug(structureSlug);
  if (!structure || !structure.bookable) {
    return res.status(404).json({ error: 'RDV indisponible' });
  }

  const services = await db.query.ProRdvService.findMany({
    where: (s, { eq, and }) => and(eq(s.structureId, structure.id), eq(s.isActive, true)),
    columns: {
      id: true,
      name: true,
      durationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      modes: true,
    },
    orderBy: (s, { asc }) => [asc(s.name)],
  });
  // PKG-3: each service lists the modalities really bookable now (structure x service x video activation); ?mode= keeps only the services offering it
  const video = publicVideoStatus();
  const wanted = normalizeMode(req.query?.mode);
  const items = services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    modes: offeredModes(structure.bookingMode, service.modes, video),
  })).filter((service) => service.modes.length && (!wanted || service.modes.includes(wanted)));
  const modes = ['IN_PERSON', 'VIDEO'].filter((m) => services.some((service) => offeredModes(structure.bookingMode, service.modes, video).includes(m)));

  return res.status(200).json({
    structure: {
      slug: structure.slug,
      name: structure.nom,
      bookingMode: structure.bookingMode,
      modes,
      location: structure.location,
    },
    video,
    items,
  });
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function getSlots(req, res) {
  const segments = getPathSegments(req);
  const structureSlug = toTrimmedString(segments[1]);

  if (!structureSlug) {
    return res.status(400).json({ error: 'structure slug is required' });
  }

  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }

  const rateLimit = await enforcePublicRdvRateLimit(req, 'read', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }

  const structure = await loadStructureBySlug(structureSlug);
  if (!structure || !structure.bookable) {
    return res.status(404).json({ error: 'RDV indisponible' });
  }

  const serviceId = toTrimmedString(req.query?.serviceId);
  const fromInput = normalizeDateInput(req.query?.from);
  const toInput = normalizeToDateInput(req.query?.to);

  if (!serviceId || !fromInput || !toInput) {
    return res.status(400).json({ error: 'serviceId, from and to are required' });
  }

  let range;
  try {
    range = validateDateRange(fromInput, toInput, MAX_RANGE_DAYS);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid date range' });
  }

  const service = await db.query.ProRdvService.findFirst({
    where: (s, { eq, and }) => and(eq(s.id, serviceId), eq(s.structureId, structure.id), eq(s.isActive, true)),
    columns: {
      id: true,
      name: true,
      durationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      modes: true,
    },
  });

  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  // PKG-3: slots are computed for ONE modality (default in person); a modality the service / structure / video activation does not offer has no slots at all
  const mode = req.query?.mode ? normalizeMode(req.query.mode) : 'IN_PERSON';
  if (!mode || !offeredModes(structure.bookingMode, service.modes, publicVideoStatus()).includes(mode)) {
    return res.status(409).json({ error: 'MODE_UNAVAILABLE', code: 'MODE_UNAVAILABLE', message: 'Cette modalité n’est pas proposée pour ce service.' });
  }

  const rules = rulesFor(await db.query.ProAvailabilityRule.findMany({
    where: (r, { eq, and }) => and(eq(r.structureId, structure.id), eq(r.isActive, true)),
    orderBy: (r, { asc }) => [asc(r.weekday), asc(r.startTime)],
  }), mode);

  const appointments = await findOverlappingAppointments(db, {
    structureId: structure.id,
    statuses: ACTIVE_APPOINTMENT_STATUSES,
    startBefore: range.to,
    endAfter: range.from,
  });

  const timeOffs = await findOverlappingTimeOffs(db, {
    structureId: structure.id,
    startBefore: range.to,
    endAfter: range.from,
  });

  const busyWindows = [
    ...toBusyWindows(appointments),
    ...timeOffs.map((timeOff) => ({ start: timeOff.startAt, end: timeOff.endAt })),
  ];

  const slots = generateSlots({
    rules,
    from: range.from,
    to: range.to,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    busyWindows,
    maxSlots: 800,
  }).filter((slot) => {
    // PKG-3 / B02: never offer a slot the booking would refuse (already started / within the minimum delay / beyond the booking horizon). Today's past slots used to be
    // listed, and choosing one failed with "startAt out of allowed range" — found by the first real-browser booking journey (DTA-B26).
    const t = new Date(slot.startAt).getTime();
    return t >= Date.now() + MIN_BOOKING_DELAY_MINUTES * 60_000 && t <= addDaysUtc(new Date(), MAX_BOOKING_AHEAD_DAYS).getTime();
  });

  return res.status(200).json({
    timezone: rules[0]?.timezone || 'Europe/Paris',
    mode,
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
    },
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    total: slots.length,
    slots,
    days: groupSlotsByDay(slots),
  });
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function createAppointment(req, res) {
  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }

  const rateLimit = await enforcePublicRdvRateLimit(req, 'write', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const structureSlug = toTrimmedString(body.structureSlug);
  const serviceId = toTrimmedString(body.serviceId);
  const startAtRaw = toTrimmedString(body.startAt);
  const idempotencyKey = toTrimmedString(body.idempotencyKey);

  if (!structureSlug || !serviceId || !startAtRaw || !idempotencyKey) {
    return res.status(400).json({ error: 'structureSlug, serviceId, startAt and idempotencyKey are required' });
  }

  const existingByKey = await loadAppointmentWithRelations(null, {
    citizenUserId: auth.user.id,
    idempotencyKey,
  });

  if (existingByKey) {
    const confirmed = createConfirmedAppointmentPayload(existingByKey, {
      citizenUserId: auth.user.id,
    });
    return res.status(200).json(confirmed.payload);
  }

  const startAt = new Date(startAtRaw);
  if (Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ error: 'Invalid startAt' });
  }

  const now = new Date();
  const minStartAt = new Date(now.getTime() + MIN_BOOKING_DELAY_MINUTES * 60_000);
  const maxStartAt = addDaysUtc(now, MAX_BOOKING_AHEAD_DAYS);
  if (startAt < minStartAt || startAt > maxStartAt) {
    return res.status(400).json({ error: 'startAt out of allowed range' });
  }

  const structure = await loadStructureBySlug(structureSlug);
  if (!structure || !structure.bookable) {
    return res.status(404).json({ error: 'RDV indisponible' });
  }

  const service = await db.query.ProRdvService.findFirst({
    where: (s, { eq, and }) => and(eq(s.id, serviceId), eq(s.structureId, structure.id), eq(s.isActive, true)),
    columns: {
      id: true,
      name: true,
      durationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      modes: true,
    },
  });

  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  // PKG-3: the modality is part of the booking (absent = in person, the historical behaviour). It must be offered now; video needs the person's explicit agreement.
  const mode = body.mode === undefined ? 'IN_PERSON' : normalizeMode(body.mode);
  if (!mode || !offeredModes(structure.bookingMode, service.modes, publicVideoStatus()).includes(mode)) {
    return res.status(409).json({ error: 'MODE_UNAVAILABLE', code: 'MODE_UNAVAILABLE', message: 'Cette modalité n’est pas proposée pour ce service.' });
  }
  if (mode === 'VIDEO' && body.videoConsent !== true) {
    return res.status(400).json({ error: 'VIDEO_CONSENT_REQUIRED', code: 'VIDEO_CONSENT_REQUIRED', message: 'Pour un rendez-vous en visio, confirmez votre accord (caméra et micro, sans enregistrement).' });
  }

  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const dayStart = startOfUtcDay(startAt);
  const dayEnd = endOfUtcDay(startAt);

  const rules = rulesFor(await db.query.ProAvailabilityRule.findMany({
    where: (r, { eq, and }) => and(eq(r.structureId, structure.id), eq(r.isActive, true)),
    orderBy: (r, { asc }) => [asc(r.weekday), asc(r.startTime)],
  }), mode);

  const appointmentsForDay = await findOverlappingAppointments(db, {
    structureId: structure.id,
    statuses: ACTIVE_APPOINTMENT_STATUSES,
    startBefore: dayEnd,
    endAfter: dayStart,
  });

  const timeOffs = await findOverlappingTimeOffs(db, {
    structureId: structure.id,
    startBefore: dayEnd,
    endAfter: dayStart,
  });

  const busyWindows = [
    ...toBusyWindows(appointmentsForDay),
    ...timeOffs.map((timeOff) => ({ start: timeOff.startAt, end: timeOff.endAt })),
  ];

  const availableSlots = generateSlots({
    rules,
    from: dayStart,
    to: dayEnd,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    busyWindows,
    maxSlots: 600,
  });

  const slotExists = availableSlots.some((slot) => slot.startAt === startAt.toISOString() && slot.endAt === endAt.toISOString());
  if (!slotExists) {
    return res.status(409).json({ error: 'Slot no longer available' });
  }

  const bookingLockKey = `${structure.id}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(startAt)}`;   // R12: the Paris day of the slot (was the UTC day)

  // The confirmation e-mail is sent AFTER the transaction commits: a slow/hung provider must not hold the
  // per-structure/day advisory lock and a DB connection, and no mail may announce a rolled-back booking.
  let deferredConfirmationEmail = null;
  // R12: the answer is sent AFTER the transaction committed (it used to be sent from inside it: a failed COMMIT had already told the person « booked »)
  const reply = (status, body) => ({ __reply: true, status, body });
  let outcome;
  try {
  outcome = await withBookingCollisionLock(bookingLockKey, async () => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${bookingLockKey}, 0))`);
    try {
      // DTA S8: the idempotency pre-check above runs BEFORE the lock. Two requests with the same key (double click, retry after a timeout, two processes) can both pass it;
      // the second then finds the first one's COMMITTED appointment as an overlap and would answer 409 for a booking that did succeed. Re-check under the lock: same key => replay.
      const replayUnderLock = await loadAppointmentWithRelations(null, { citizenUserId: auth.user.id, idempotencyKey });
      if (replayUnderLock) {
        return reply(200, createConfirmedAppointmentPayload(replayUnderLock, { citizenUserId: auth.user.id }).payload);
      }
      // The local-release lock serializes same-structure/day booking mutations.
      // The unique constraint on (citizenUserId, idempotencyKey) still prevents retry duplicates.

    // 1. Check overlapping appointments
    const overlaps = await tx
      .select()
      .from(schema.ProAppointment)
      .where(
        and(
          eq(schema.ProAppointment.structureId, structure.id),
          inArray(schema.ProAppointment.status, ACTIVE_APPOINTMENT_STATUSES),
          lt(schema.ProAppointment.startAt, endAt),
          gt(schema.ProAppointment.endAt, startAt),
        ),
      );

    // Load service buffers for overlap check
    const overlapsWithService = await Promise.all(
      overlaps.map(async (appt) => {
        const svc = appt.serviceId
          ? await tx
              .select({
                bufferBeforeMinutes: schema.ProRdvService.bufferBeforeMinutes,
                bufferAfterMinutes: schema.ProRdvService.bufferAfterMinutes,
              })
              .from(schema.ProRdvService)
              .where(eq(schema.ProRdvService.id, appt.serviceId))
              .then((rows) => rows[0] || null)
          : null;
        return { ...appt, service: svc };
      }),
    );

    const overlapBusyWindows = toBusyWindows(overlapsWithService);
    const candidateBusyStart = new Date(startAt.getTime() - service.bufferBeforeMinutes * 60_000);
    const candidateBusyEnd = new Date(endAt.getTime() + service.bufferAfterMinutes * 60_000);
    const hasConflict = overlapBusyWindows.some((window) => candidateBusyStart < window.end && window.start < candidateBusyEnd);

    if (hasConflict) {
      return reply(409, { error: 'Slot no longer available' });
    }

    // 2. Check time-offs
    const [timeOffCount] = await tx
      .select({ value: count() })
      .from(schema.ProTimeOff)
      .where(
        and(
          eq(schema.ProTimeOff.structureId, structure.id),
          isNull(schema.ProTimeOff.proUserId),   // R24: closures of the structure only
          lt(schema.ProTimeOff.startAt, endAt),
          gt(schema.ProTimeOff.endAt, startAt),
        ),
      );

    if (Number(timeOffCount.value) > 0) {
      return reply(409, { error: 'Slot no longer available' });
    }

    // 3. Insert appointment (unique constraint on citizenUserId+idempotencyKey catches races)
    const [createdAppointment] = await tx.insert(schema.ProAppointment).values({
      structureId: structure.id,
      serviceId: service.id,
      startAt,
      endAt,
      status: 'confirmed',
      beneficiaryName: 'Particulier',
      beneficiaryPhone: null,
      notes: null,
      citizenUserId: auth.user.id,
      citizenEmailSnapshot: auth.user.email,
      idempotencyKey,
      visioEnabled: false,
      mode,
      visioCitizenConsentAt: mode === 'VIDEO' ? new Date() : null,
    }).returning();

      // The new row is not committed yet, so a read through the global pool cannot see it
      // (it returned undefined, leaving `structure`/`service`/`calendar` null in the 201 payload).
      // Compose the relations from the rows already loaded in this request instead.
      const fullAppointment = {
        ...createdAppointment,
        structure: { id: structure.id, slug: structure.slug, nom: structure.nom, adresse: structure.adresse, code_postal: structure.code_postal, ville: structure.ville, accessibilite_pmr: structure.accessibilite_pmr, verification_status: structure.verification_status },
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
      };
      const appointmentForResponse = fullAppointment || createdAppointment;
      const confirmed = createConfirmedAppointmentPayload(appointmentForResponse, {
        citizenUserId: auth.user.id,
        structureSlug: fullAppointment?.structure?.slug || structure.slug,
      });

      deferredConfirmationEmail = {
        appointment: appointmentForResponse,
        structureName: fullAppointment?.structure?.nom || structure.nom,
        structureSlug: fullAppointment?.structure?.slug || structure.slug,
        serviceName: fullAppointment?.service?.name || service.name,
        toEmail: auth.user.email,
        confirmationToken: confirmed.confirmation.token,
      };

      return reply(201, confirmed.payload);
  } catch (error) {
    // Drizzle wraps pg errors in error.cause
    const pgCode = error?.cause?.code || error?.code;
    if (pgCode === '23505') {
      const existing = await loadAppointmentWithRelations(null, {
        citizenUserId: auth.user.id,
        idempotencyKey,
      });

      if (existing) {
        const confirmed = createConfirmedAppointmentPayload(existing, {
          citizenUserId: auth.user.id,
        });
        return reply(200, confirmed.payload);
      }
      return reply(409, { error: 'Slot no longer available' });
    }

      return reply(500, { error: 'Internal Server Error' });
    }

    });
  });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.cause?.code || error?.code } }, '[rdv] booking transaction failed');
    deferredConfirmationEmail = null;
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  if (deferredConfirmationEmail && outcome?.__reply && outcome.status === 201) {
    try {
      await sendAppointmentConfirmationEmail(deferredConfirmationEmail);
    } catch {
      // Email is best-effort: booking must stay successful even if provider is unavailable.
    }
  }
  if (outcome?.__reply) return res.status(outcome.status).json(outcome.body);
  return outcome;
}

/**
 * Token-only confirmation lookup.
 * Invalid, expired, mismatched and malformed tokens all fail closed with the
 * same not-found response so the endpoint does not disclose appointment state.
 *
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function getAppointmentConfirmation(req, res) {
  const segments = getPathSegments(req);
  const appointmentId = toTrimmedString(segments[1]);
  const token = toTrimmedString(req.body?.token);

  if (!appointmentId || !token) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const rateLimit = await enforcePublicRdvRateLimit(
    req,
    'read',
    `confirmation:${digestIdentifier(token).slice(0, 24)}`,
  );
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }

  const appointment = await loadAppointmentWithRelations(appointmentId);
  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const verified = verifyAppointmentConfirmationToken(token, {
    appointmentId: appointment.id,
    citizenUserId: appointment.citizenUserId,
  });
  if (!verified.ok) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  return res.status(200).json(
    serializeAppointment(appointment, {
      structureSlug: appointment?.structure?.slug || '',
      confirmationToken: token,
      confirmationExpiresAt: verified.expiresAt,
      includeCalendar: true,
    }),
  );
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function getAppointment(req, res) {
  const segments = getPathSegments(req);
  const appointmentId = toTrimmedString(segments[1]);
  if (!appointmentId) {
    return res.status(400).json({ error: 'Appointment id is required' });
  }

  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }

  const rateLimit = await enforcePublicRdvRateLimit(req, 'read', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }

  const appointment = await loadAppointmentWithRelations(appointmentId);

  // R12: someone else's appointment answers exactly like an unknown one (no existence oracle)
  if (!appointment || appointment.citizenUserId !== auth.user.id) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  return res.status(200).json(serializeAppointment(appointment));
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function cancelAppointment(req, res) {
  const segments = getPathSegments(req);
  const appointmentId = toTrimmedString(segments[1]);
  if (!appointmentId) {
    return res.status(400).json({ error: 'Appointment id is required' });
  }

  // R12 (B04): the link of the confirmation e-mail (capability token, in the page fragment, sent in the POST body only) cancels too — before, only a signed-in
  // account could, so « annuler depuis le lien du message » did not exist. The token is bound to this appointment and its owner, and expires.
  const token = toTrimmedString(req.body?.token);
  let appointment;
  if (token) {
    const rateLimit = await enforcePublicRdvRateLimit(req, 'write', `cancel-token:${digestIdentifier(token).slice(0, 24)}`);
    if (!rateLimit.allowed) return res.status(rateLimit.status).json(rateLimit.error);
    appointment = await loadAppointmentWithRelations(appointmentId);
    const verified = appointment ? verifyAppointmentConfirmationToken(token, { appointmentId: appointment.id, citizenUserId: appointment.citizenUserId }) : { ok: false };
    if (!appointment || !verified.ok) return res.status(404).json({ error: 'Appointment not found' });
  } else {
    const auth = await requireCitizenUser(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    }

    const rateLimit = await enforcePublicRdvRateLimit(req, 'write', auth.user.id);
    if (!rateLimit.allowed) {
      return res.status(rateLimit.status).json(rateLimit.error);
    }

    appointment = await loadAppointmentWithRelations(appointmentId);

    // R12: someone else's appointment answers exactly like an unknown one (no existence oracle)
    if (!appointment || appointment.citizenUserId !== auth.user.id) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
  }

  if (String(appointment.status || '').toLowerCase() === 'cancelled') {
    return res.status(200).json(serializeAppointment(appointment));
  }

  const cancelled = await db.update(schema.ProAppointment).set({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy: 'USER',
  }).where(and(eq(schema.ProAppointment.id, appointment.id), sql`${schema.ProAppointment.status} <> 'cancelled'`)).returning({ id: schema.ProAppointment.id });

  // Reload with relations after update
  const updated = await loadAppointmentWithRelations(appointment.id);
  // PKG-3 / B04: the structure is told, and the person gets a confirmation with a calendar CANCEL (once: only the request that really cancelled it)
  if (cancelled.length && updated) {
    const when = formatParis(updated.startAt);
    const structureName = updated.structure?.nom || 'la structure';
    await noticeStructure(updated, 'CANCELLED_BY_CITIZEN', { title: 'Rendez-vous annulé par la personne', text: `Le rendez-vous du ${when} a été annulé par la personne. Le créneau est de nouveau libre.` });
    await noticeCitizen(updated, 'CANCELLED_BY_CITIZEN', {
      subject: `Annulation confirmée - ${structureName}`,
      text: `Votre rendez-vous du ${when} (Europe/Paris) avec ${structureName} est annulé.\n\nPour reprendre rendez-vous : ${buildAppUrl('/compte/rendez-vous')}`,
      calendar: { appointmentId: updated.id, startAt: updated.startAt, endAt: updated.endAt, structureName, serviceName: updated.service?.name || 'Rendez-vous', sequence: Number(updated.rescheduleCount || 0) + 1, cancelled: true },
    });
  }

  return res.status(200).json(serializeAppointment(updated || appointment));
}

/**
 * PKG-3 — my appointments (newest first, at most 50), each with what the D-2 policy still allows. GET /api/rdv/appointments
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function listMyAppointments(req, res) {
  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }
  const rateLimit = await enforcePublicRdvRateLimit(req, 'read', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }
  const rows = await db.query.ProAppointment.findMany({
    where: (a, { eq }) => eq(a.citizenUserId, auth.user.id),
    orderBy: (a, { desc }) => [desc(a.startAt)],
    limit: 50,
    with: {
      service: { columns: { id: true, name: true, durationMinutes: true } },
      structure: { columns: { id: true, slug: true, nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true, verification_status: true } },
    },
  });
  const now = Date.now();
  return res.status(200).json({
    appointments: rows.map((a) => {
      const active = RESCHEDULABLE_STATUSES.includes(String(a.status || '').toLowerCase());
      const upcoming = new Date(a.startAt).getTime() > now;
      const inTime = new Date(a.startAt).getTime() - now >= RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000;
      // R12 (C19): an active upcoming appointment carries its calendar file (« Ajouter au calendrier » in Mes rendez-vous)
      return { ...serializeAppointment(a, { includeCalendar: active && upcoming }), canCancel: active && upcoming, canReschedule: active && inTime && Number(a.rescheduleCount || 0) < MAX_RESCHEDULES };
    }),
  });
}

/**
 * PKG-3 / B07 — video of MY appointment. POST /api/rdv/appointments/:id/visio { action: 'consent' | 'withdraw' | 'join' }
 * Only the person of the appointment. 'join' returns a room-bound, time-bound token (no-store JSON, never a URL) when: the provider is activated, the appointment is a VIDEO
 * one, active, approved by the structure, consented by the person, and now is inside the join window. Every refusal says why; nothing is logged with the token or the room.
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function citizenVisio(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const appointmentId = toTrimmedString(getPathSegments(req)[1]);
  const auth = await requireCitizenUser(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  const rateLimit = await enforcePublicRdvRateLimit(req, 'write', auth.user.id);
  if (!rateLimit.allowed) return res.status(rateLimit.status).json(rateLimit.error);
  const appointment = appointmentId ? await loadAppointmentWithRelations(appointmentId) : null;
  if (!appointment || appointment.citizenUserId !== auth.user.id) return res.status(404).json({ error: 'Appointment not found' });
  if (appointment.mode !== 'VIDEO') return res.status(409).json({ error: 'NOT_A_VIDEO_APPOINTMENT', code: 'NOT_A_VIDEO_APPOINTMENT', message: 'Ce rendez-vous a lieu en présentiel.' });
  const action = toTrimmedString(req.body?.action);
  if (action === 'consent' || action === 'withdraw') {
    await db.update(schema.ProAppointment).set({ visioCitizenConsentAt: action === 'consent' ? new Date() : null }).where(eq(schema.ProAppointment.id, appointment.id));
    return res.status(200).json(serializeAppointment(await loadAppointmentWithRelations(appointment.id)));
  }
  if (action !== 'join') return res.status(400).json({ error: 'INVALID_ACTION' });
  const refusal = joinRefusal(appointment);
  if (refusal) return res.status(refusal.status).json({ error: refusal.code, code: refusal.code, message: refusal.message, ...(refusal.opensAt ? { opensAt: refusal.opensAt } : {}) });
  return res.status(200).json({ join: issueJoin(appointment, 'citizen') });
}

/**
 * PKG-3 / D-2 — move my appointment to another free slot of the same structure and service.
 * Allowed while the CURRENT appointment starts at least RESCHEDULE_MIN_NOTICE_HOURS later and at most MAX_RESCHEDULES times (also a DB CHECK). The new slot is validated
 * and taken in the SAME transaction that releases the old one, under the booking locks of both days (taken in a fixed order: no deadlock): either the appointment moves or
 * nothing changes. The J-1 reminder is re-armed for the new time; the confirmation e-mail is sent after the commit (best effort).
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
async function rescheduleAppointment(req, res) {
  const segments = getPathSegments(req);
  const appointmentId = toTrimmedString(segments[1]);
  const auth = await requireCitizenUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }
  const rateLimit = await enforcePublicRdvRateLimit(req, 'write', auth.user.id);
  if (!rateLimit.allowed) {
    return res.status(rateLimit.status).json(rateLimit.error);
  }
  const startAt = new Date(toTrimmedString(req.body?.startAt));
  if (!appointmentId || Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ error: 'Appointment id and a valid startAt are required' });
  }
  const appointment = await loadAppointmentWithRelations(appointmentId);
  // R12: someone else's appointment answers exactly like an unknown one (no existence oracle)
  if (!appointment || appointment.citizenUserId !== auth.user.id) return res.status(404).json({ error: 'Appointment not found' });

  const refuse = (row) => {
    if (!RESCHEDULABLE_STATUSES.includes(String(row.status || '').toLowerCase())) return { status: 409, code: 'APPOINTMENT_NOT_ACTIVE', error: 'Ce rendez-vous ne peut plus être modifié.' };
    if (new Date(row.startAt).getTime() - Date.now() < RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000) return { status: 409, code: 'RESCHEDULE_TOO_LATE', error: `Un rendez-vous peut être déplacé au plus tard ${RESCHEDULE_MIN_NOTICE_HOURS} heures avant. Contactez la structure.` };
    if (Number(row.rescheduleCount || 0) >= MAX_RESCHEDULES) return { status: 409, code: 'RESCHEDULE_LIMIT', error: `Ce rendez-vous a déjà été déplacé ${MAX_RESCHEDULES} fois. Contactez la structure.` };
    return null;
  };
  const early = refuse(appointment);
  if (early) return res.status(early.status).json({ error: early.code, code: early.code, message: early.error });

  const now = new Date();
  if (startAt < new Date(now.getTime() + MIN_BOOKING_DELAY_MINUTES * 60_000) || startAt > addDaysUtc(now, MAX_BOOKING_AHEAD_DAYS)) {
    return res.status(400).json({ error: 'startAt out of allowed range' });
  }
  if (startAt.getTime() === new Date(appointment.startAt).getTime()) {
    return res.status(400).json({ error: 'SAME_SLOT', code: 'SAME_SLOT', message: 'Choisissez un autre créneau que l’actuel.' });
  }
  const structure = appointment.structure?.slug ? await loadStructureBySlug(appointment.structure.slug) : null;
  if (!structure) return res.status(404).json({ error: 'RDV indisponible' });
  // PKG-5 / E01: the existing appointment stays (it can be cancelled); moving it to a NEW slot needs an organization that can take new bookings
  if (!structure.bookable) return res.status(409).json({ error: 'ORGANIZATION_NOT_BOOKABLE', code: 'ORGANIZATION_NOT_BOOKABLE', message: 'Cette structure ne prend pas de nouveaux rendez-vous pour le moment. Vous pouvez annuler ce rendez-vous ou contacter la structure.' });
  const service = appointment.serviceId ? await db.query.ProRdvService.findFirst({
    where: (s, { eq, and }) => and(eq(s.id, appointment.serviceId), eq(s.structureId, structure.id), eq(s.isActive, true)),
    columns: { id: true, name: true, durationMinutes: true, bufferBeforeMinutes: true, bufferAfterMinutes: true, modes: true },
  }) : null;
  if (!service) return res.status(404).json({ error: 'Service not found' });
  // PKG-3: the modality is KEPT unless the person explicitly asks for another one that is offered now (video needs their agreement). Changing it withdraws any
  // video approval (the structure validates video again) — it is never changed silently.
  const currentMode = appointment.mode || 'IN_PERSON';
  const mode = req.body?.mode === undefined ? currentMode : normalizeMode(req.body.mode);
  if (!mode) return res.status(400).json({ error: 'MODE_UNAVAILABLE', code: 'MODE_UNAVAILABLE', message: 'Modalité inconnue.' });
  if (mode !== currentMode) {
    if (!offeredModes(structure.bookingMode, service.modes, publicVideoStatus()).includes(mode)) {
      return res.status(409).json({ error: 'MODE_UNAVAILABLE', code: 'MODE_UNAVAILABLE', message: 'Cette modalité n’est pas proposée pour ce service.' });
    }
    if (mode === 'VIDEO' && req.body?.videoConsent !== true) {
      return res.status(400).json({ error: 'VIDEO_CONSENT_REQUIRED', code: 'VIDEO_CONSENT_REQUIRED', message: 'Pour passer en visio, confirmez votre accord (caméra et micro, sans enregistrement).' });
    }
  }

  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const dayStart = startOfUtcDay(startAt);
  const dayEnd = endOfUtcDay(startAt);
  const rules = rulesFor(await db.query.ProAvailabilityRule.findMany({
    where: (r, { eq, and }) => and(eq(r.structureId, structure.id), eq(r.isActive, true)),
    orderBy: (r, { asc }) => [asc(r.weekday), asc(r.startTime)],
  }), mode);
  const others = (await findOverlappingAppointments(db, { structureId: structure.id, statuses: ACTIVE_APPOINTMENT_STATUSES, startBefore: dayEnd, endAfter: dayStart }))
    .filter((a) => a.id !== appointment.id);   // the appointment being moved does not block its own new slot
  const timeOffs = await findOverlappingTimeOffs(db, { structureId: structure.id, startBefore: dayEnd, endAfter: dayStart });
  const slots = generateSlots({ rules, from: dayStart, to: dayEnd, durationMinutes: service.durationMinutes, bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes, busyWindows: [...toBusyWindows(others), ...timeOffs.map((t) => ({ start: t.startAt, end: t.endAt }))], maxSlots: 600 });
  if (!slots.some((slot) => slot.startAt === startAt.toISOString() && slot.endAt === endAt.toISOString())) {
    return res.status(409).json({ error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' });
  }

  const keys = [...new Set([`${structure.id}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(appointment.startAt))}`, `${structure.id}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(startAt)}`])].sort();   // R14: the Paris day, as the booking lock (was the UTC day: two locks for one slot near midnight)
  const withLocks = (i, task) => (i >= keys.length ? task() : withBookingCollisionLock(keys[i], () => withLocks(i + 1, task)));
  let moved = null;
  const outcome = await withLocks(0, () => db.transaction(async (tx) => {
    for (const k of keys) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${k}, 0))`);
    // re-check everything under the locks, on the row itself (FOR UPDATE)
    const [row] = (await tx.execute(sql`SELECT id, status, "startAt", "citizenUserId", "rescheduleCount" FROM "ProAppointment" WHERE id = ${appointment.id} FOR UPDATE`)).rows;
    if (!row || row.citizenUserId !== auth.user.id) return { status: 404, body: { error: 'Appointment not found' } };
    const late = refuse(row);
    if (late) return { status: late.status, body: { error: late.code, code: late.code, message: late.error } };
    const overlaps = (await tx.select().from(schema.ProAppointment).where(and(eq(schema.ProAppointment.structureId, structure.id), inArray(schema.ProAppointment.status, ACTIVE_APPOINTMENT_STATUSES),
      lt(schema.ProAppointment.startAt, new Date(endAt.getTime() + 24 * 3_600_000)), gt(schema.ProAppointment.endAt, new Date(startAt.getTime() - 24 * 3_600_000))))).filter((a) => a.id !== appointment.id);
    const withSvc = await Promise.all(overlaps.map(async (a) => ({ ...a, service: a.serviceId ? (await tx.select({ bufferBeforeMinutes: schema.ProRdvService.bufferBeforeMinutes, bufferAfterMinutes: schema.ProRdvService.bufferAfterMinutes })
      .from(schema.ProRdvService).where(eq(schema.ProRdvService.id, a.serviceId)))[0] || null : null })));
    const busyStart = new Date(startAt.getTime() - service.bufferBeforeMinutes * 60_000); const busyEnd = new Date(endAt.getTime() + service.bufferAfterMinutes * 60_000);
    if (toBusyWindows(withSvc).some((w) => busyStart < w.end && w.start < busyEnd)) return { status: 409, body: { error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' } };
    const [off] = await tx.select({ value: count() }).from(schema.ProTimeOff).where(and(eq(schema.ProTimeOff.structureId, structure.id), isNull(schema.ProTimeOff.proUserId), lt(schema.ProTimeOff.startAt, endAt), gt(schema.ProTimeOff.endAt, startAt)));   // R24: closures only
    if (Number(off.value) > 0) return { status: 409, body: { error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' } };
    const [updated] = await tx.update(schema.ProAppointment).set({ startAt, endAt, rescheduleCount: Number(row.rescheduleCount || 0) + 1, rescheduledAt: new Date(), reminder_sent_at: null, reminder_locked_at: null,
      ...(mode !== currentMode ? { mode, visioApprovedAt: null, visioApprovedByProUserId: null, visioRoomId: null, visioEnabled: false, visioCitizenConsentAt: mode === 'VIDEO' ? new Date() : null } : {}) })
      .where(and(eq(schema.ProAppointment.id, appointment.id), eq(schema.ProAppointment.rescheduleCount, Number(row.rescheduleCount || 0)))).returning();
    if (!updated) return { status: 409, body: { error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' } };
    moved = { ...updated, structure: appointment.structure, service: appointment.service };   // structure carries the address fields (loader)
    return { status: 200, body: null };
  }));
  if (!moved) return res.status(outcome.status).json(outcome.body);
  const confirmed = createConfirmedAppointmentPayload(moved, { citizenUserId: auth.user.id, structureSlug: structure.slug });
  // PKG-3 / B05: the person gets the new time with an UPDATED calendar event (same UID, higher SEQUENCE); the structure is told (old and new time, nothing else)
  const before = formatParis(appointment.startAt); const after = formatParis(moved.startAt);
  await noticeCitizen(moved, 'RESCHEDULED', {
    subject: `Rendez-vous déplacé - ${structure.nom}`,
    text: `Votre rendez-vous avec ${structure.nom} (${service.name}) est déplacé :\nancien créneau : ${before}\nnouveau créneau : ${after} (Europe/Paris)\n${modalityText(moved)}\n\nGérer mes rendez-vous : ${buildAppUrl('/compte/rendez-vous')}`,
    calendar: { appointmentId: moved.id, startAt: moved.startAt, endAt: moved.endAt, structureName: structure.nom, serviceName: service.name, sequence: Number(moved.rescheduleCount || 0), location: icsLocation(moved) },
  });
  await noticeStructure(moved, 'RESCHEDULED', { title: 'Rendez-vous déplacé par la personne', text: `Un rendez-vous a été déplacé par la personne : du ${before} au ${after} (${modeLabel(moved.mode)}${mode !== currentMode ? ', modalité changée par la personne' : ''}).` });
  return res.status(200).json(confirmed.payload);
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const method = String(req.method || 'GET').toUpperCase();
  const segments = getPathSegments(req);

  try {
    if (method === 'GET' && segments[0] === 'structures' && segments[2] === 'services') {
      return await getServices(req, res);
    }

    if (method === 'GET' && segments[0] === 'structures' && segments[2] === 'slots') {
      return await getSlots(req, res);
    }

    if (method === 'GET' && segments[0] === 'appointments' && segments.length === 1) {
      return await listMyAppointments(req, res);
    }

    if (method === 'POST' && segments[0] === 'appointments' && segments.length === 1) {
      return await createAppointment(req, res);
    }

    if (
      method === 'POST'
      && segments[0] === 'appointments'
      && segments[2] === 'confirmation'
      && segments.length === 3
    ) {
      return await getAppointmentConfirmation(req, res);
    }

    if (method === 'GET' && segments[0] === 'appointments' && segments.length === 2) {
      return await getAppointment(req, res);
    }

    if (method === 'POST' && segments[0] === 'appointments' && segments[2] === 'cancel') {
      return await cancelAppointment(req, res);
    }

    if (method === 'POST' && segments[0] === 'appointments' && segments[2] === 'visio' && segments.length === 3) {
      return await citizenVisio(req, res);
    }

    if (method === 'POST' && segments[0] === 'appointments' && segments[2] === 'reschedule' && segments.length === 3) {
      return await rescheduleAppointment(req, res);
    }

    return res.status(404).json({ error: 'Not Found' });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
