/**
 * R7 admin — the data-quality dashboard counts open review-queue items whatever their spelling ('open' or 'OPEN'), like the review queue and « À traiter ».
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_services/ws2-review.js', () => ({ ws2Queue: async () => ({ records: [], totals: {} }) }));

describe('R7 admin — data-quality summary reads open items case-insensitively', () => {
  it('the review-queue count uses lower(status) = open', async () => {
    const { dataQualitySummary } = await import('../../api/_services/data-quality-summary.js');
    const seen = []; const dialect = new PgDialect();
    await dataQualitySummary({ db: { execute: async (q) => { seen.push(dialect.sqlToQuery(q).sql); return { rows: [] }; } } });
    const q = seen.find((s) => s.includes('"ReviewQueueItem"'));
    expect(q).toMatch(/lower\(status\) = 'open'/);
  });
});
