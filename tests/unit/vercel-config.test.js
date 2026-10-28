import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Vercel configuration tests.
 */
describe('Vercel configuration', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf-8'));

  it('has 5+ crons configured', () => {
    expect(config.crons).toBeDefined();
    expect(config.crons.length).toBeGreaterThan(5);
  });

  it('has health-alert cron', () => {
    const found = config.crons.find(c => c.path.includes('health-alert'));
    expect(found).toBeDefined();
  });

  it('has gdpr-purge cron', () => {
    const found = config.crons.find(c => c.path.includes('gdpr-purge'));
    expect(found).toBeDefined();
  });

  it('no longer schedules the plaintext backup export (launch-readiness item 52: provider PITR + scripts/db-backup.mjs, encrypted)', () => {
    const found = config.crons.find(c => c.path.includes('backup'));
    expect(found).toBeUndefined();
  });

  it('has security headers in config', () => {
    const str = JSON.stringify(config);
    expect(str).toContain('X-Frame-Options');
  });

  it('has rewrites or routes for SPA', () => {
    expect(config.rewrites || config.routes).toBeDefined();
  });
});
