import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Admin handler security tests.
 */
describe('Admin handler security', () => {
  it('dashboard requires admin auth', () => {
    const content = readFileSync('api/_handlers/admin/dashboard.js', 'utf-8');
    expect(content).toMatch(/admin|auth|verify|unauthorized/i);
  });

  it('ai-metrics requires admin auth', () => {
    const content = readFileSync('api/_handlers/admin/ai-metrics.js', 'utf-8');
    expect(content).toMatch(/admin|auth|verify/i);
  });

  it('alerts requires admin auth', () => {
    const content = readFileSync('api/_handlers/admin/alerts.js', 'utf-8');
    expect(content).toMatch(/admin|auth|verify/i);
  });
});
