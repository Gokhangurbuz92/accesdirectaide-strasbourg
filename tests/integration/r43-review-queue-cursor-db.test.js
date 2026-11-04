/**
 * R43 (strict lint finding) — the administrator review queue parsed `cursor` and never used it: « Page suivante » showed the first page again. Real PostgreSQL:
 * five synthetic items with distinct and EQUAL creation times (the id breaks the tie), pages of two follow the list order (createdAt DESC, id DESC) without
 * a repeat or a gap, the last page has no next cursor, and an unknown cursor gives an empty page (never the first page). Synthetic rows only, removed after.
 */
import { vi } from 'vitest';
vi.hoisted(() => { for (const k of Object.keys(process.env)) if (/^(KV_|UPSTASH_)/.test(k)) delete process.env[k]; });   // process-local rate-limit store

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import { ReviewQueueItem } from '../../src/db/schema.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `r43cursor${Date.now().toString(36)}`;
const ids = ['a', 'b', 'c', 'd', 'e'].map((x) => `${TAG}-${x}`);
let session = '';

const call = async (query) => {
  const qs = new URLSearchParams(query).toString();
  const res = {
    statusCode: 200, body: null, headersSent: false, _h: {},
    on() { return this; }, setHeader(k, v) { this._h[String(k).toLowerCase()] = String(v); }, getHeader(k) { return this._h[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; }, send(b) { this.body = b; this.headersSent = true; return this; }, end(b) { if (b !== undefined) this.body = b; this.headersSent = true; return this; },
  };
  await apiHandler({ method: 'GET', url: `/api/admin/review-queue?${qs}`, headers: { host: 'localhost', 'x-forwarded-proto': 'http', authorization: `Bearer ${session}` }, query, body: null, cookies: {} }, res);
  return res;
};

describe.skipIf(!hasDb)('R43 review queue: the cursor pages through the list', () => {
  beforeAll(async () => {
    session = (await import('../../api/_utils/auth.js')).signAdminSessionToken({ email: 'r43-reviewer@example.test', role: 'admin', mfa_verified: true });
    const t0 = new Date('2026-11-04T10:00:00.000Z').getTime();
    // a and b share their creation time (the id orders them); every row has the unique reason of this run so the filter isolates them
    const at = [t0, t0, t0 - 1000, t0 - 2000, t0 - 3000];
    await db.insert(ReviewQueueItem).values(ids.map((id, i) => ({ id, entityType: 'AIDE', entityId: `${TAG}-entity-${i}`, title: `Synthetic ${i}`, reason: TAG, severity: 'low', status: 'open', details: {}, createdAt: new Date(at[i]), updatedAt: new Date(at[i]) })));
  });
  afterAll(async () => { await db.delete(ReviewQueueItem).where(inArray(ReviewQueueItem.id, ids)); });

  it('pages of two: b, a | c, d | e — no repeat, no gap, the last page has no next cursor', async () => {
    const seen = []; let cursor = null; let pages = 0;
    do {
      const res = await call({ status: 'open', reason: TAG, limit: '2', ...(cursor ? { cursor } : {}) });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.pagination.nextCursor; pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([ids[1], ids[0], ids[2], ids[3], ids[4]]);
  });

  it('an unknown cursor gives an empty page, not the first page again', async () => {
    const res = await call({ status: 'open', reason: TAG, limit: '2', cursor: `${TAG}-missing` });
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.nextCursor).toBeNull();
  });
});
