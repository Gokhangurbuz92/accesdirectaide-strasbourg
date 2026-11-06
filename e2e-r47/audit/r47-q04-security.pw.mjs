/**
 * R47 / Q04 — the software side of « Security: DAST, dependency audit, secret rotation, KMS », end to end on the BUILT app + REAL API (scripts/lab-server.mjs,
 * shipped vercel.json headers, disposable LAB PostgreSQL at the Production shape 0042) in real Chrome, plus the two secret guards the release relies on:
 *   1 disclosure: /.well-known/security.txt (RFC 9116) is served as text, unexpired and valid for at most a year, and its Contact link — followed on this
 *     origin — opens the help form with the security category and its guidance already chosen;
 *   2 detection: refused sign-ins become security signals: the administrator page counts them and, at the configured burst threshold (the LAB runner sets
 *     ALERT_FAILED_LOGIN_BURST=3), the signals API says the failed-login alert is due — counts only, no address or e-mail in the answer;
 *   3 secret guards: the repository scan (scripts/security-secrets-scan.mjs → gitleaks on the git-listed files) refuses a fixture repository holding a
 *     planted, synthetic credential and passes the same repository without it; the bundle scan (scripts/bundle-secret-scan.mjs) finds a server secret value
 *     planted in a copy of a bundle file, and the served build itself carries none of the LAB server's secret values.
 * Env: R47_BASE, R47_ADMIN_TOKEN (a signed LAB administrator session — never printed), R47_DIST (the served build), R47_SERVER_SECRETS (a file with the
 * server's secret values, one NAME=value per line, mode 600 — read, never printed). Penetration test, secret rotation and KMS stay owner/external actions.
 */
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanBundle } from '../../scripts/bundle-secret-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.R47_BASE || 'http://127.0.0.1:5194';
const TOKEN = process.env.R47_ADMIN_TOKEN || '';
const DIST = process.env.R47_DIST || path.join(ROOT, 'dist');

const ctx = async (browser, { admin = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(([tok]) => {
    try { localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); if (tok) sessionStorage.setItem('access_token', tok); } catch { /* storage refused */ }
  }, [admin ? TOKEN : '']);
  return context;
};

