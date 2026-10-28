// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { claimShare, listOwnedShares } from '../../_services/citizen-account.js';
import { readOwnerSecret } from '../../_utils/share-access.js';

/**
 * GET  /api/citizen/shares                         the dossiers attached to this account
 * POST /api/citizen/shares { shareId }  + owner secret (header X-Share-Owner-Secret)   attach an account-free dossier to this account (needs BOTH the session and the owner secret)
 */
export default citizenHandler('shares', ['GET', 'POST'], async (citizen, req) => {
  if (req.method === 'GET') return { ok: true, status: 200, shares: await listOwnedShares(citizen.id) };
  return claimShare(citizen.id, String(req.body?.shareId || '').trim(), readOwnerSecret(req));
});
