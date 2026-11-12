// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { candidates, decide, decideBatch, readPair, recentDecisions, register } from '../../_services/duplicate-register.js';

/**
 * D13 — the duplicate register (/admin/doublons).
 *   GET                       -> candidate pairs (administrator session)
 *   GET ?a=&b=                -> both records in full + their versions + the pair's decisions
 *   GET ?view=register        -> the bulk review register: every pair, both records' identity and versions, the evidence assistance (a suggestion, never a decision)
 *   GET ?view=history         -> the decisions recorded lately (pairs that left the queue keep their history)
 *   POST { a, b, decision: SAME_ENTITY | DISTINCT, primaryId?, evidenceUrl, note, versionA, versionB } -> a decision (MFA session; official evidence; versions read)
 *   POST { decisions: [ …same fields + expectedDecisionId ] } -> several decisions, each one through the same path (its own transaction), one result per item
 */
export default async function handler(req, res) {
  const write = req.method !== 'GET';
  const auth = await adminGate(req, res, { write }); if (!auth) return;
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const out = q.a && q.b ? await readPair(q.a, q.b) : q.view === 'register' ? await register() : q.view === 'history' ? await recentDecisions() : await candidates();
      return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = Array.isArray(body.decisions) ? await decideBatch(body.decisions, String(auth.email)) : await decide(body, String(auth.email));
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code } }, '[AdminDuplicates] failed');
    return res.status(500).json({ error: 'DUPLICATES_FAILED' });
  }
}
