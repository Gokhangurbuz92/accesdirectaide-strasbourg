/**
 * Launch-readiness item 68 — server performance traces are sampled (10 % by default, SENTRY_TRACES_SAMPLE_RATE between 0 and 1), never 100 % by default;
 * the SDK attaches no personal data by itself; Session Replay stays an explicit opt-in that the release preflight refuses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tracesSampleRate } from '../../api/_utils/sentryServer.js';

describe('Sentry sampling', () => {
  it('10 % by default; a valid rate is used; anything else falls back to 10 %', () => {
    expect(tracesSampleRate(undefined)).toBe(0.1);
    expect(tracesSampleRate('')).toBe(0.1);
    expect(tracesSampleRate('0')).toBe(0);
    expect(tracesSampleRate('0.25')).toBe(0.25);
    for (const bad of ['1.5', '-1', 'all', 'NaN']) expect(tracesSampleRate(bad), bad).toBe(0.1);
  });
  it('the server init never asks for 100 % nor default PII', () => {
    const src = readFileSync('api/_utils/sentryServer.js', 'utf8');
    expect(src).not.toMatch(/tracesSampleRate:\s*1(\.0)?\s*,/);
    expect(src).toMatch(/sendDefaultPii:\s*false/);
  });
  it('the browser keeps Replay off unless VITE_SENTRY_REPLAY=true (which the preflight refuses)', () => {
    const src = readFileSync('src/observability/initSentry.js', 'utf8');
    expect(src).toMatch(/replaysSessionSampleRate: replayEnabled \? 0\.01 : 0/);
    expect(readFileSync('scripts/release-preflight.mjs', 'utf8')).toMatch(/observability\.no_session_replay/);
  });
});
