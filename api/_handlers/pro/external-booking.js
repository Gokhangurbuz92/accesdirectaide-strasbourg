// @ts-check
import { db } from '../../../src/db/index.js';
import { AUTH_ROLE, logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { NOT_AVAILABLE, externalBookingAvailable, readExternalBooking, removeExternalBooking, submitExternalBooking } from '../../_services/external-booking.js';
import { PLATFORMS, externalBookingMode } from '../../lib/external-booking.js';

/**
 * G14 release 3 — /api/pro/rdv/external-booking: « we take appointments on our own system ». Surface « appointments » (pro/rdv), capability pro.agenda.
 *   GET     any member: the structure's record (url, platform, needs, status PENDING / APPROVED / REJECTED, the review note) and whether it is shown publicly
 *   PUT     structure administrators: { url, subdomains? } — https only, no credentials, no person's data (api/lib/external-booking.js); a new or changed page
 *           is PENDING until an AccesDirectAide administrator approves it (nothing is published by this route)
 *   DELETE  structure administrators: removes the page
 * 503 EXTERNAL_BOOKING_NOT_AVAILABLE while the database has no migration 0063. Journaled (identifiers only).
 */
const MESSAGES = {
  URL_REQUIRED: 'Indiquez l’adresse de votre page de rendez-vous.', URL_TOO_LONG: 'Adresse trop longue.', URL_INVALID: 'Adresse invalide.',
  HTTPS_REQUIRED: 'L’adresse doit commencer par https://.', CREDENTIALS_IN_URL: 'L’adresse ne doit contenir ni identifiant ni mot de passe.',
  HOST_NOT_PUBLIC: 'L’adresse doit être celle d’un site public.', PERSONAL_DATA_IN_URL: 'L’adresse ne doit contenir aucune donnée personnelle (e-mail, nom, téléphone, jeton…).',
  NEEDS_INVALID: 'Besoins : une liste d’identifiants de la taxonomie.', NEEDS_UNKNOWN: 'Besoin inconnu de la taxonomie.', NEEDS_TOO_MANY: 'Au plus 8 besoins.',
};

/** @param {any} req @param {any} res */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, PUT, DELETE'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!(await externalBookingAvailable(db))) return res.status(NOT_AVAILABLE.status).json({ error: NOT_AVAILABLE.code, code: NOT_AVAILABLE.code, message: NOT_AVAILABLE.message });
  const mode = externalBookingMode();
  if (req.method === 'GET') {
    const r = await readExternalBooking(ctx.structureId, db);
    const record = r ? { url: r.url, platform: r.platform, subdomains: r.subdomains || [], status: r.status, source: r.source, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt,
      reviewNote: r.status === 'REJECTED' ? r.reviewNote : null } : null;
    const shownPublicly = Boolean(r && r.status === 'APPROVED' && (mode === 'open' || (mode === 'platforms' && r.platform !== 'other')));
    return res.status(200).json({ record, shownPublicly, publicDisplay: mode, platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, hosts: p.hosts })) });
  }
  if (ctx.role !== AUTH_ROLE.STRUCTURE_ADMIN && ctx.role !== AUTH_ROLE.SUPERADMIN) return res.status(403).json({ error: 'Forbidden' });
  if (req.method === 'DELETE') {
    const out = await removeExternalBooking(ctx.structureId, ctx.userId, db);
    if (!out.ok) return res.status(out.status).json({ error: out.code, code: out.code });
    await logProAudit('EXTERNAL_BOOKING_REMOVED', ctx.userId, ctx.structureId, {}, clientIp(req));
    return res.status(200).json({ ok: true });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const out = await submitExternalBooking({ structureId: ctx.structureId, url: body.url, subdomains: body.subdomains, source: 'PRO', by: ctx.userId }, db);
  if (!out.ok) return res.status(out.status).json({ error: MESSAGES[/** @type {keyof typeof MESSAGES} */ (out.code)] || out.code, code: out.code });
  if (out.changed) await logProAudit('EXTERNAL_BOOKING_SUBMITTED', ctx.userId, ctx.structureId, { platform: out.record?.platform || null }, clientIp(req));
  const r = out.record;
  return res.status(200).json({ record: { url: r.url, platform: r.platform, subdomains: r.subdomains || [], status: r.status, source: r.source, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, reviewNote: null },
    changed: out.changed });
}

export default withProRdvHandler('pro.external-booking', handler);
