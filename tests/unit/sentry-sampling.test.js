/**
 * Launch-readiness item 68 / R5-S1 — no server performance trace by default (SENTRY_SERVER_TRACING=on and SENTRY_TRACES_SAMPLE_RATE both needed), never 100 % by default;
 * the SDK attaches no personal data by itself; Session Replay stays an explicit opt-in that the release preflight refuses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tracesSampleRate } from '../../api/_utils/sentryServer.js';

describe('Sentry sampling', () => {
  it('R5-S1: no server tracing by default — only SENTRY_SERVER_TRACING=on AND a rate in ]0, 1] enable it', () => {
    expect(tracesSampleRate(undefined, undefined)).toBeUndefined();
    expect(tracesSampleRate('', 'on')).toBeUndefined();
    expect(tracesSampleRate('0.25', undefined)).toBeUndefined();   // a rate alone does nothing
    expect(tracesSampleRate('0.25', 'off')).toBeUndefined();
    expect(tracesSampleRate('0', 'on')).toBeUndefined();
    expect(tracesSampleRate('0.25', 'on')).toBe(0.25);
    expect(tracesSampleRate('1', 'on')).toBe(1);
    for (const bad of ['1.5', '-1', 'all', 'NaN']) expect(tracesSampleRate(bad, 'on'), bad).toBeUndefined();
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
