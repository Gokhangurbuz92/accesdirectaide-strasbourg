/**
 * C2 (owner Paket 4, RB-01) — the scheduled link check: one weekly schedule, two switches (ADA_BETA_OPEN_JOBS and LINK_CHECK_ENABLED), watched by the health
 * check, bounded (quota, per-request timeout, total time budget), report only. Pins of the wiring; the real-database run is
 * tests/integration/c2-link-check-bounds-db.test.js, the network behaviour tests/integration/pkg11-a05-link-check-db.test.js.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { WATCHED_JOBS } from '../../api/_services/job-watch.js';
import { SCHEDULED_JOBS, openJobs, isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';
import { LIMITS, checkOne } from '../../api/_services/link-check.js';

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };

describe('C2 link check wiring', () => {
  it('scheduled weekly in vercel.json, watched with twice its gap + 1 h, « skipped » (switch off) is not an incident', () => {
    const cron = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.find((c) => c.path === '/api/cron/link-check');
    expect(cron?.schedule).toBe('23 4 * * 1');
    expect(WATCHED_JOBS['link-check']).toMatchObject({ group: 'jobs', maxAgeHours: 337 }); expect(WATCHED_JOBS['link-check'].good).toEqual(['success', 'partial', 'skipped']);
  });

  it('category A: closed in the beta until named in ADA_BETA_OPEN_JOBS; naming it does not by itself make it request anything (LINK_CHECK_ENABLED)', () => {
    expect(SCHEDULED_JOBS['link-check']).toBe('A');
    expect(isAllowedInPublicBeta('GET', 'cron/link-check', BETA)).toBe(false);
    expect(openJobs({ ...BETA, ADA_BETA_OPEN_JOBS: 'link-check' }).has('link-check')).toBe(true);
    const handler = fs.readFileSync('api/_handlers/cron/link-check.js', 'utf8');
    expect(handler).toMatch(/if \(process\.env\.LINK_CHECK_ENABLED !== '1'\) \{/); expect(handler).toContain("startCronRun(database, 'link-check'");
  });

  it('bounded: defaults and caps leave the 300 s function limit a margin; every request has a time limit', async () => {
    expect(LIMITS).toMatchObject({ maxRequests: 200, maxRequestsCap: 1000, timeoutMs: 8000, budgetMs: 200_000, budgetMsCap: 220_000 });
    expect(LIMITS.budgetMsCap + 8 * LIMITS.timeoutMs).toBeLessThan(300_000);   // the last address started inside the budget: at most 8 requests (4 hops × HEAD+GET)
    const seen = []; await checkOne('https://www.service-public.fr/x', { fetchImpl: async (u, init) => { seen.push(init.signal); return { status: 200, headers: { get: () => null } }; }, timeoutMs: 1234 });
    expect(seen).toHaveLength(1); expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it('report only: the service never updates or deletes a record (its only writes are SourceSnapshot rows and review items)', () => {
    const svc = fs.readFileSync('api/_services/link-check.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(svc).not.toMatch(/\bUPDATE\s+"|\bDELETE\s+FROM\b|\.update\(|\.delete\(/i);
    expect([...svc.matchAll(/INSERT INTO "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(['ReviewQueueItem', 'SourceSnapshot']);
  });
});
