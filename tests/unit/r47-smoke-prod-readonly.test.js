/**
 * R47 audit — `npm run smoke:prod` ran the actualites job in Production (/api/cron/actualites: external fetches + database writes) under the name of a smoke
 * test. The default run is now read-only (the job's freshness); running the job is the explicit --run-cron. Pure plan: no network.
 */
import { describe, expect, it } from 'vitest';
import { smokePlan } from '../../scripts/smoke-prod.mjs';

describe('R47: smoke:prod is read-only by default', () => {
  it('default plan: health, the actualites freshness monitor, the cron history — no /api/cron/ request, no cron secret needed', () => {
    const { missing, checks } = smokePlan([], { ADMIN_TOKEN: 'synthetic-admin' });
    expect(missing).toEqual([]);
    expect(checks.map((c) => c.url)).toEqual(['https://www.accesdirectaide.fr/api/health', 'https://www.accesdirectaide.fr/api/monitor/cron/actualites',
      'https://www.accesdirectaide.fr/api/admin/cron-runs?limit=10']);
    expect(checks.some((c) => c.url.includes('/api/cron/'))).toBe(false);
  });

  it('--run-cron is explicit and needs CRON_SECRET; PROD_URL is honoured', () => {
    expect(smokePlan(['--run-cron'], { ADMIN_TOKEN: 'a' }).missing).toEqual(['CRON_SECRET']);
    const { missing, checks } = smokePlan(['--run-cron'], { ADMIN_TOKEN: 'a', CRON_SECRET: 'c', PROD_URL: 'http://127.0.0.1:5194/' });
    expect(missing).toEqual([]);
    expect(checks[1]).toEqual({ label: 'cron.actualites (run)', url: 'http://127.0.0.1:5194/api/cron/actualites', headers: { Authorization: 'Bearer c' } });
    expect(smokePlan([], {}).missing).toEqual(['ADMIN_TOKEN']);
  });
});
