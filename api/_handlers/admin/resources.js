// @ts-nocheck
/**
 * C12 — the administration of the /ressources documents (api/_services/resource-publication.js). Reading needs an administrator session; every change
 * needs a NAMED administrator session with MFA (adminGate write) and is recorded in the append-only ledger and the administration journal. The route
 * belongs to the « admin » surface: closed during the restricted public beta like every administration route (api/_utils/public-beta.js).
 *   GET  /api/admin/resources                 { available, items } — available=false on a database without migration 0050 (items: the rows as they are, read-only)
 *   GET  /api/admin/resources?id=<id>         one document with its version, problems, public decision and ledger
 *   POST /api/admin/resources { action: 'create' | 'edit' | 'verify' | 'publish' | 'withdraw', id?, draft?, expectedVersion?, note?, reason? }
 */
import { desc, eq } from 'drizzle-orm';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { db } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';
import { resourcePublication } from '../../_services/resource-publication.js';
import { resourcePublicationSchema, resourceTable } from '../../_utils/schema-features.js';
import logger from '../../_utils/logger.js';

const ID = /^[0-9a-zA-Z_-]{1,64}$/;

/** the official hosts the source address may be on: the seed of the source registry and its attested sites (evidenceUrlAllowed adds the product list) */
async function officialHosts() {
  try {
    const { SEED_SOURCES, trustedDomains } = await import('../../_services/verification/sources.js');
    const seed = SEED_SOURCES.flatMap((s) => s.domains || []);
    const attested = await trustedDomains(db).catch(() => []);
    return [...new Set([...seed, ...attested].map((d) => String(d).toLowerCase()))];
  } catch { return []; }
}

export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: req.method === 'POST' });
  if (!auth) return undefined;
  try {
    const has0050 = await resourcePublicationSchema(db);
    if (req.method === 'GET' && !has0050) {
      // no publication path without 0050: the existing rows are listed as they are (read-only), so nobody believes the table is empty
      const R = resourceTable(false);
      const rows = await db.select({ id: R.id, slug: R.slug, title: R.title, type: R.type, status: R.status, source_url: R.source_url, updatedAt: R.updatedAt }).from(R).orderBy(desc(R.updatedAt)).limit(500);
      return res.status(200).json({ available: false, items: rows });
    }
    const wf = resourcePublication({ db, schema, ops: { eq, desc }, has0050, trustedDomains: await officialHosts() });
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      if (id) { if (!ID.test(id)) return res.status(400).json({ error: 'BAD_ID' }); const row = await wf.get(id); return row ? res.status(200).json(row) : res.status(404).json({ error: 'NOT_FOUND' }); }
      return res.status(200).json({ available: true, items: await wf.list() });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = String(auth.email);
    const id = b.id ? String(b.id) : null;
    if (id && !ID.test(id)) return res.status(400).json({ error: 'BAD_ID' });
    if (b.action !== 'create' && !id) return res.status(400).json({ error: 'ID_REQUIRED' });
    switch (b.action) {
      case 'create': return res.status(201).json(await wf.create(actor, b.draft || {}));
      case 'edit': return res.status(200).json(await wf.edit(actor, id, b.draft || {}));
      case 'verify': return res.status(200).json(await wf.verify(actor, id, { expectedVersion: b.expectedVersion, note: b.note }));
      case 'publish': return res.status(200).json(await wf.publish(actor, id));
      case 'withdraw': return res.status(200).json(await wf.withdraw(actor, id, b.reason));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code, ...(e.problems ? { problems: e.problems } : {}) });
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[admin/resources] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
