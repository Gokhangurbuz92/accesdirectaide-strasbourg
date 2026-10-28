// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { listRequests, updateRequest } from '../../_services/support.js';

/** PKG-5 / A19 — GET ?status= (MFA session: the text is personal data) ; POST { id, status?, resolutionNote?, assignToMe? } (MFA, audited). No dossier content here. */
export default async function handler(req, res) {
  const auth = await adminGate(req, res, { write: true }); if (!auth) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await listRequests({ status: req.query?.status, actor: auth.email }));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await updateRequest(b.id, b, auth.email);
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminSupport] failed');
    return res.status(500).json({ error: 'SUPPORT_FAILED', message: 'Les demandes d’aide n’ont pas pu être lues ou modifiées. Réessayez.' });
  }
}
