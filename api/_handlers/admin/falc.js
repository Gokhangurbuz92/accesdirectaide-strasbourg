// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { draft, listPending, approve, reject, markReviewed, recordFalc } from '../../_services/falc-governance.js';

/**
 * PKG-6 / D19 D22 — FALC review queue. GET: pending drafts with the record's source text and current FALC (administrator session).
 * POST (MFA): { action: 'draft', entityType, entityId, field } | { action: 'approve', id, text?, note? } | { action: 'reject', id, note } | { action: 'mark_reviewed', entityType, entityId, note }
 * A draft never reaches the public record without a named human approval.
 */
export default async function handler(req, res) {
  const write = req.method !== 'GET';
  const auth = await adminGate(req, res, { write }); if (!auth) return;
  try {
    if (req.method === 'GET') {
      // owner LAB audit: ?entityType=&entityId= — one record's FALC texts with their sha-256, to read before marking them reviewed
      const q = req.query || {};
      if (q.entityId) { const out = await recordFalc(q.entityType, q.entityId); return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message }); }
      return res.status(200).json(await listPending());
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const act = {
      draft: () => draft(b.entityType, b.entityId, b.field || 'summary_falc', auth.email),
      approve: () => approve(b.id, { text: b.text, note: b.note }, auth.email),
      reject: () => reject(b.id, b.note, auth.email),
      // ADM-11: the fields actually read (default: the summary); owner LAB audit: bound to the texts read (`seen`: { field: sha-256 } from the GET above)
      mark_reviewed: () => (b.seen && typeof b.seen === 'object' ? markReviewed(b.entityType, b.entityId, auth.email, b.note, undefined, b.fields, b.seen)
        : Promise.resolve({ ok: false, status: 400, code: 'SEEN_REQUIRED', message: 'Relisez les textes avant de les marquer : la relecture porte sur les textes lus.' })),
    }[String(b.action || '')];
    if (!act) return res.status(400).json({ error: 'unknown_action' });
    const out = await act();
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminFalc] failed');
    return res.status(500).json({ error: 'FALC_FAILED' });
  }
}
