import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic } from '../../../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { logProAudit } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { holdsOwnership } from '../../_utils/share-access.js';
import { purgeDossierFiles, storageKeysOf } from '../../_services/dossier-files.js';
import { clientIp } from '../../_utils/client-ip.js';

/**
 * Dossier Revoke API (Citizen-owner)
 *
 * POST /api/public/dossier-revoke        body { shareId } + OWNER secret (header X-Share-Owner-Secret or body.rightsSecret)
 *
 * RGPD "right to be forgotten".  Destructive rights belong to the OWNER secret only: a recipient's SHARE token (or a professional session, or the shareId alone)
 * is refused with the same 404 as an unknown id, and nothing is deleted.  Expired dossiers stay revocable (erasure must not depend on the share being active).
 * LEGACY rows (created before RC5, no distinct share token) have NO owner: a link is never proof of ownership, so they answer 404 here (assisted erasure = ADA Admin, NC dependency).
 */
/** @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const shareId = String(req.body?.shareId || '').trim();
  if (!shareId) return res.status(400).json({ error: 'shareId requis.' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const limit = await checkRateLimit('DOSSIER_REVOKE', `${shareId}:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });
    const shared = await db.query.SharedDiagnostic.findFirst({ where: eq(SharedDiagnostic.id, shareId), columns: { id: true, rightsSecretHash: true, shareTokenHash: true, ownerCitizenId: true } });   // shareTokenHash is REQUIRED by holdsOwnerSecret (a row without it is legacy and has no owner)
    if (!shared || !(await holdsOwnership(shared, req))) return res.status(404).json({ error: 'Dossier introuvable ou déjà révoqué.' });
    const digest = shared.rightsSecretHash || '';
    // delete bound to the verified digest (closes the check/delete race); grants / threads / messages cascade
    const deleted = await db.delete(SharedDiagnostic)
      .where(and(eq(SharedDiagnostic.id, shareId), eq(SharedDiagnostic.rightsSecretHash, digest)))
      .returning({ id: SharedDiagnostic.id, results: SharedDiagnostic.results });
    if (!deleted.length) return res.status(404).json({ error: 'Dossier introuvable ou déjà révoqué.' });
    // DTA S8: the row cascade does not reach object storage; the encrypted documents of this dossier are erased with it (best effort, never fails the erasure).
    await purgeDossierFiles(storageKeysOf(deleted[0].results)).catch(() => { });
    const ip = clientIp(req);
    await logProAudit('DOSSIER_REVOKED_BY_USER', 'citizen', '', { shareId, revokedAt: new Date().toISOString() }, ip).catch(() => { });
    return res.status(200).json({ ok: true, message: 'Accès révoqué. Vos données chiffrées sont désormais inaccessibles.' });
  } catch (error) {
    logger.error({ err: { name: /** @type {any} */ (error)?.name, message: /** @type {any} */ (error)?.message } }, '[Revoke] Erreur');
    return res.status(500).json({ error: 'Échec de la révocation.' });
  }
}
