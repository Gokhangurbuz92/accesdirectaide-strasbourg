/**
 * V2 (LAB) — health-alert fits Neon Free and stays quiet about jobs that are intentionally closed.
 * Neon Free: compute scales to zero after 5 idle minutes (fixed) and has 100 CU-hours per month; a 5-minute check kept it awake around the clock.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('V2 — health-alert on Neon Free', () => {
  it('runs at most once an hour (no 5-minute schedule)', () => {
    const cron = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.find((c) => c.path === '/api/cron/health-alert');
    expect(cron).toBeDefined();
    const [min, hour] = cron.schedule.split(/\s+/);
    expect(min).toMatch(/^\d+$/);
    expect(hour).toBe('*');
  });
  it('checks ingestion freshness only when an ingestion job is meant to run', () => {
    const src = fs.readFileSync('api/_handlers/cron/health-alert.js', 'utf8');
    expect(src).toMatch(/const ingestionExpected = !isPublicBetaRestricted\(process\.env\) \|\| \['ingest-aids', 'actualites', 'ingest-structures'\]\.some\(\(j\) => openJobs\(process\.env\)\.has\(j\)\);/);
    expect(src).toMatch(/if \(!ingestionExpected\) checks\.ingestionFreshness = \{ ok: true, skipped: 'JOB_NOT_OPENED' \};\s*else try \{/);
  });
});
