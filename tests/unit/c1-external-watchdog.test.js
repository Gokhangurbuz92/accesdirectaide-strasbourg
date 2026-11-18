/**
 * C1 / RA-04 (owner Paket 4: « EVET », hourly read-only public watchdog, low cost, no sensitive data) — the installed GitHub Actions workflow.
 * Pins what the owner approved: hourly, public read-only GETs only, no secret, short time limits, an alert only after two consecutive failed runs,
 * nothing but status codes and public states in the (public) logs.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const text = fs.readFileSync('.github/workflows/healthcheck.yml', 'utf8');
const wf = yaml.load(text);
const steps = wf.jobs.probe.steps;
const scripts = steps.map((s) => s.run || '').join('\n');

describe('C1 external watchdog workflow', () => {
  it('hourly (and on demand), short time limits, permissions limited to reading its own run history', () => {
    expect(wf.on.schedule).toEqual([{ cron: '12 * * * *' }]); expect(wf.on.workflow_dispatch).toBeTruthy();
    expect(wf.permissions).toEqual({ actions: 'read' });
    expect(wf.jobs.probe['timeout-minutes']).toBeLessThanOrEqual(15);
    expect(scripts).toMatch(/--max-time 15/); expect(scripts).not.toMatch(/--max-time (1[6-9]|[2-9]\d)/);
  });

  it('read-only GETs of public paths only: no secret, no cron or administrator route, no write method, no request body', () => {
    expect(text).not.toMatch(/secrets\./); expect(text).not.toMatch(/CRON_SECRET|ADMIN_TOKEN|Authorization|--user\b|-u /i);
    const paths = [...scripts.matchAll(/probe '?(\/[^\s']*)'?/g)].map((m) => m[1]);
    expect(paths).toEqual(['/', '/aides', '/demarches', '/structures', '/sitemap.xml', '/api/health', '/api/health/ready', '/api/status', '/api/aides?pageSize=1']);
    for (const p of paths) expect(p).not.toMatch(/^\/api\/(cron|admin|monitor|pro|institution|auth|compte)|^\/admin/);
    expect(scripts).not.toMatch(/curl[^\n|]*\s-(X|d|F|T)\s|--data|--request|--upload-file|--form/);   // up to the pipe: `tr -d` after it is not curl
    expect(wf.jobs.probe.env.SITE).toBe('https://www.accesdirectaide.fr');
  });

  it('logs hold codes and public states only (never a response body)', () => {
    expect(scripts).toMatch(/curl -s -o \/dev\/null -w '%\{http_code\}'/);
    expect(scripts).not.toMatch(/echo "\$body"|printf '%s\\n' "\$body"|cat .*body/);
  });

  it('alerts only after two consecutive failed runs (then every 6th): the probe never fails the run by itself', () => {
    const probe = steps.find((s) => s.id === 'probe'); const strike = steps.find((s) => s.id === 'strike');
    expect(probe['continue-on-error']).toBe(true);
    expect(strike.if).toBe("steps.probe.outcome == 'failure'");
    expect(strike.name).toBe(strike.env.STRIKE);   // the marker the next runs look for is this step's own name
    expect(strike.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(strike.run).toMatch(/\[ "\$streak" -eq 2 \] \|\| \{ \[ "\$streak" -gt 2 \] && \[ \$\(\(streak % 6\)\) -eq 0 \]; \}/);
  });
});

// FA-D11 (18/11/2026): GitHub's schedule is best effort — « can be delayed during periods of high loads … some queued jobs may be dropped »
// (docs.github.com, events-that-trigger-workflows, read 18/11/2026). Observed: the workflow, registered 17/11 13:32 UTC, ran ONCE (22:16 UTC) in the
// following 11 hours. « Two consecutive failed runs » then no longer means « about two hours »: an outage could stay silent for a day. The strike step
// therefore also alerts at the FIRST failed run when the previous run is more than two hours old (or there is none): no confirming run is coming soon.
describe('C1 strike step when GitHub drops scheduled runs (behaviour, fake gh)', () => {
  const strike = steps.find((s) => s.id === 'strike');
  /** runs the strike script with a fake `gh`: `history` = previous completed runs, newest first: [{ id, ageMinutes, struck }] */
  const runStrike = (history) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-c1-gh-'));
    const now = Date.now();
    const list = history.map((h) => `${h.id} ${new Date(now - h.ageMinutes * 60000).toISOString().replace(/\.\d+Z$/, 'Z')}`).join('\n');
    const jobs = Object.fromEntries(history.map((h) => [String(h.id), h.struck ? '1' : '0']));
    fs.writeFileSync(path.join(dir, 'list.txt'), list ? `${list}\n` : '');
    fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
case "$2" in
  */workflows/healthcheck.yml/runs*) cat "${dir}/list.txt" ;;
  */jobs) id=$(echo "$2" | sed 's#.*/runs/\\([0-9]*\\)/jobs#\\1#'); case "$id" in ${Object.entries(jobs).map(([k, v]) => `${k}) echo ${v} ;;`).join(' ')} *) echo 0 ;; esac ;;
esac
`, { mode: 0o755 });
    const r = spawnSync('bash', ['-c', strike.run], { encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}`, REPO: 'o/r', RUN_ID: '999', STRIKE: strike.env.STRIKE, GH_TOKEN: 'x' } });
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('hourly runs: a single failure does not alert, the 2nd consecutive one does (owner rule unchanged)', () => {
    expect(runStrike([{ id: 1, ageMinutes: 60, struck: false }, { id: 2, ageMinutes: 120, struck: false }]).status).toBe(0);
    expect(runStrike([{ id: 1, ageMinutes: 60, struck: true }, { id: 2, ageMinutes: 120, struck: false }]).status).toBe(1);
  });

  it('dropped schedule: the first failure alerts when the previous run is more than two hours old, or when there is no previous run', () => {
    const r = runStrike([{ id: 1, ageMinutes: 600, struck: false }]);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/previous run was \d+ minutes ago/);
    expect(runStrike([]).status).toBe(1);
  });
});
