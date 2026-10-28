import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import { redactForLog, redactValue } from '../../api/_utils/redact.js';

describe('redact', () => {
  it('redacts common secret keys and bodies', () => {
    const input = {
      authorization: 'Bearer SECRET',
      cookie: 'sid=SECRET',
      token: 'SECRET',
      password: 'SECRET',
      secret: 'SECRET',
      body: { hello: 'world' },
      nested: {
        apiKey: 'SECRET',
      },
    };

    const out = redactForLog(input);

    expect(out.authorization).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.body).toBe('[REDACTED_BODY]');
    expect(out.nested).toEqual({ apiKey: '[REDACTED]' });
  });

  it('masks basic PII inside strings', () => {
    const out = redactValue('Contact: alice@example.com / 0612345678');
    expect(String(out)).toContain('a***@example.com');
    expect(String(out)).toContain('06******78');
  });

  it('truncates long strings', () => {
    const out = redactValue('a'.repeat(300));
    expect(String(out).length).toBeLessThanOrEqual(203);
    expect(String(out)).toMatch(/\.{3}$/);
  });
});

