// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { createDossier, exportDossier, getDossier, listDossiers, saveDossier, setStatus } from '../../_services/funding-dossiers.js';

/**
 * P27 (R31) — « Dossiers de financement » (rules in api/_services/funding-dossiers.js). GET: list | ?id= one dossier with warnings and versions | ?export=<id> Markdown.
 * POST { action: 'create', title, funderName?, programmeName?, programmeUrl?, deadline? } | { action: 'save', id, version, content, ... } | { action: 'status', id, status, date?, reference? }
 */
export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const auth = await adminGate(req, res); if (!auth) return;
      const q = req.query || {};
      const out = q.export ? await exportDossier(q.export) : q.id ? await getDossier(q.id) : await listDossiers();
      return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res, { write: true }); if (!auth) return;
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const act = {
      create: () => createDossier(b, auth.email),
      save: () => saveDossier(b.id, b, auth.email),
      status: () => setStatus(b.id, b, auth.email),
    }[String(b.action || '')];
    if (!act) return res.status(400).json({ error: 'unknown_action' });
    const out = await act();
    return out.ok ? res.status(out.status || 200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Funding] failed');
    return res.status(500).json({ error: 'FUNDING_FAILED', message: 'Les dossiers de financement n’ont pas pu être chargés ou enregistrés. Réessayez.' });
  }
}
