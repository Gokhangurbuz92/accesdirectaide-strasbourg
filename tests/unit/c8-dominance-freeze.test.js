/**
 * C8 follow-up — pure rules and wiring: the p % rule with coalitions (tighten-only configuration), the freezing job's schedule and category, the shape of
 * migration 0052 (additive, its rollback forgets the journal row) and the code path without 0052. The real-database proofs are
 * tests/integration/c8-dominance-freeze-db.test.js (attacks) and tests/unit/c8-marginal-bounds.test.js (marginal bounds).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { dominated, disclosureRules, primaryCell, DOMINANCE_DEFAULTS, snapshotAvailable, freezeClosedQuarters } from '../../api/_services/territorial-stats.js';
import { WATCHED_JOBS } from '../../api/_services/job-watch.js';
import { SCHEDULED_JOBS } from '../../api/_utils/public-beta.js';

describe('C8 p % rule with coalitions', () => {
  const rules = disclosureRules({});
  it('defaults: coalition of 2, p = 20; configuration can only tighten', () => {
    expect(DOMINANCE_DEFAULTS).toEqual({ coalition: 2, pPercent: 20 });
    expect(rules).toMatchObject({ kMin: 5, minOrganizations: 3, coalition: 2, pPercent: 20 });
    expect(disclosureRules({ OBS_DOMINANCE_COALITION: '1', OBS_DOMINANCE_P_PERCENT: '5' })).toMatchObject({ coalition: 2, pPercent: 20 });   // looser: ignored
    expect(disclosureRules({ OBS_DOMINANCE_COALITION: '3', OBS_DOMINANCE_P_PERCENT: '50' })).toMatchObject({ coalition: 3, pPercent: 50 });
    expect(disclosureRules({ OBS_DOMINANCE_COALITION: '99', OBS_DOMINANCE_P_PERCENT: '999' })).toMatchObject({ coalition: 5, pPercent: 100 });
    expect(disclosureRules({ OBS_DOMINANCE_COALITION: 'x', OBS_DOMINANCE_P_PERCENT: '' })).toMatchObject({ coalition: 2, pPercent: 20 });
  });
  it('three contributors or fewer: always sensitive (two recover the third); four balanced ones: not; one dominant among many: sensitive', () => {
    expect(dominated([7, 3, 2], rules)).toBe(true); expect(dominated([12], rules)).toBe(true); expect(dominated([6, 6], rules)).toBe(true);
    expect(dominated([7, 6, 6, 6], rules)).toBe(false);   // remainder 6 ≥ 20 % of 7
    expect(dominated([40, 2, 1, 1], rules)).toBe(true);   // remainder 1 < 8
    expect(dominated([0, 0, 0], rules)).toBe(false); expect(dominated([], rules)).toBe(false);
    // people (distinct): the organizations' counts may exceed the cell — the remainder is then smaller (stricter)
    expect(dominated([3, 3, 3, 3], rules, 9)).toBe(true); expect(dominated([3, 3, 3, 3], rules, 12)).toBe(false);
    expect(primaryCell(12, [7, 3, 2], rules)).toBeNull(); expect(primaryCell(25, [7, 6, 6, 6], rules)).toBe(25); expect(primaryCell(4, [1, 1, 1, 1], rules)).toBeNull();
  });
});

describe('C8 frozen quarters: job, migration 0052, behaviour without it', () => {
  it('the freezing job: daily in vercel.json, watched, category A (closed in the beta until named)', () => {
    const cron = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.find((c) => c.path === '/api/cron/observatory-freeze');
    expect(cron?.schedule).toBe('17 6 * * *');
    expect(WATCHED_JOBS['observatory-freeze']).toMatchObject({ group: 'jobs', maxAgeHours: 49 }); expect(WATCHED_JOBS['observatory-freeze'].good).toEqual(['success', 'skipped']);
    expect(SCHEDULED_JOBS['observatory-freeze']).toBe('A');
    expect(fs.readFileSync('api/routes.js', 'utf8')).toContain("{ path: 'cron/observatory-freeze', match: 'exact'");
  });

  it('0052 is additive and its rollback forgets the journal row', () => {
    const up = fs.readFileSync('drizzle/0052_c8_observatory_quarter_snapshot.sql', 'utf8'); const down = fs.readFileSync('drizzle/rollback/0052_down.sql', 'utf8');
    const statements = up.replace(/^-- .*$/gm, '').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    expect(statements.map((x) => x.split(/\s|\(/)[0] + ' ' + x.split(/\s/)[1])).toEqual(['CREATE TABLE', 'CREATE FUNCTION', 'CREATE TRIGGER']);
    expect(up.replace(/^-- .*$/gm, '')).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE\s+"|INSERT)\b/);
    const entry = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.find((e) => e.tag === '0052_c8_observatory_quarter_snapshot');
    expect(entry).toBeTruthy(); expect(down).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when};`);
    expect(down).toMatch(/DROP TABLE IF EXISTS "ObservatoryQuarterSnapshot";/); expect(down).toMatch(/DROP FUNCTION IF EXISTS "observatory_quarter_snapshot_immutable"\(\);/);
  });

  it('without 0052 (the catalogue has no table): nothing is frozen, nothing is read from it', async () => {
    const seen = [];
    const db = { execute: async (q) => { seen.push(q); return { rows: [] }; } };
    expect(await snapshotAvailable(db)).toBe(false);
    expect(await freezeClosedQuarters(db, new Date('2026-11-17T00:00:00Z'))).toEqual({ ok: true, available: false, frozen: [], alreadyFrozen: [] });
    expect(seen).toHaveLength(1);   // only the catalogue question (cached)
  });
});
