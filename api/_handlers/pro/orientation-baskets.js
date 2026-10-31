// @ts-nocheck
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { getCanonicalOrigin } from '../../_utils/site-origin.js';
import { addItem, createBasket, getBasket, linkCase, listBaskets, removeItem, searchCatalogue, shareToCase, updateBasket, updateItem } from '../../_services/orientation-basket.js';

/**
 * R18 (R31) — « Sélections d'orientation » of the caller's organization (rules in api/_services/orientation-basket.js).
 *   GET                -> my selections (administrators: the organization's)      GET ?id=  -> one selection, items re-read from the public catalogue
 *   GET ?q=&kinds=&needs=  -> search of the verified catalogue
 *   POST { action: 'create', label, needCodes } | { action: 'update', id, label?, needCodes?, status? } | { action: 'add', id, kind, refId, reason? }
 *        { action: 'item', id, key, followUp?, reason? } | { action: 'remove', id, key } | { action: 'link_case', id, caseId|null } | { action: 'share', id }
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  const send = (out) => (out.ok === false ? res.status(out.status || 400).json({ error: out.code, message: out.message }) : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  const q = req.query || {};
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (req.method === 'GET') {
    if (q.q !== undefined) return send(await searchCatalogue(ctx, { q: String(q.q), kinds: list(q.kinds), needCodes: list(q.needs) }));
    return send(q.id ? await getBasket(q.id, ctx) : await listBaskets(ctx, { status: String(q.status || 'ACTIVE') }));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  switch (b.action) {
    case 'create': return send(await createBasket(ctx, b));
    case 'update': return send(await updateBasket(b.id, ctx, b));
    case 'add': return send(await addItem(b.id, ctx, b));
    case 'item': return send(await updateItem(b.id, ctx, b));
    case 'remove': return send(await removeItem(b.id, ctx, String(b.key || '')));
    case 'link_case': return send(await linkCase(b.id, ctx, b.caseId || null));
    case 'share': {
      const [s] = (await db.execute(sql`SELECT nom FROM "Structure" WHERE id = ${ctx.structureId}`)).rows;
      return send(await shareToCase(b.id, ctx, { structureName: s?.nom || '', origin: getCanonicalOrigin(req) }));
    }
    default: return res.status(400).json({ error: 'INVALID_ACTION' });
  }
}

export default withProRdvHandler('pro.orientation-baskets', handler);