test('1 disclosure: security.txt is valid and its Contact link opens the security help form', async ({ browser, request }) => {
  const r = await request.get(`${BASE}/.well-known/security.txt`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^text\/plain/);
  const txt = await r.text();
  const field = (name) => [...txt.matchAll(new RegExp(`^${name}: (.+)$`, 'gm'))].map((m) => m[1].trim());
  const expires = new Date(field('Expires')[0]);
  expect(Number.isNaN(expires.getTime())).toBe(false);
  expect(expires.getTime()).toBeGreaterThan(Date.now());
  expect(expires.getTime() - Date.now(), 'RFC 9116 §2.5.5: less than a year ahead').toBeLessThanOrEqual(366 * 86_400_000);
  expect(field('Canonical')[0]).toMatch(/^https:\/\/[^/]+\/\.well-known\/security\.txt$/);
  expect(field('Preferred-Languages')[0]).toMatch(/\bfr\b/);
  const contacts = field('Contact');
  expect(contacts.some((c) => c.startsWith('mailto:'))).toBe(true);
  const web = contacts.find((c) => c.startsWith('https://'));
  expect(web).toBeTruthy();
  // the same host as the canonical address, and the link really leads somewhere on this product
  expect(new URL(web).host).toBe(new URL(field('Canonical')[0]).host);
  const u = new URL(web);
  const context = await ctx(browser); const page = await context.newPage();
  await page.goto(`${BASE}${u.pathname}${u.search}`);
  await expect(page.getByTestId('contact-security-note')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#sujet')).toContainText('Je signale un problème de sécurité (vulnérabilité)');
  await context.close();
});

test('2 detection: refused sign-ins are counted and the burst alert is due at the threshold', async ({ browser }) => {
  expect(TOKEN, 'R47_ADMIN_TOKEN').not.toBe('');
  const context = await ctx(browser, { admin: true }); const page = await context.newPage();
  await page.goto(`${BASE}/admin/securite`);
  await expect(page.getByRole('heading', { level: 1, name: 'Signaux de sécurité' })).toBeVisible({ timeout: 30000 });
  const before = Number(await page.getByTestId('admin-security-failed-logins-count').textContent());
  const headers = { authorization: `Bearer ${TOKEN}` };
  const signals0 = await (await context.request.get(`${BASE}/api/admin/security-signals`, { headers })).json();
  const threshold = signals0.counts.thresholds.failedLogins;
  expect(threshold, 'the LAB runner sets ALERT_FAILED_LOGIN_BURST=3').toBe(3);
  const csrf = (await context.cookies()).find((c) => /csrf/i.test(c.name));
  const need = Math.max(0, threshold - signals0.counts.failedLogins.count);
  for (let i = 0; i < need; i += 1) {
    const r = await context.request.post(`${BASE}/api/auth/login`, { data: { email: `r47-nobody-${i}-${Date.now()}@example.test`, password: 'Wrong-password-1' }, headers: csrf ? { 'x-csrf-token': csrf.value } : {} });
    expect(r.status()).toBe(401);
  }
  const signals = await (await context.request.get(`${BASE}/api/admin/security-signals`, { headers })).json();
  expect(signals.counts.failedLogins.count).toBeGreaterThanOrEqual(threshold);
  expect(signals.alertsNow.map((a) => a.name)).toContain('security.failed_login_burst');
  const body = JSON.stringify(signals);
  expect(body, 'aggregates only: no e-mail address').not.toMatch(/@example\.test/);
  expect(body, 'no IP address').not.toMatch(/\b127\.0\.0\.1\b/);
  await page.reload();
  await expect(page.getByTestId('admin-security-failed-logins-count')).toHaveText(String(before + need));
  await context.close();
});

test('3 secret guards: the repository scan refuses a planted credential; the bundle scan finds a planted value; the served build has none', async () => {
  // a synthetic credential assembled at run time (never committed): an AWS-style access key id + secret, the shape gitleaks' default rules detect
  const keyId = ['AKIA', 'R47Q', 'TEST', 'AUDI', 'T7XZ'].join('');
  const secret = Buffer.from('r47-audit-synthetic-secret-not-a-real-credential').toString('base64').slice(0, 40);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-secret-guard-'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  try {
    git('init', '-q'); fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n'); git('add', '.');
    const scan = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/security-secrets-scan.mjs')], { cwd: repo, encoding: 'utf8' });
    const clean = scan();
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);
    fs.writeFileSync(path.join(repo, 'config.js'), `export const aws = { accessKeyId: '${keyId}', secretAccessKey: '${secret}' };\n`); git('add', '.');
    const dirty = scan();
    expect(dirty.status, 'a planted credential stops the scan (non-zero exit)').toBe(1);
    expect(`${dirty.stdout}${dirty.stderr}`, 'the finding is redacted').not.toContain(secret);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }

  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-bundle-guard-'));
  try {
    const planted = `r47-planted-${Date.now()}-value`;
    fs.writeFileSync(path.join(bundle, 'index.js'), `console.log(${JSON.stringify(planted)});`);
    const found = scanBundle(bundle, { R47_FAKE_API_KEY: planted, VITE_PUBLIC_VALUE: planted });
    expect(found.leaks).toEqual([{ name: 'R47_FAKE_API_KEY', file: 'index.js' }]);
  } finally { fs.rmSync(bundle, { recursive: true, force: true }); }

  // the build this LAB serves vs the LAB server's own secret values (the runner's file)
  const file = process.env.R47_SERVER_SECRETS;
  expect(file && fs.existsSync(file), 'R47_SERVER_SECRETS').toBeTruthy();
  const env = Object.fromEntries(fs.readFileSync(String(file), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const served = scanBundle(DIST, env);
  expect(served.checked.length).toBeGreaterThanOrEqual(4);
  expect(served.leaks).toEqual([]);
});
