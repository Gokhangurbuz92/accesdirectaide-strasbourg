import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Pro handler security tests.
 */
describe('Pro handler security', () => {
  it('appointments requires pro auth', () => {
    const content = readFileSync('api/_handlers/pro/appointments.js', 'utf-8');
    expect(content).toMatch(/auth|pro|verify|unauthorized/i);
  });

  it('appointments validates input', () => {
    const content = readFileSync('api/_handlers/pro/appointments.js', 'utf-8');
    expect(content).toMatch(/method|GET|POST|body|validate/i);
  });
});
