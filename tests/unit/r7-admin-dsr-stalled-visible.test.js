/**
 * R7 admin — DELETE and ACCESS_REVIEW requests that stopped before or after the review (RECEIVED, IDENTITY_OR_AUTHORITY_CHECK, APPROVED, EXECUTING)
 * used to be invisible in the admin review queues although the one-month legal deadline runs. They are now listed with stage 'STALLED' and their
 * status, read-only: the page offers no decision on them.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
import { listOpen } from '../../api/_services/dsr-review.js';
import { listOpenErasures } from '../../api/_services/dsr-erasure-review.js';

const dialect = new PgDialect();
const STALLED = ['RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'APPROVED', 'EXECUTING'];
const listDb = (rows) => { const seen = []; return { seen, execute: async (q) => { seen.push(dialect.sqlToQuery(q).sql); return { rows }; } }; };
const noSole = { soleAdministratorCheck: async () => ({ sole: false }) };

describe('R7 admin — stalled DSR requests are visible, read-only', () => {
  it.each([['access review', listOpen], ['erasure', listOpenErasures]])('the %s queue reads the stalled statuses and labels them STALLED', async (_n, list) => {
    const rows = STALLED.map((status, i) => ({ id: `r${i}`, status, createdAt: new Date('2026-11-01T10:00:00Z'), o: null }));
    const db = listDb(rows);
    const out = await list(db, noSole);
    const q = db.seen.find((s) => s.includes('"DSRRequest"'));
    for (const s of STALLED) expect(q).toContain(`'${s}'`);
    expect(out.requests.map((r) => [r.stage, r.status])).toEqual(STALLED.map((s) => ['STALLED', s]));
  });

  it('the page offers no decision on a STALLED request and says it is stalled', () => {
    const src = readFileSync('src/pages/admin/k5/Privacy.jsx', 'utf8');
    expect(src).toContain("admin:k5.privacy.stalled");
    // every action block is gated so that a STALLED row never reaches it
    expect(src).toMatch(/r\.stage === 'STALLED' \? null : r\.stage === 'AWAITING_PROPOSAL'/);
    expect((src.match(/r\.stage === 'STALLED' \? null/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
