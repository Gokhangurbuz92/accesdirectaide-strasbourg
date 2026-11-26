/**
 * R7 admin — the administrators' FALC queue reads only FALC drafts (AiOutputReview.kind = 'FALC'). A DOSSIER_SYNTHESIS draft is personal
 * (an organization's synthesis of a shared dossier, reviewed by that organization only): it never appears in the admin FALC list or count, and the
 * admin FALC approve / reject never act on it.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/lib/ai-foundation.js', () => ({ generateCitizenLocalStructuredContent: vi.fn() }));

const dialect = new PgDialect();
const fakeDb = () => {
  const seen = [];
  const db = {
    seen,
    execute: async (q) => { seen.push(dialect.sqlToQuery(q).sql); return { rows: [] }; },
    insert: () => ({ values: async () => {} }),
    transaction: async (fn) => fn(db),
  };
  return db;
};
const reviewQueries = (db) => db.seen.filter((s) => s.includes('"AiOutputReview"'));

describe('R7 admin — FALC queue filters AiOutputReview.kind', () => {
  it('listPending reads only FALC drafts', async () => {
    const { listPending } = await import('../../api/_services/falc-governance.js');
    const db = fakeDb(); await listPending(db);
    expect(reviewQueries(db)).toHaveLength(1);
    expect(reviewQueries(db)[0]).toMatch(/kind = 'FALC'/);
  });

  it('approve and reject act only on FALC drafts', async () => {
    const { approve, reject } = await import('../../api/_services/falc-governance.js');
    const a = fakeDb(); await approve('id-1', { text: null }, 'admin@example.test', a);
    const r = fakeDb(); await reject('id-1', 'raison suffisante', 'admin@example.test', r);
    for (const q of [...reviewQueries(a), ...reviewQueries(r)]) expect(q).toMatch(/kind = 'FALC'/);
    expect(reviewQueries(a).length + reviewQueries(r).length).toBe(2);
  });

  it('the AI oversight count counts only FALC drafts', async () => {
    const { list } = await import('../../api/_services/ai-oversight.js');
    const db = fakeDb();
    db.execute = async (q) => { db.seen.push(dialect.sqlToQuery(q).sql); return { rows: [{ n: 0 }] }; };
    await list(db);
    expect(reviewQueries(db)[0]).toMatch(/kind = 'FALC'/);
  });
});
