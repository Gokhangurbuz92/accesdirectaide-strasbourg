// @ts-nocheck
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { archiveContent, createContent, listContent, readContent, updateContent } from '../../_services/admin-content.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * PKG-11 / A02 — catalogue administration (api/_services/admin-content.js) behind the K5 administrator gate: administrator sessions only; every write needs a
 * named session with MFA, and is journalised by the gate (route) and by the service (fields).
 *   GET    /api/admin/content?kind=aide|demarche|structure[&q=]   list (drafts and unverified records included)
 *   GET    /api/admin/content?kind=…&id=                          one record (all columns but the embedding)
 *   POST   /api/admin/content?kind=…                              create a DRAFT (editorial fields only)
 *   PUT    /api/admin/content?kind=…&id=                          edit editorial fields / draft ↔ published (versioned; a verified record goes on hold)
 *   DELETE /api/admin/content?kind=…&id=                          archive (never a physical delete)
 */
export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: req.method !== 'GET' }); if (!auth) return;
  const kind = String(req.query?.kind || ''); const id = String(req.query?.id || ''); const actor = String(auth.email || auth.id || 'admin');
  try {
    const out = req.method === 'GET' ? (id ? await readContent(kind, id) : await listContent(kind, { q: String(req.query?.q || '') }))
      : req.method === 'POST' ? await createContent(kind, req.body || {}, actor)
        : !id ? { ok: false, status: 400, code: 'ID_REQUIRED', message: 'id requis.' }
          : req.method === 'PUT' ? await updateContent(kind, id, req.body || {}, actor) : await archiveContent(kind, id, actor);
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    // R12: an edit, an archive, an unpublication or the edit hold it places leaves no cached public search result behind (same rule as verification)
    if (req.method !== 'GET') await bumpContentEpoch().catch(() => {});
    const { ok: _ok, status, ...body } = out;
    return res.status(status || 200).json(body);
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code } }, '[AdminContent] failed');
    return res.status(500).json({ error: 'ADMIN_CONTENT_FAILED', message: 'L’enregistrement a échoué.' });
  }
}
