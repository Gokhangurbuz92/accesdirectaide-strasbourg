// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { listVersions, previewRollback, rollbackTo } from '../../_services/content-versions.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/** PKG-5 / A07 — GET ?entityType=&entityId= (versions of a record); POST { versionId, reason } restores that exact version (MFA, reason, audited; verification untouched). */
export default async function handler(req, res) {
  const write = req.method !== 'GET';
  const auth = await adminGate(req, res, { write }); if (!auth) return;
  try {
    if (req.method === 'GET') {
      // owner LAB audit: ?versionId= — what restoring that version would change (shown before the rollback)
      const out = req.query?.versionId ? await previewRollback(req.query.versionId) : await listVersions(req.query?.entityType, req.query?.entityId);
      return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (String(b.reason || '').trim().length < 10) return res.status(400).json({ error: 'REASON_REQUIRED', message: 'Indiquez le motif du retour arrière (au moins 10 caractères).' });
    const out = await rollbackTo(b.versionId, auth.email, undefined, String(b.reason).trim());
    if (out.ok) await bumpContentEpoch().catch(() => {});   // R12: a restored version (and the hold it places) leaves no cached public search result behind
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[ContentVersions] failed');
    return res.status(500).json({ error: 'VERSIONS_FAILED', message: 'Les versions n’ont pas pu être lues ou restaurées. Réessayez.' });
  }
}
