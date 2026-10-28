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

/**
 * /api/pro/services — the appointment services (motifs) of the professional's structure.
 * GET: list (any member).  POST / PATCH ?id= / DELETE ?id=: structure admins only (same rule as the RDV settings).
 * PKG-3 / B01: this route used to be GET-only, so the Services screen could never create, edit or deactivate a service. Each service declares the modalities it is offered in
 * (modes: IN_PERSON and/or VIDEO); what a citizen can book is that intersected with the structure's booking mode and the video activation (api/lib/appointment-modes.js).
 * A service with appointments is never deleted (409: deactivate it instead), so no appointment loses its service.
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
  if (b.modes !== undefined) {
    const modes = [...new Set(Array.isArray(b.modes) ? b.modes.map((m) => String(m).toUpperCase()) : [])];
    if (!modes.length || modes.some((m) => !MODES.includes(m))) return { error: 'Choisissez au moins une modalité (présentiel et/ou visio).' };
    out.modes = modes;
  }
  return { value: out };
}

async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return undefined;
  const { structureId, role } = proCtx;
  try {
    if (req.method === 'GET') {
      const services = await db.query.ProRdvService.findMany({ where: (svc, { eq: e }) => e(svc.structureId, structureId), orderBy: (svc, { asc }) => [asc(svc.name)] });
      return res.status(200).json({ items: services, total: services.length });
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (role !== AUTH_ROLE.STRUCTURE_ADMIN && role !== AUTH_ROLE.SUPERADMIN) return res.status(403).json({ error: 'Forbidden' });
    // R12 (E04): a catalogue change is journaled (who changed which service) and clears the cached search results that list services
    const changed = async (action, serviceId) => {
      await logProAudit(action, proCtx.userId, structureId, { serviceId }, clientIp(req));
      await bumpContentEpoch().catch(() => {});
    };
    if (req.method === 'POST') {
      const parsed = readService(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const [row] = await db.insert(ProRdvService).values({ structureId, modes: ['IN_PERSON'], ...parsed.value }).returning();
      await changed('RDV_SERVICE_CREATED', row.id);
      return res.status(201).json({ item: row });
    }
    const id = String(req.query?.id || '').trim();
    const [current] = id ? await db.select().from(ProRdvService).where(and(eq(ProRdvService.id, id), eq(ProRdvService.structureId, structureId))).limit(1) : [];
    if (!current) return res.status(404).json({ error: 'Service not found' });
    if (req.method === 'PATCH') {
      const parsed = readService(req.body, current);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (!Object.keys(parsed.value).length) return res.status(200).json({ item: current });
      const [row] = await db.update(ProRdvService).set(parsed.value).where(and(eq(ProRdvService.id, id), eq(ProRdvService.structureId, structureId))).returning();
      await changed('RDV_SERVICE_UPDATED', id);
      return res.status(200).json({ item: row });
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
