/**
 * The automatic startup of the owner's LAB (scripts/lab-supervisor.mjs, kept alive by a user LaunchAgent): the rules of the supervisor, which never run a second
 * server, give port 3000 to a native QA campaign, restart after a crash with a growing delay and never in a loop, keep the owner's temporary stop, write bounded
 * redacted logs; and the LaunchAgent itself (login start, restart only after a crash, Paris time, no secret).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sup = await import('../../scripts/lab-supervisor.mjs');
const T0 = Date.parse('2026-10-26T08:00:00Z');

describe('the supervisor’s rules', () => {
  it('one LAB server: a running one (its own or a Terminal’s) is never doubled; a port held by another program is waited for', () => {
    expect(sup.decide({ child: 'running', now: T0 })).toMatchObject({ action: 'wait', state: 'running' });
    expect(sup.decide({ child: null, labElsewhere: true, now: T0 })).toMatchObject({ action: 'wait', state: 'running-elsewhere' });
    expect(sup.decide({ child: null, portBusy: true, now: T0 })).toMatchObject({ action: 'wait', state: 'port-busy' });
    expect(sup.decide({ child: null, now: T0 })).toMatchObject({ action: 'start' });
  });

  it('a native QA campaign has priority: the server is stopped at once and not started while it runs', () => {
    expect(sup.decide({ qa: true, child: 'running', now: T0 })).toMatchObject({ action: 'stop-child', state: 'suspended-qa', fast: true });
    expect(sup.decide({ qa: true, child: null, now: T0 })).toMatchObject({ action: 'wait', state: 'suspended-qa' });
    expect(sup.decide({ qa: true, child: 'stopping', now: T0 })).toMatchObject({ action: 'wait' });
  });

  it('the hand-over before a campaign: held while it runs and five minutes more (a launcher stopped at its preflight finds the port free when run again), then the server comes back; unused, it expires after three hours', () => {
    const m = { at: T0 };
    expect(sup.handover(null, { qaRunning: false, now: T0 })).toEqual({ active: false });
    expect(sup.handover(m, { qaRunning: false, now: T0 + 60000 })).toEqual({ active: true });
    const seen = sup.handover(m, { qaRunning: true, now: T0 + 120000 });
    expect(seen).toMatchObject({ active: true, marker: { at: T0, qaSeenAt: T0 + 120000 } });
    expect(sup.handover(seen.marker, { qaRunning: false, now: T0 + 120000 + 4 * 60000 })).toEqual({ active: true });
    expect(sup.handover(seen.marker, { qaRunning: false, now: T0 + 120000 + 5 * 60000 })).toMatchObject({ active: false, clear: true, why: 'campagne de QA terminée' });
    expect(sup.handover(m, { qaRunning: false, now: T0 + 3 * 3600000 + 1 })).toMatchObject({ active: false, clear: true });
  });

  it('the owner’s stop holds; a crash waits 10 s, 30 s, 2 min, 5 min, 15 min, and six crashes in an hour hold it for an hour (never a loop)', () => {
    expect(sup.decide({ stopped: true, child: 'running', now: T0 })).toMatchObject({ action: 'stop-child', state: 'stopped' });
    expect(sup.decide({ stopped: true, child: null, now: T0 })).toMatchObject({ action: 'wait', state: 'stopped' });
    expect(sup.decide({ child: null, now: T0, nextStartAt: T0 + 5000 })).toMatchObject({ action: 'wait', state: 'backoff' });
    const crashes = [];
    const delays = [];
    for (let i = 0; i < 7; i += 1) { crashes.push(T0 + i * 1000); delays.push(sup.restartDelay(crashes, T0 + i * 1000)); }
    expect(delays).toEqual([10000, 30000, 120000, 300000, 900000, 3600000, 3600000]);
    expect(sup.restartDelay([T0 - 2 * 3600000], T0)).toBe(0);   // an old crash is forgotten
  });
});

describe('logs and the LaunchAgent', () => {
  it('no secret in a log line: passwords, tokens, keys, bearer and JWT values, a password inside a database URL', () => {
    const line = sup.redact('JWT_SECRET=abc123 "password":"hunter2" token: xyz Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl postgresql://lab:pa55@127.0.0.1:5432/ada ADA_ENCRYPTION_KEY=00ff');
    for (const secret of ['abc123', 'hunter2', 'xyz', 'pa55', '00ff', 'eyJhbGciOiJIUzI1NiJ9']) expect(line).not.toContain(secret);
    expect(line).toContain('postgresql://lab:[masqué]@127.0.0.1:5432/ada');
    expect(sup.redact('[veille] veille success en 24 min')).toBe('[veille] veille success en 24 min');
  });

  it('bounded logs: a file never grows past its size, at most three files are kept', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-log-'));
    try {
      const log = new sup.RotatingLog(path.join(dir, 'server.log'), { maxBytes: 400, keep: 3 });
      for (let i = 0; i < 60; i += 1) log.write(`ligne ${i} ${'x'.repeat(40)}`);
      const files = fs.readdirSync(dir).sort();
      expect(files).toEqual(['server.log', 'server.log.1', 'server.log.2']);
      for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThanOrEqual(400);
      expect(fs.readFileSync(path.join(dir, 'server.log'), 'utf8')).toContain('ligne 59');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('the LaunchAgent starts the supervisor at login, restarts it only after a crash and at most once a minute, in Paris time, with no secret', () => {
    const p = sup.plist({ node: '/opt/homebrew/opt/node@22/bin/node', root: '/Users/x/RC7', envFile: '/Users/x/.ada-lab/lab.env', log: '/Users/x/.ada-lab/logs/launchd.log' });
    expect(p).toContain(`<key>Label</key><string>${sup.LABEL}</string>`);
    expect(p).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(p).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>/);
    expect(p).toMatch(/<key>ThrottleInterval<\/key><integer>60<\/integer>/);
    expect(p).toMatch(/<key>TZ<\/key><string>Europe\/Paris<\/string>/);
    expect(p).toContain('<string>/Users/x/RC7/scripts/lab-local.mjs</string>\n    <string>supervise</string>\n    <string>--env</string>\n    <string>/Users/x/.ada-lab/lab.env</string>');
    expect(p).not.toMatch(/DATABASE_URL|JWT|SECRET|PASSWORD|0\.0\.0\.0/i);
  });
});
