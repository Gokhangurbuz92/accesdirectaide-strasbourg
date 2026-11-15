/**
 * RA-01 — the security look-back follows the real schedule of the health check. The module was written for a 5-minute check with a 15-minute window; the
 * schedule became hourly and 45 minutes of every hour were never read. Pinned here:
 *  - the default window is at least the interval of /api/cron/health-alert READ FROM vercel.json (a schedule change breaks this test, not the alerting);
 *  - a fake clock runs the check hour after hour over synthetic events: every event is counted by a check, none after it produced an alert, and a late or
 *    skipped run looks back to the previous check.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { securityThresholds, securityWindows, nextSecurityCheckState, HEALTH_CHECK_INTERVAL_MINUTES, WINDOW_OVERLAP_MINUTES, MAX_LOOKBACK_MINUTES } from '../../api/_services/security-signals.js';

const root = path.resolve(import.meta.dirname, '../..');
/** the longest gap, in minutes, between two runs of a five-field cron expression (minute and hour fields: numbers, lists, ranges, steps, « * ») */
function cronMaxGapMinutes(expr) {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  if (dom !== '*' || mon !== '*' || dow !== '*') throw new Error(`not a daily-or-faster schedule: ${expr}`);
  const field = (f, max) => { const out = new Set(); for (const part of f.split(',')) { const [range, step = '1'] = part.split('/'); const [a, b] = range === '*' ? [0, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), step === '1' && !part.includes('/') ? Number(range) : max];
    for (let v = a; v <= b; v += Number(step)) out.add(v); } return [...out].sort((x, y) => x - y); };
  const times = []; for (const hh of field(h, 23)) for (const mm of field(m, 59)) times.push(hh * 60 + mm);
  times.sort((a, b) => a - b);
  return Math.max(...times.map((t, i) => (i === 0 ? t + 1440 - times[times.length - 1] : t - times[i - 1])));
}

