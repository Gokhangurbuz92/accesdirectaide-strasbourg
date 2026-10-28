// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { describeVerification, recordVerification } from '../../_services/content-verification.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * PKG-1 / D-5 — human content verification.
 *   GET  /api/admin/content-verification?entityType=aide&entityId=...   why the record is (not) public + the append-only history (any admin)
 *   POST /api/admin/content-verification { entityType, entityId, action: VERIFY|REJECT|HOLD|RELEASE_HOLD, sourceUrl, evidenceNote, territoryConfirmed, holdReason, expectedVersion }
 *        (expectedVersion = the `version` of the GET — required for VERIFY and RELEASE_HOLD: 409 STALE_REVIEW when the record changed since it was read)
 * Writing requires an admin session WITH MFA (authType admin_jwt, mfa_verified). The legacy shared ADMIN_TOKEN, pro tokens and every service/AI path are refused: verification
 * authority belongs to a named human, never to a model or a shared secret. The verification time is the server's clock.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await resolveAuthContext(req);
  // PKG-5 / A16: administrator sessions only — a professional token claiming SUPERADMIN is not an administrator
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'https://localhost');
      const out = await describeVerification(String(req.query?.entityType || url.searchParams.get('entityType') || ''), String(req.query?.entityId || url.searchParams.get('entityId') || ''));
      return out.ok ? res.status(200).json({ decision: out.decision, history: out.history, content: out.content, version: out.version, hold: out.hold, editHold: out.editHold, verificationStatus: out.verificationStatus })
        : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email) {
      return res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Verification requires a named administrator session with MFA.' });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    // owner LAB audit: an approval (VERIFY) or a release is bound to the exact content the reviewer read (GET … content + version, or the WS2 queue): no stale approval
    if (['VERIFY', 'RELEASE_HOLD'].includes(String(b.action)) && !/^[0-9a-f]{64}$/.test(String(b.expectedVersion || ''))) {
      return res.status(400).json({ error: 'VERSION_REQUIRED', message: 'Relisez la fiche avant de décider : la décision porte sur la version lue (expectedVersion).' });
    }
    // a release republishes: it says why (kept in the ledger), like a hold or a refusal
    if (String(b.action) === 'RELEASE_HOLD' && String(b.evidenceNote || '').trim().length < 5) {
      return res.status(400).json({ error: 'RELEASE_REASON_REQUIRED', message: 'Indiquez pourquoi l’attente est levée (au moins 5 caractères).' });
    }
    const out = await recordVerification({
      entityType: String(b.entityType || ''), entityId: String(b.entityId || ''), action: String(b.action || ''), reviewer: { id: String(auth.email), role: String(auth.role) },
      sourceUrl: typeof b.sourceUrl === 'string' ? b.sourceUrl : '', evidenceNote: typeof b.evidenceNote === 'string' ? b.evidenceNote : '',
      territoryConfirmed: b.territoryConfirmed === true, holdReason: typeof b.holdReason === 'string' ? b.holdReason : '',
      ...(typeof b.expectedVersion === 'string' && b.expectedVersion ? { expectedVersion: b.expectedVersion } : {}),
    });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    const cache = await bumpContentEpoch();
    logger.info({ entityType: b.entityType, action: b.action }, '[ContentVerification] recorded');
    return res.status(200).json({ ok: true, decision: out.decision, searchCacheCleared: cache.bumped, cdnRecordMaxAgeSeconds: 60, cdnListMaxAgeSeconds: 3600 })   // PKG-11 audit: only the search cache is cleared; the CDN copies expire on their own;
  } catch (error) {
    logger.error({ err: { name: error?.name, message: String(error?.message || '').slice(0, 200) } }, '[ContentVerification] failed');
    return res.status(500).json({ error: 'VERIFICATION_FAILED' });
  }
}
