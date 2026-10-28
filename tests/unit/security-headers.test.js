import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Security headers contract tests — vérifier que vercel.json
 * contient les headers et crons requis.
 */
describe('Security headers contract', () => {
  let config;

  it('vercel.json loads and parses', () => {
    const content = readFileSync('vercel.json', 'utf-8');
    config = JSON.parse(content);
    expect(config).toBeDefined();
  });

  it('has security headers configured', () => {
    const str = JSON.stringify(config);
    expect(str).toContain('X-Content-Type-Options');
    expect(str).toContain('X-Frame-Options');
    expect(str).toContain('Strict-Transport-Security');
    expect(str).toContain('Content-Security-Policy');
    expect(str).toContain('Referrer-Policy');
    expect(str).toContain('Permissions-Policy');
  });

  it('has cron configuration with 5+ jobs', () => {
    expect(config.crons).toBeDefined();
    expect(config.crons.length).toBeGreaterThan(5);
  });
});