describe('RA-01 security look-back follows the schedule', () => {
  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons.find((c) => c.path === '/api/cron/health-alert').schedule;

  it('the cron helper reads ordinary schedules', () => {
    expect(cronMaxGapMinutes('7 * * * *')).toBe(60);
    expect(cronMaxGapMinutes('*/5 * * * *')).toBe(5);
    expect(cronMaxGapMinutes('0 */6 * * *')).toBe(360);
    expect(cronMaxGapMinutes('37 0-5 * * *')).toBe(19 * 60);
  });

  it('the default window covers the interval of the health check in vercel.json, with an overlap', () => {
    const interval = cronMaxGapMinutes(schedule);
    expect(HEALTH_CHECK_INTERVAL_MINUTES).toBe(interval);
    expect(WINDOW_OVERLAP_MINUTES).toBeGreaterThan(0);
    expect(securityThresholds({}).windowMinutes).toBe(interval + WINDOW_OVERLAP_MINUTES);
    expect(securityWindows({ now: new Date('2031-01-01T12:07:00Z'), thresholds: securityThresholds({}) }).exports.windowMinutes).toBeGreaterThanOrEqual(interval);
  });

  /** a fake clock: run the check at each `runs` minute over `events` (minutes); returns, per run, the events counted for the alert decision */
  const simulate = ({ runs, events, env = {}, alertAt = () => false, kvLost = () => false }) => {
    const t0 = Date.parse('2031-01-01T00:00:00Z'); const at = (min) => new Date(t0 + min * 60_000);
    let state = null; const seen = [];
    for (const run of runs) {
      const now = at(run); const st = kvLost(run) ? null : state;
      const w = securityWindows({ now, thresholds: securityThresholds(env), state: st }).failedLogins;
      const counted = events.filter((e) => at(e) > w.since && at(e) <= now);
      seen.push({ run, counted, windowMinutes: w.windowMinutes });
      state = nextSecurityCheckState({ now, previous: st, delivered: alertAt(run, counted) ? ['failedLogins'] : [] });
    }
    return seen;
  };
  const hourly = [7, 67, 127, 187, 247];

  it('an event at any minute of the hour is counted by the next check (the former 15-minute window missed minutes 07–52)', () => {
    const events = Array.from({ length: 240 }, (_, i) => i + 8);           // one event per minute after the first run
    const seen = simulate({ runs: hourly, events });
    const counted = new Set(seen.flatMap((s) => s.counted));
    expect(events.filter((e) => !counted.has(e))).toEqual([]);
    expect(seen[1].windowMinutes).toBe(70);
  });

  it('a burst that raised a delivered alert is not counted by the following checks; later events are', () => {
    const seen = simulate({ runs: hourly, events: [60, 61, 62, 63, 64, 70, 71], alertAt: (run, counted) => counted.length >= 5 });
    expect(seen[1].counted).toEqual([60, 61, 62, 63, 64]);                 // 67: the burst, alerted
    expect(seen[2].counted).toEqual([70, 71]);                             // 127: only what came after the alert, although 60–64 are inside the 70-minute overlap
  });

  it('without an alert the overlap keeps a burst that straddles two checks visible as a whole', () => {
    const seen = simulate({ runs: hourly, events: [64, 65, 66, 68, 69, 70], alertAt: (run, counted) => counted.length >= 5 });
    expect(seen[1].counted).toEqual([64, 65, 66]);                         // under the threshold at 67
    expect(seen[2].counted).toEqual([64, 65, 66, 68, 69, 70]);             // the six together at 127
  });

  it('a late or skipped run looks back to the previous check, never further than the cap', () => {
    const seen = simulate({ runs: [7, 67, 300], events: [100, 150, 299] });
    expect(seen[2].counted).toEqual([100, 150, 299]);
    expect(seen[2].windowMinutes).toBe(233);
    const far = securityWindows({ now: new Date('2031-01-10T00:00:00Z'), thresholds: securityThresholds({}), state: { lastCheckAt: '2031-01-01T00:00:00Z' } });
    expect(far.failedLogins.windowMinutes).toBe(MAX_LOOKBACK_MINUTES);
  });

  it('a window configured below the interval (ALERT_SECURITY_WINDOW_MINUTES=15) leaves no hole once a previous check is known', () => {
    const events = Array.from({ length: 180 }, (_, i) => i + 8);
    const seen = simulate({ runs: hourly.slice(0, 4), events, env: { ALERT_SECURITY_WINDOW_MINUTES: '15' } });
    const counted = new Set(seen.flatMap((s) => s.counted));
    expect(events.filter((e) => e <= 187 && !counted.has(e))).toEqual([]);
  });

  it('state lost (KV unreachable): the default sliding window alone still covers the hour', () => {
    const events = Array.from({ length: 180 }, (_, i) => i + 8);
    const seen = simulate({ runs: hourly.slice(0, 4), events, kvLost: () => true });
    const counted = new Set(seen.flatMap((s) => s.counted));
    expect(events.filter((e) => e <= 187 && !counted.has(e))).toEqual([]);
  });

  it('a state from the future or unreadable is ignored; the kept state holds timestamps only', () => {
    const now = new Date('2031-01-01T12:07:00Z'); const t = securityThresholds({});
    const plain = securityWindows({ now, thresholds: t });
    expect(securityWindows({ now, thresholds: t, state: { lastCheckAt: '2031-06-01T00:00:00Z', alertedThrough: { failedLogins: 'x', mfaFailures: '2031-06-01T00:00:00Z' } } })).toEqual(plain);
    const next = nextSecurityCheckState({ now, previous: { alertedThrough: { exports: '2031-01-01T11:07:00Z', mfaFailures: '2030-12-01T00:00:00Z' } }, delivered: ['failedLogins'] });
    expect(next).toEqual({ lastCheckAt: now.toISOString(), alertedThrough: { failedLogins: now.toISOString(), exports: '2031-01-01T11:07:00.000Z' } });
  });
});
