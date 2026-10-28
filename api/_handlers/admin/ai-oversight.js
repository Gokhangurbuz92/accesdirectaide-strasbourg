// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { list, decide } from '../../_services/ai-oversight.js';

/**
 * PKG-6 / D22 — human oversight of AI outputs. GET (administrator session): pending FALC drafts count + AI repair suggestions nobody has decided.
 * POST (named administrator with MFA): { action: 'decide', id, decision: 'keep' | 'dismiss', note } — audited; never edits the record itself.
 */
export default async function handler(req, res) {
  const auth = await adminGate(req, res, { write: req.method !== 'GET' }); if (!auth) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await list());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.action !== 'decide') return res.status(400).json({ error: 'unknown_action' });
    const out = await decide(b.id, b.decision, b.note, auth.email, undefined, b.suggestedAt ?? null);
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminAiOversight] failed');
    return res.status(500).json({ error: 'AI_OVERSIGHT_FAILED' });
  }
}
