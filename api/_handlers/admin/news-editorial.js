// @ts-nocheck
/**
 * Actualités v2 — ADA's own articles (api/_services/news/editorial-workflow.js). Reading needs an administrator session; every change needs a NAMED
 * administrator session with MFA (adminGate write), is audited, and nothing is ever published without the explicit « approve » action.
 *   GET  /api/admin/news-editorial[?status=brouillon|a_relire|publie|retire]   the list
 *   GET  /api/admin/news-editorial?id=<id>                                         one article (all fields, for the editor)
 *   POST /api/admin/news-editorial { action: 'save' | 'submit' | 'reject' | 'approve' | 'correct' | 'retract', id?, draft?, note?, kind?, titre?, resume?, contenu? }
 */
import { and, eq } from 'drizzle-orm';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { db } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';
import { editorialWorkflow, STATES } from '../../_services/news/editorial-workflow.js';
import logger from '../../_utils/logger.js';

const STATUS = new Set(Object.values(STATES));
const ID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: req.method === 'POST' });
  if (!auth) return undefined;
  const wf = editorialWorkflow({ db, schema, ops: { eq, and } });
  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      if (id) { if (!ID.test(id)) return res.status(400).json({ error: 'BAD_ID' }); const row = await wf.get(id); return row ? res.status(200).json(row) : res.status(404).json({ error: 'NOT_FOUND' }); }
      const status = String(req.query?.status || '');
      if (status && !STATUS.has(status)) return res.status(400).json({ error: 'BAD_STATUS' });
      return res.status(200).json({ items: await wf.list(status || null) });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = auth.email;
    const id = b.id ? String(b.id) : null;
    if (id && !ID.test(id)) return res.status(400).json({ error: 'BAD_ID' });
    switch (b.action) {
      case 'save': return res.status(id ? 200 : 201).json(await wf.save(actor, b.draft || {}, id));
      case 'submit': return res.status(200).json(await wf.submit(actor, id));
      case 'reject': return res.status(200).json(await wf.reject(actor, id, b.note));
      case 'approve': return res.status(200).json(await wf.approve(actor, id));
      case 'correct': return res.status(200).json(await wf.correct(actor, id, { note: b.note, kind: b.kind, titre: b.titre, resume: b.resume, contenu: b.contenu }));
      case 'retract': return res.status(200).json(await wf.retract(actor, id, b.note));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code, ...(e.problems ? { problems: e.problems } : {}) });
    logger.error({ error: e?.message }, '[news-editorial] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
