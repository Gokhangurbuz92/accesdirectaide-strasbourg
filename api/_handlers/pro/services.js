// @ts-nocheck
import logger from '../../_utils/logger.js';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProRdvService } from '../../../src/db/schema.js';
import { AUTH_ROLE, logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { MODES } from '../../lib/appointment-modes.js';
import { bookingReachSchema, requestGuestSchema, serviceTable } from '../../_utils/schema-features.js';
import { parseServiceSubdomains } from '../../lib/service-needs.js';
import { readServiceNeeds, writeServiceNeeds } from '../../_services/service-needs.js';

/**
 * /api/pro/services — the appointment services (motifs) of the professional's structure.
 * GET: list (any member).  POST / PATCH ?id= / DELETE ?id=: structure admins only (same rule as the RDV settings).
 * PKG-3 / B01: this route used to be GET-only, so the Services screen could never create, edit or deactivate a service. Each service declares the modalities it is offered in
 * (modes: IN_PERSON and/or VIDEO); what a citizen can book is that intersected with the structure's booking mode and the video activation (api/lib/appointment-modes.js).
 * A service with appointments is never deleted (409: deactivate it instead), so no appointment loses its service.
 * G14 release 3: `subdomains` — the needs the service answers (ids of the 20 × 86 taxonomy, at most MAX_SERVICE_SUBDOMAINS; api/lib/service-needs.js),
 * stored in "ProRdvServiceSubdomain" (drizzle/0063). GET returns them per service and `needsAvailable`; without 0063 a non-empty list is refused 409
 * SERVICE_NEEDS_NOT_AVAILABLE (the editor hides the picker) and an empty one is ignored.
 */
const int = (v, dflt, min, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
function readService(body, current = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  if (b.name !== undefined || current.name === undefined) {
    const name = String(b.name ?? '').trim();
    if (name.length < 2 || name.length > 120) return { error: 'Le nom du service doit faire 2 à 120 caractères.' };
    out.name = name;
  }
  if (b.durationMinutes !== undefined || current.durationMinutes === undefined) out.durationMinutes = int(b.durationMinutes, 30, 5, 480);
  if (b.bufferBeforeMinutes !== undefined) out.bufferBeforeMinutes = int(b.bufferBeforeMinutes, 0, 0, 240);
  if (b.bufferAfterMinutes !== undefined) out.bufferAfterMinutes = int(b.bufferAfterMinutes, 0, 0, 240);
  if (b.isActive !== undefined) out.isActive = Boolean(b.isActive);
  // R38: bookable without an account — R42: retired; only « false » is still accepted (an explicit boolean)
  if (b.guestBookable !== undefined) {
    if (typeof b.guestBookable !== 'boolean') return { error: 'guestBookable doit être vrai ou faux.' };
    out.guestBookable = b.guestBookable;
  }
  if (b.modes !== undefined) {
    const modes = [...new Set(Array.isArray(b.modes) ? b.modes.map((m) => String(m).toUpperCase()) : [])];
    if (!modes.length || modes.some((m) => !MODES.includes(m))) return { error: 'Choisissez au moins une modalité (présentiel et/ou visio).' };
    out.modes = modes;
  }
  return { value: out };
}

const NEEDS_MESSAGES = { NEEDS_INVALID: 'Besoins : une liste d’identifiants de la taxonomie.', NEEDS_UNKNOWN: 'Besoin inconnu de la taxonomie.', NEEDS_TOO_MANY: 'Au plus 8 besoins par service.' };
/** the needs of the body, or undefined (no change) / an error @param {any} body @param {{ needs: boolean }} reach */
function readNeeds(body, reach) {
  if (!body || typeof body !== 'object' || body.subdomains === undefined) return { value: undefined };
  const parsed = parseServiceSubdomains(body.subdomains);
  if (!parsed.ok) return { status: 400, body: { error: NEEDS_MESSAGES[parsed.code], code: parsed.code } };
  if (!reach.needs) return parsed.value.length ? { status: 409, body: { error: 'Les besoins ne sont pas encore installés sur ce serveur.', code: 'SERVICE_NEEDS_NOT_AVAILABLE' } } : { value: undefined };
  return { value: parsed.value };
}

const GUEST_RETIRED = Object.freeze({ error: 'GUEST_BOOKING_RETIRED', code: 'GUEST_BOOKING_RETIRED', message: 'La réservation sans compte n’existe plus : un compte est nécessaire pour demander un rendez-vous.' });

async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return undefined;
  const { structureId, role } = proCtx;
  try {
    // R41-B: before migration 0043 (Production 0042) the table has no guestBookable column: it is never named (insert, select, returning)
    const features = await requestGuestSchema(db);
    const T = serviceTable(features);
    if (req.method === 'GET') {
      const services = await db.select().from(T).where(eq(ProRdvService.structureId, structureId)).orderBy(ProRdvService.name);
      const reach = await bookingReachSchema(db);
      const needs = reach.needs ? await readServiceNeeds(db, services.map((x) => x.id)) : new Map();
      return res.status(200).json({ items: services.map((x) => ({ ...x, subdomains: needs.get(x.id) || [] })), total: services.length, needsAvailable: reach.needs });
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (role !== AUTH_ROLE.STRUCTURE_ADMIN && role !== AUTH_ROLE.SUPERADMIN) return res.status(403).json({ error: 'Forbidden' });
    // R12 (E04): a catalogue change is journaled (who changed which service) and clears the cached search results that list services
    const changed = async (action, serviceId) => {
      await logProAudit(action, proCtx.userId, structureId, { serviceId }, clientIp(req));
      await bumpContentEpoch().catch(() => {});
    };
    const reach = req.method === 'DELETE' ? { needs: false, external: false } : await bookingReachSchema(db);
    const needs = req.method === 'DELETE' ? { value: undefined } : readNeeds(req.body, reach);
    if (needs.status) return res.status(needs.status).json(needs.body);
    if (req.method === 'POST') {
      const parsed = readService(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      // R42 (DEC-R42-01): account-free booking is retired — « yes » is refused everywhere; « no » is already true (written only where the 0043 column exists)
      if (parsed.value.guestBookable === true) return res.status(409).json(GUEST_RETIRED);
      if (!features.guestBooking) delete parsed.value.guestBookable;
      const [row] = await db.insert(T).values({ structureId, modes: ['IN_PERSON'], ...parsed.value }).returning();
      if (needs.value) await writeServiceNeeds(db, row.id, needs.value);
      await changed('RDV_SERVICE_CREATED', row.id);
      return res.status(201).json({ item: { ...row, subdomains: (needs.value || []).map((x) => x.subdomain) } });
    }
    const id = String(req.query?.id || '').trim();
    const [current] = id ? await db.select().from(T).where(and(eq(ProRdvService.id, id), eq(ProRdvService.structureId, structureId))).limit(1) : [];
    if (!current) return res.status(404).json({ error: 'Service not found' });
    if (req.method === 'PATCH') {
      const parsed = readService(req.body, current);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      // R42 (DEC-R42-01): account-free booking is retired — « yes » is refused everywhere; « no » is already true (written only where the 0043 column exists)
      if (parsed.value.guestBookable === true) return res.status(409).json(GUEST_RETIRED);
      if (!features.guestBooking) delete parsed.value.guestBookable;
      if (!Object.keys(parsed.value).length && !needs.value) return res.status(200).json({ item: current });
      const [row] = Object.keys(parsed.value).length
        ? await db.update(T).set(parsed.value).where(and(eq(ProRdvService.id, id), eq(ProRdvService.structureId, structureId))).returning() : [current];
      if (needs.value) await writeServiceNeeds(db, id, needs.value);
      await changed('RDV_SERVICE_UPDATED', id);
      const tags = needs.value ? needs.value.map((x) => x.subdomain) : (reach.needs ? (await readServiceNeeds(db, [id])).get(id) || [] : []);
      return res.status(200).json({ item: { ...row, subdomains: tags } });
    }
    const [{ n }] = await db.select({ n: count() }).from(ProAppointment).where(eq(ProAppointment.serviceId, id));
    if (Number(n) > 0) return res.status(409).json({ error: 'Ce service a des rendez-vous : désactivez-le au lieu de le supprimer.' });
    await db.delete(ProRdvService).where(and(eq(ProRdvService.id, id), eq(ProRdvService.structureId, structureId)));
    await changed('RDV_SERVICE_DELETED', id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.cause?.code || error?.code } }, 'pro.services failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withProRdvHandler('pro.services', handler);
