/**
 * C1 / RA-04 (owner Paket 4: « EVET », hourly read-only public watchdog, low cost, no sensitive data) — the installed GitHub Actions workflow.
 * Pins what the owner approved: hourly, public read-only GETs only, no secret, short time limits, an alert only after two consecutive failed runs,
 * nothing but status codes and public states in the (public) logs.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';

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
