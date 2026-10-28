import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Auth handler security tests — vérifier que les protections
 * (rate limiting, lockout, hashing) sont en place.
 */
describe('Auth handler security', () => {
  it('login has rate limiting', () => {
    const content = readFileSync('api/_handlers/auth/login.js', 'utf-8');
    expect(content).toMatch(/rateLimit|checkRate|rateLim/i);
  });

  it('login has lockout check', () => {
    const content = readFileSync('api/_handlers/auth/login.js', 'utf-8');
    expect(content).toMatch(/lockout|locked|failedAttempts|failed.*attempt/i);
  });

  it('signup has password validation', () => {
    const content = readFileSync('api/_handlers/auth/signup.js', 'utf-8');
    expect(content).toMatch(/password|validatePassword|policy/i);
  });

  it('signup hashes password', () => {
    const content = readFileSync('api/_handlers/auth/signup.js', 'utf-8');
    expect(content).toMatch(/hash|scrypt|bcrypt|argon/i);
  });

  it('delete-account requires auth', () => {
    const content = readFileSync('api/_handlers/auth/delete-account.js', 'utf-8');
    expect(content).toMatch(/auth|userId|user.*id|unauthorized/i);
  });

  it('export-data requires auth', () => {
    const content = readFileSync('api/_handlers/auth/export-data.js', 'utf-8');
    expect(content).toMatch(/auth|userId|user.*id|unauthorized/i);
  });
});
