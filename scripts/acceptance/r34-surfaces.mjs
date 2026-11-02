#!/usr/bin/env node
/**
 * R34 — API walk-through of the protected surfaces on an ISOLATED LAB server (synthetic accounts of scripts/acceptance/r31-lab-seed.mjs):
 *   node scripts/acceptance/r34-surfaces.mjs <accounts.json> [base http://127.0.0.1:5173] [--out result.json]
 * Run the server with PRO_MFA_REQUIRED=true to check the ADA Pro second factor end to end (password-only session refused on dossiers, enrolment, session
 * with the factor accepted, refresh keeps it, switching it off refused). Never against production: refuses any base that is not 127.0.0.1 / localhost.
 */
import fs from 'node:fs';
import { generateCode, base32Decode } from '../../api/lib/totp.js';

const [accFile] = process.argv.slice(2).filter((a) => !a.startsWith('http') && !a.startsWith('--') && !a.endsWith('.json.out'));
const base = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('refusing: not a local LAB server'); process.exit(3); }
const acc = JSON.parse(fs.readFileSync(accFile, 'utf8'));
void base32Decode;

const r0 = await fetch(`${base}/api/health`); const cookie = (r0.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const csrf = /__csrf=([^;]+)/.exec(cookie)?.[1];
const call = async (method, path, { token, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie, origin: base, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const totp = (secret, offset = 0) => generateCode(secret, Math.floor(Date.now() / 30000) + offset);
const rows = [];
const check = (surface, name, ok, detail = '') => { rows.push({ surface, name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${surface}] ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 Public
const h = await call('GET', '/api/health'); check('1 Public', 'health', h.status === 200);
const g = await call('GET', '/api/guides'); check('1 Public', 'guides list', g.status === 200 && Array.isArray(g.json));

// 3 ADA Pro — password sign-in, then the second factor
const login = await call('POST', '/api/pro/auth/login', { body: { email: acc.pro.email, password: acc.pro.password } });
check('3 ADA Pro', 'password sign-in', login.status === 200 && login.json?.token, `HTTP ${login.status}`);
const t0 = login.json?.token;
const me0 = await call('GET', '/api/pro/me', { token: t0 });
check('3 ADA Pro', '/me answers a password-only session and says what is required', me0.status === 200 && me0.json?.session?.mfa === false, JSON.stringify(me0.json?.session || null));
const required = me0.json?.session?.mfaRequired === true;
const cases0 = await call('GET', '/api/pro/cases', { token: t0 });
if (required) check('3 ADA Pro', 'dossiers refused to a password-only session (PRO_MFA_REQUIRED)', cases0.status === 403 && cases0.json?.code === 'PRO_MFA_REQUIRED', `HTTP ${cases0.status}`);
else check('3 ADA Pro', 'dossiers open (second factor not required on this server)', cases0.status === 200, `HTTP ${cases0.status}`);
const setup = await call('GET', '/api/pro/mfa-setup', { token: t0 });
check('3 ADA Pro', 'enrolment open to a password-only session', setup.status === 200 && setup.json?.secret, `HTTP ${setup.status}`);
let t1 = null;
if (setup.json?.secret) {
  const en = await call('POST', '/api/pro/mfa-setup', { token: t0, body: { code: totp(setup.json.secret) } });
  t1 = en.json?.token || null;
  check('3 ADA Pro', 'enrolment with a valid code returns a session with the factor', en.status === 200 && t1, `HTTP ${en.status}`);
  const me1 = await call('GET', '/api/pro/me', { token: t1 });
  check('3 ADA Pro', '/me reports the factor', me1.json?.session?.mfa === true);
  const cases1 = await call('GET', '/api/pro/cases', { token: t1 });
  check('3 ADA Pro', 'dossiers open with the factor', cases1.status === 200, `HTTP ${cases1.status}`);
  const ref = await call('POST', '/api/pro/auth/refresh', { token: t1 });
  const me2 = ref.json?.token ? await call('GET', '/api/pro/me', { token: ref.json.token }) : null;
  check('3 ADA Pro', 'refresh keeps the factor', ref.status === 200 && me2?.json?.session?.mfa === true, `HTTP ${ref.status}`);
  if (required) {
    await wait(31000);   // a code is single-use per time step
    const off = await call('DELETE', '/api/pro/mfa-setup', { token: t1, body: { code: totp(setup.json.secret) } });
    check('3 ADA Pro', 'switching the factor off is refused where it is required', off.status === 403, `HTTP ${off.status}`);
    const again = await call('POST', '/api/pro/auth/login', { body: { email: acc.pro.email, password: acc.pro.password } });
    check('3 ADA Pro', 'next sign-in asks for the code (no token on password alone)', again.status === 200 && again.json?.mfa_required === true && !again.json?.token);
  }
}

// 4 Espace Structure (structure admin of the same organization)
const st = await call('GET', '/api/pro/structure', { token: t1 || t0 });
check('4 Structure', 'organization record readable by its administrator', st.status === 200, `HTTP ${st.status}`);
// isolation: a professional of ANOTHER organization does not see this case
// (that professional passes the second factor first when it is required, so a refusal can only come from the isolation)
const lo = await call('POST', '/api/pro/auth/login', { body: { email: acc.other.email, password: acc.other.password } });
let otherToken = lo.json?.token || null;
if (otherToken && required) {
  const st2 = await call('GET', '/api/pro/mfa-setup', { token: otherToken });
  const en2 = st2.json?.secret ? await call('POST', '/api/pro/mfa-setup', { token: otherToken, body: { code: totp(st2.json.secret) } }) : null;
  otherToken = en2?.json?.token || null;
}
const ownList = otherToken ? await call('GET', '/api/pro/cases', { token: otherToken }) : null;
const otherCase = otherToken ? await call('GET', '/api/pro/cases?id=r31-case', { token: otherToken }) : null;
check('3 ADA Pro', 'another organization (session with the factor) works on its own queue but cannot read the case', ownList?.status === 200 && otherCase
  && (otherCase.status === 404 || (otherCase.status === 200 && !JSON.stringify(otherCase.json).includes('r31-dossier'))), `own queue HTTP ${ownList?.status}, case HTTP ${otherCase?.status}`);

// 5 Institutions — no account seeded: the routes refuse an anonymous caller
const inst = await call('GET', '/api/institution/me');
check('5 Institution', 'anonymous caller refused', [401, 403].includes(inst.status), `HTTP ${inst.status}`);

// 6 Administration — named account, password + TOTP
const al = await call('POST', '/api/admin/login', { body: { email: acc.admin.email, password: acc.admin.password } });
check('6 Admin', 'password step asks for the code', al.status === 200 && (al.json?.mfa_required === true || al.json?.mfa_setup_required === true), `HTTP ${al.status}`);
let at = null;
if (al.json?.token) {
  const mv = await call('POST', '/api/admin/mfa-verify', { token: al.json.token, body: { code: totp(acc.admin.totp) } });
  at = mv.json?.token || null;
  check('6 Admin', 'code accepted, session with MFA', mv.status === 200 && at, `HTTP ${mv.status}`);
}
const anon = await call('GET', '/api/admin/dashboard');
check('6 Admin', 'anonymous caller refused', [401, 403].includes(anon.status), `HTTP ${anon.status}`);
if (at) {
  const dash = await call('GET', '/api/admin/dashboard', { token: at });
  check('6 Admin', 'dashboard readable with MFA', dash.status === 200, `HTTP ${dash.status}`);
  // 7 Operations — a platform action needs a just-in-time elevation on top of MFA
  const plat = await call('POST', '/api/admin/platform', { token: at, body: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true } });
  check('7 Operations', 'platform action refused without elevation', [403, 401].includes(plat.status), `HTTP ${plat.status}`);
}

const summary = { base, at: new Date().toISOString(), proMfaRequired: required, pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length };
console.log(`SURFACES ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
