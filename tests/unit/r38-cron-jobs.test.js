// R38 — scheduled jobs one at a time during the beta: ADA_BETA_OPEN_JOBS opens a named job, a personal-data job also needs ADA_JOBS_APPROVED, a legacy job
// can never be opened by name, and the « jobs » surface stays the all-or-nothing switch. The edge middleware and api/index.js apply the same rule.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { isAllowedInPublicBeta, openJobs, jobStates, SCHEDULED_JOBS } from '../../api/_utils/public-beta.js';

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('per-job opening (fail-closed)', () => {
  it('nothing is open by default, and an unknown name or a wildcard opens nothing', () => {
    for (const j of Object.keys(SCHEDULED_JOBS)) expect(isAllowedInPublicBeta('GET', `cron/${j}`, BETA), j).toBe(false);
    expect([...openJobs({ ...BETA, ADA_BETA_OPEN_JOBS: '*,all,cron,veille,backup-db' })]).toEqual([]);
  });
  it('a public-data job opens alone, every other job and monitor route stays closed', () => {
    const e = { ...BETA, ADA_BETA_OPEN_JOBS: 'actualites' };
    expect(isAllowedInPublicBeta('GET', 'cron/actualites', e)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'cron/actualites', e)).toBe(true);
    expect(isAllowedInPublicBeta('DELETE', 'cron/actualites', e)).toBe(false);
    for (const p of ['cron/gdpr-purge', 'cron/rdv-reminder', 'cron/veille', 'cron/health-alert', 'monitor/core', 'cron/actualites-x']) expect(isAllowedInPublicBeta('GET', p, e), p).toBe(false);
  });
  it('a personal-data job needs BOTH the opening and the recorded approval', () => {
    expect(isAllowedInPublicBeta('GET', 'cron/gdpr-purge', { ...BETA, ADA_BETA_OPEN_JOBS: 'gdpr-purge' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'cron/gdpr-purge', { ...BETA, ADA_JOBS_APPROVED: 'gdpr-purge' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'cron/gdpr-purge', { ...BETA, ADA_BETA_OPEN_JOBS: 'gdpr-purge', ADA_JOBS_APPROVED: 'rdv-reminder' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'cron/gdpr-purge', { ...BETA, ADA_BETA_OPEN_JOBS: 'gdpr-purge', ADA_JOBS_APPROVED: 'gdpr-purge' })).toBe(true);
  });
  it('a legacy job (superseded by the veille) cannot be opened by name', () => {
    for (const j of ['ingest-demarches', 'ingest-annuaire', 'review-queue/scan']) expect(isAllowedInPublicBeta('GET', `cron/${j}`, { ...BETA, ADA_BETA_OPEN_JOBS: j, ADA_JOBS_APPROVED: j }), j).toBe(false);
  });
  it('jobStates says, per job, why it runs or not', () => {
    const s = Object.fromEntries(jobStates({ ...BETA, ADA_BETA_OPEN_JOBS: 'actualites,rdv-reminder,ingest-demarches' }).map((x) => [x.job, x.state]));
    expect(s).toMatchObject({ actualites: 'OPEN', 'rdv-reminder': 'AWAITING_APPROVAL', 'ingest-demarches': 'LEGACY_CLOSED', 'gdpr-purge': 'CLOSED', 'health-alert': 'CLOSED' });
    expect(jobStates({ ...BETA, ADA_BETA_OPEN_SURFACES: 'jobs' }).every((x) => x.state === 'OPEN_ALL_JOBS')).toBe(true);
  });
});

describe('the edge middleware applies the same rule to the direct api/cron functions', () => {
  it('opens /api/cron/actualites only when it is named', async () => {
    const { directFunctionResponse } = await import('../../middleware.js');
    const u = (p) => new URL(`https://www.accesdirectaide.fr${p}`);
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    expect(directFunctionResponse(u('/api/cron/actualites')).status).toBe(503);
    vi.stubEnv('ADA_BETA_OPEN_JOBS', 'actualites');
    expect(directFunctionResponse(u('/api/cron/actualites'))).toBeNull();
    expect(directFunctionResponse(u('/api/cron/ingest-demarches')).status).toBe(503);
    expect(directFunctionResponse(u('/api/monitor/core')).status).toBe(503);
  });
});

describe('vercel.json: one schedule per canonical job', () => {
  const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.map((c) => c.path.replace('/api/', ''));
  it('every scheduled path is a registered, non-legacy job; the legacy ingestions have no schedule', () => {
    for (const p of crons) expect(SCHEDULED_JOBS[p.replace('cron/', '')], p).toMatch(/^[ABC]$/);
    for (const legacy of ['cron/ingest-demarches', 'cron/ingest-annuaire', 'cron/review-queue/scan']) expect(crons).not.toContain(legacy);
    expect(new Set(crons).size).toBe(crons.length);
  });
});
