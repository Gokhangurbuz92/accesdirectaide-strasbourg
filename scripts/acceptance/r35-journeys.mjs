#!/usr/bin/env node
/**
 * R35 — HTTP end-to-end walk-through of the protected workflows on an ISOLATED LAB server (synthetic accounts of scripts/acceptance/r31-lab-seed.mjs plus the R35 extra
 * seed: a verified citizen, a throwaway citizen, a third organization, an institution account under a signed agreement, a dossier for the documents journey):
 *   CRON_SECRET=<the LAB server's> node scripts/acceptance/r35-journeys.mjs <accounts.json> [base http://127.0.0.1:5173] [--origin http://127.0.0.1:5173]
 *     [--beta http://127.0.0.1:5174] [--out result.json]
 * Journeys: 1 citizen, 2 booking, 3 pro referral / case access, 4 structure schedule, 5 documents, 6 institution, 7 admin, 8 operations, 9 R35 per-surface beta switch
 * (only with --beta: a second server started with ADA_PUBLIC_BETA_RESTRICTED=1 ADA_BETA_OPEN_SURFACES=appointments).
 * The server must run with PRO_MFA_REQUIRED=true (every professional enrols its second factor here). Never against production: refuses any base that is not
 * 127.0.0.1 / localhost. Writes synthetic data only. Never prints a credential.
 * --origin: the Origin header sent with every request (an origin the API accepts locally: http://127.0.0.1:5173 or :3000) — useful when the LAB server listens on another port.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { generateCode } from '../../api/lib/totp.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const optValues = new Set(['--origin', '--beta', '--out'].map(opt).filter(Boolean));
const [accFile] = args.filter((a) => !a.startsWith('--') && !a.startsWith('http') && !optValues.has(a));
const base = (args.find((a) => a.startsWith('http') && !optValues.has(a)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const origin = (opt('--origin') || base).replace(/\/$/, '');
const betaBase = opt('--beta') ? opt('--beta').replace(/\/$/, '') : null;
const out = opt('--out');
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
for (const b of [base, origin, betaBase].filter(Boolean)) if (!LOCAL.test(b)) { console.error('refusing: not a local LAB server'); process.exit(3); }
if (!accFile) { console.error('usage: r35-journeys.mjs <accounts.json> [base] [--origin o] [--beta b] [--out f]'); process.exit(2); }
const acc = JSON.parse(fs.readFileSync(accFile, 'utf8'));
const CRON_SECRET = process.env.CRON_SECRET || '';

// ───────── client: one cookie jar per actor (CSRF double-submit cookie + session cookie), Bearer token optional
const SECRET_KEYS = /password|token|secret|code|fileBase64/i;
const redact = (v) => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '<redacted>' : redact(x)]));
  return v;
};
async function client(b = base) {
  const jar = new Map();
  const take = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  take(await fetch(`${b}/api/health`));
  const c = {
    jar,
    async call(method, path, { token, body, headers = {}, raw = false } = {}) {
      const r = await fetch(`${b}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('__csrf') || '', cookie: cookie(), origin,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      take(r);
      const buf = Buffer.from(await r.arrayBuffer());
      let json = null; if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } }
      return { status: r.status, json, buf, type: r.headers.get('content-type') || '' };
    },
  };
  return c;
}
const totp = (secret, offset = 0) => generateCode(secret, Math.floor(Date.now() / 30000) + offset);

// ───────── results
const rows = [];
const brief = (r) => (r && typeof r === 'object' && 'status' in r ? { status: r.status, body: r.json ? JSON.stringify(redact(r.json)).slice(0, 300) : (r.type ? `<${r.type} ${r.buf?.length ?? 0} bytes>` : null) } : r);
function check(journey, step, input, expected, actual, ok) {
  const row = { journey, step, input: redact(input), expected, actual: brief(actual), ok: Boolean(ok) };
  rows.push(row);
  console.log(`${row.ok ? 'PASS' : 'FAIL'} [${journey}] ${step} — expected ${expected}; got ${typeof row.actual === 'object' ? `HTTP ${row.actual?.status}` : row.actual}${row.ok ? '' : ` ${row.actual?.body || ''}`}`);
  return row.ok;
}
const has = (r, s) => JSON.stringify(r?.json ?? '').includes(s);
const day = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);

// ───────── sign-ins
async function proSession(who) {
  const c = await client();
  const lo = await c.call('POST', '/api/pro/auth/login', { body: { email: acc[who].email, password: acc[who].password } });
  let t = lo.json?.token || null;
  const st = t ? await c.call('GET', '/api/pro/mfa-setup', { token: t }) : null;
  if (st?.json?.secret) { const en = await c.call('POST', '/api/pro/mfa-setup', { token: t, body: { code: totp(st.json.secret) } }); t = en.json?.token || null; }
  return { c, token: t, login: lo };
}
async function citizenSession(who) {
  const c = await client();
  const lo = await c.call('POST', '/api/auth/login', { body: { email: acc[who].email, password: acc[who].password } });
  return { c, login: lo, ok: lo.status === 200 && c.jar.has('ada_user_session') };
}

const anon = await client();
const J1 = '1 Citizen', J2 = '2 Booking', J3 = '3 Pro', J4 = '4 Structure', J5 = '5 Documents', J6 = '6 Institution', J7 = '7 Admin', J8 = '8 Operations', J9 = '9 Beta switch';

// ═════════ 1 Citizen
{
  const bad = await anon.call('POST', '/api/auth/login', { body: { email: acc.citizen.email, password: 'wrong-password-R35!' } });
  check(J1, 'login with a wrong password refused', { email: acc.citizen.email }, '401, no session cookie', bad, bad.status === 401 && !anon.jar.has('ada_user_session'));
}
const cit = await citizenSession('citizen');
check(J1, 'login of the seeded verified citizen', { email: acc.citizen.email }, '200 + ada_user_session cookie', cit.login, cit.ok);
const C = cit.c;
{
  const me = await C.call('GET', '/api/auth/me');
  check(J1, 'auth/me answers the session', {}, '200 naming the citizen', me, me.status === 200 && has(me, acc.citizen.email));
  const a = await anon.call('GET', '/api/citizen/profile');
  check(J1, 'profile refused without a session', {}, '401', a, a.status === 401);
  const up = await C.call('PUT', '/api/citizen/profile', { body: { displayName: 'Citoyen fictif R35', preferredLanguage: 'de' } });
  check(J1, 'profile update with preferredLanguage de', { displayName: 'Citoyen fictif R35', preferredLanguage: 'de' }, '200, profile.preferredLanguage = de', up, up.status === 200 && up.json?.account?.profile?.preferredLanguage === 'de');
  const bl = await C.call('PUT', '/api/citizen/profile', { body: { preferredLanguage: 'xx' } });
  check(J1, 'unsupported language refused', { preferredLanguage: 'xx' }, '400 UNSUPPORTED_LANGUAGE', bl, bl.status === 400 && bl.json?.error === 'UNSUPPORTED_LANGUAGE');
  const g = await C.call('GET', '/api/citizen/profile');
  check(J1, 'profile read back', {}, '200, preferredLanguage de, displayName kept', g, g.status === 200 && g.json?.account?.profile?.preferredLanguage === 'de' && g.json?.account?.profile?.displayName === 'Citoyen fictif R35');

  const fav = { entityType: 'aide', entityId: 'r31-aide-apl' };
  const fa = await C.call('POST', '/api/citizen/favorites', { body: fav });
  check(J1, 'favorite added (published aide)', fav, '200', fa, fa.status === 200);
  const fl = await C.call('GET', '/api/citizen/favorites');
  check(J1, 'favorites list contains it', {}, '200 listing r31-aide-apl', fl, fl.status === 200 && has(fl, 'r31-aide-apl'));
  const fx = await C.call('POST', '/api/citizen/favorites', { body: { entityType: 'aide', entityId: 'r35-does-not-exist' } });
  check(J1, 'favorite of an unknown / unpublished record refused', { entityType: 'aide', entityId: 'r35-does-not-exist' }, '404', fx, fx.status === 404);
  const fd = await C.call('DELETE', '/api/citizen/favorites', { body: fav });
  const fl2 = await C.call('GET', '/api/citizen/favorites');
  check(J1, 'favorite removed', fav, 'DELETE 200, then not listed', { status: fd.status, json: fl2.json }, fd.status === 200 && fl2.status === 200 && !has(fl2, 'r31-aide-apl'));

  const add = await C.call('POST', '/api/citizen/parcours', { body: { action: 'add', title: 'Étape fictive R35 : rassembler les justificatifs' } });
  const itemId = add.json?.item?.id;
  check(J1, 'Mon Parcours: manual step added', { action: 'add' }, '201 with item.id', add, add.status === 201 && itemId);
  const stp = await C.call('POST', '/api/citizen/parcours', { body: { action: 'status', id: itemId, status: 'IN_PROGRESS' } });
  check(J1, 'Mon Parcours: status updated', { action: 'status', status: 'IN_PROGRESS' }, '200', stp, stp.status === 200);
  const sbad = await C.call('POST', '/api/citizen/parcours', { body: { action: 'status', id: itemId, status: 'NOT_A_STATUS' } });
  check(J1, 'Mon Parcours: unknown status refused', { status: 'NOT_A_STATUS' }, '400 INVALID_STATUS', sbad, sbad.status === 400);
  const pl = await C.call('GET', '/api/citizen/parcours');
  check(J1, 'Mon Parcours: list shows the new status', {}, '200, item IN_PROGRESS', pl, pl.status === 200 && (pl.json?.items || []).some((i) => i.id === itemId && i.status === 'IN_PROGRESS'));
  const ph = await C.call('GET', `/api/citizen/parcours?history=${encodeURIComponent(itemId || '')}`);
  check(J1, 'Mon Parcours: append-only history', { history: 'item' }, '200 with >= 2 events', ph, ph.status === 200 && (ph.json?.events || []).length >= 2);
  const thr = await citizenSession('throwaway');
  const other = thr.ok ? await thr.c.call('POST', '/api/citizen/parcours', { body: { action: 'status', id: itemId, status: 'READY' } }) : null;
  check(J1, 'Mon Parcours: another citizen cannot change the item', { as: 'throwaway citizen' }, '404', other, other?.status === 404);

  const pm = await C.call('PUT', '/api/citizen/preferences', { body: { channel: 'email', category: 'marketing', enabled: true } });
  check(J1, 'preferences: marketing without explicit consent refused', { channel: 'email', category: 'marketing', enabled: true }, '400 CONSENT_REQUIRED', pm, pm.status === 400 && pm.json?.error === 'CONSENT_REQUIRED');
  const pc = await C.call('PUT', '/api/citizen/preferences', { body: { channel: 'email', category: 'marketing', enabled: true, consentGiven: true } });
  check(J1, 'preferences: marketing with consent recorded', { channel: 'email', category: 'marketing', enabled: true, consentGiven: true }, '200, email.marketing true', pc, pc.status === 200 && pc.json?.preferences?.['email.marketing'] === true);
  const pw = await C.call('PUT', '/api/citizen/preferences', { body: { channel: 'email', category: 'marketing', enabled: false } });
  check(J1, 'preferences: consent withdrawn', { channel: 'email', category: 'marketing', enabled: false }, '200, email.marketing false', pw, pw.status === 200 && pw.json?.preferences?.['email.marketing'] === false);

  const ex = await C.call('GET', '/api/auth/export-data');
  check(J1, 'data export of the account', {}, '200 JSON with the account e-mail and preferredLanguage de', ex, ex.status === 200 && has(ex, acc.citizen.email) && has(ex, '"de"'));
  const exa = await anon.call('GET', '/api/auth/export-data');
  check(J1, 'data export refused without a session', {}, '401', exa, exa.status === 401);

  const newEmail = `inscription.r35.${Date.now()}@lab.test`;
  const su = await anon.call('POST', '/api/auth/signup', { body: { email: newEmail, password: `Lab${crypto.randomBytes(9).toString('hex')}!aA1` } });
  check(J1, 'signup of a new throwaway account', { email: newEmail }, '200 (neutral answer, verification e-mail to the test outbox)', su, su.status === 200);
  const sul = await anon.call('POST', '/api/auth/login', { body: { email: newEmail, password: 'not-the-password-R35!' } });
  check(J1, 'no session for an unverified / wrong-password sign-in', { email: newEmail }, '401', sul, sul.status === 401);

  const da = await anon.call('DELETE', '/api/auth/delete-account');
  check(J1, 'account deletion refused without a session', {}, '401', da, da.status === 401);
  const dd = thr.ok ? await thr.c.call('DELETE', '/api/auth/delete-account') : null;
  check(J1, 'account deletion request of the throwaway citizen', { as: 'throwaway citizen' }, '202 with requestId (reviewed before erasure)', dd, dd?.status === 202 && dd?.json?.requestId);
  const dg = thr.ok ? await thr.c.call('GET', '/api/auth/delete-account') : null;
  check(J1, 'deletion request visible to the person', {}, '200 with the request and a due date', dg, dg?.status === 200 && dg?.json?.request?.requestId === dd?.json?.requestId);
  const dagain = thr.ok ? await thr.c.call('DELETE', '/api/auth/delete-account') : null;
  check(J1, 'second deletion request answers the pending one', {}, '202 same requestId', dagain, dagain?.status === 202 && dagain?.json?.requestId === dd?.json?.requestId);
}

// ═════════ 4 Structure (schedule set up first: the booking journey uses it)
const P = await proSession('pro');      // STRUCTURE_ADMIN of org A (r31-s1)
const P2 = await proSession('pro2');    // PRO of org A, not an administrator
const PB = await proSession('other');   // PRO of org B (r31-s2)
const PC = await proSession('third');   // PRO of org C (r35-s3)
check(J4, 'professional sign-ins with the second factor (A admin, A member, B, C)', {}, '4 sessions with MFA', { status: [P, P2, PB, PC].map((x) => x.login.status).join(',') }, [P, P2, PB, PC].every((x) => x.token));
let serviceId = null;
{
  const rs2 = await P2.c.call('PUT', '/api/pro/rdv/settings', { token: P2.token, body: { isPublished: true } });
  check(J4, 'booking settings: non-admin member refused', { isPublished: true, as: 'pro2' }, '403', rs2, rs2.status === 403);
  const rs = await P.c.call('PUT', '/api/pro/rdv/settings', { token: P.token, body: { isPublished: true, bookingMode: 'IN_PERSON' } });
  check(J4, 'booking settings: administrator publishes the booking page', { isPublished: true, bookingMode: 'IN_PERSON' }, '200', rs, rs.status === 200);

  const svc = { name: 'Accueil fictif accès aux droits', durationMinutes: 30, modes: ['IN_PERSON'] };
  const s2 = await P2.c.call('POST', '/api/pro/services', { token: P2.token, body: svc });
  check(J4, 'services: non-admin member cannot create', svc, '403', s2, s2.status === 403);
  const s1 = await P.c.call('POST', '/api/pro/services', { token: P.token, body: svc });
  serviceId = s1.json?.item?.id || null;
  check(J4, 'services: administrator creates a service', svc, '201 with item.id', s1, s1.status === 201 && serviceId);
  const sp = await P.c.call('PATCH', `/api/pro/services?id=${serviceId}`, { token: P.token, body: { bufferAfterMinutes: 0, name: 'Accueil fictif accès aux droits (30 min)' } });
  check(J4, 'services: administrator edits it', { bufferAfterMinutes: 0 }, '200', sp, sp.status === 200 && sp.json?.item?.name?.includes('30 min'));
  const sp2 = await P2.c.call('PATCH', `/api/pro/services?id=${serviceId}`, { token: P2.token, body: { name: 'Renommé par un membre' } });
  check(J4, 'services: non-admin member cannot edit', { name: 'Renommé par un membre' }, '403', sp2, sp2.status === 403);
  const sB = await PB.c.call('PATCH', `/api/pro/services?id=${serviceId}`, { token: PB.token, body: { name: 'Renommé par une autre structure' } });
  check(J4, 'services: another organization cannot edit (even as its own member)', { as: 'org B' }, '403 or 404', sB, [403, 404].includes(sB.status));
  const sl = await P2.c.call('GET', '/api/pro/services', { token: P2.token });
  check(J4, 'services: members can read the list', {}, '200 listing the service', sl, sl.status === 200 && has(sl, serviceId || 'x'));

  const rules = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
  const a2 = await P2.c.call('PUT', '/api/pro/availability', { token: P2.token, body: { rules } });
  check(J4, 'hours: non-admin member refused', { rules: '7 days 09:00-17:00' }, '403 SCHEDULE_MANAGERS_ONLY', a2, a2.status === 403);
  const a1 = await P.c.call('PUT', '/api/pro/availability', { token: P.token, body: { rules } });
  check(J4, 'hours: administrator sets the opening hours', { rules: '7 days 09:00-17:00' }, '200', a1, a1.status === 200);
  const abad = await P.c.call('PUT', '/api/pro/availability', { token: P.token, body: { rules: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '11:00', endTime: '13:00' }] } });
  check(J4, 'hours: overlapping ranges refused', { rules: 'Monday 09-12 and 11-13' }, '400', abad, abad.status === 400);
  const ag = await P.c.call('GET', '/api/pro/availability', { token: P.token });
  check(J4, 'hours: read back', {}, '200 with 7 rules', ag, ag.status === 200 && (ag.json?.rules || []).length === 7);

  const off = { startAt: new Date(Date.now() + 45 * day).toISOString(), endAt: new Date(Date.now() + 45 * day + 3 * 3600000).toISOString(), reason: 'Fermeture fictive R35', scope: 'structure' };
  const t2 = await P2.c.call('POST', '/api/pro/timeoff', { token: P2.token, body: off });
  check(J4, 'time off: non-admin member cannot close the structure', off, '403', t2, t2.status === 403);
  const t1 = await P.c.call('POST', '/api/pro/timeoff', { token: P.token, body: off });
  const offId = t1.json?.item?.id;
  check(J4, 'time off: administrator records a closure', off, '201 with item.id', t1, t1.status === 201 && offId);
  const tl = await P.c.call('GET', '/api/pro/timeoff', { token: P.token });
  check(J4, 'time off: listed', {}, '200 listing it', tl, tl.status === 200 && has(tl, offId || 'x'));
  const td2 = await P2.c.call('DELETE', `/api/pro/timeoff?id=${offId}`, { token: P2.token });
  check(J4, 'time off: non-admin member cannot delete the closure', { id: 'closure' }, '403', td2, td2.status === 403);
  const tdB = await PB.c.call('DELETE', `/api/pro/timeoff?id=${offId}`, { token: PB.token });
  check(J4, 'time off: another organization gets the unknown-id answer', { id: 'closure', as: 'org B' }, '404', tdB, tdB.status === 404);
  const td = await P.c.call('DELETE', `/api/pro/timeoff?id=${offId}`, { token: P.token });
  check(J4, 'time off: administrator deletes it', { id: 'closure' }, '200', td, td.status === 200);
}

// ═════════ 2 Booking
{
  const slug = 'r31-s1';
  const sa = await anon.call('GET', `/api/rdv/structures/${slug}/services`);
  check(J2, 'booking page data refused without a citizen session', { slug }, '401', sa, sa.status === 401);
  const sv = await C.call('GET', `/api/rdv/structures/${slug}/services`);
  check(J2, 'booking page: services of the structure', { slug }, '200 listing the active service (IN_PERSON)', sv, sv.status === 200 && (sv.json?.items || []).some((i) => i.id === serviceId && i.modes?.includes('IN_PERSON')));
  const from = ymd(new Date(Date.now() + day)); const to = ymd(new Date(Date.now() + 7 * day));
  const slotsQ = `/api/rdv/structures/${slug}/slots?serviceId=${serviceId}&from=${from}&to=${to}`;
  const sl = await C.call('GET', slotsQ);
  const slot = (sl.json?.slots || [])[0];
  check(J2, 'booking page: free slots', { from, to }, '200 with at least one slot', sl, sl.status === 200 && slot);
  const key = `r35-${crypto.randomUUID()}`;
  const bk = slot ? await C.call('POST', '/api/rdv/appointments', { body: { structureSlug: slug, serviceId, startAt: slot.startAt, idempotencyKey: key } }) : null;
  const apptId = bk?.json?.id || bk?.json?.appointment?.id;
  const confToken = bk?.json?.confirmation?.token;
  check(J2, 'citizen books the first slot', { structureSlug: slug, startAt: slot?.startAt }, '201 with id and confirmation token', bk, bk?.status === 201 && apptId && confToken);
  const replay = slot ? await C.call('POST', '/api/rdv/appointments', { body: { structureSlug: slug, serviceId, startAt: slot.startAt, idempotencyKey: key } }) : null;
  check(J2, 'same idempotency key replays the booking', { idempotencyKey: 'same' }, '200 same id', replay, replay?.status === 200 && (replay?.json?.id || replay?.json?.appointment?.id) === apptId);
  const dup = slot ? await C.call('POST', '/api/rdv/appointments', { body: { structureSlug: slug, serviceId, startAt: slot.startAt, idempotencyKey: `r35-${crypto.randomUUID()}` } }) : null;
  check(J2, 'the same slot cannot be booked twice', { startAt: slot?.startAt, idempotencyKey: 'new' }, '409', dup, dup?.status === 409);
  const sl2 = await C.call('GET', slotsQ);
  check(J2, 'the booked slot is no longer offered', {}, 'slot absent', { status: sl2.status }, sl2.status === 200 && !(sl2.json?.slots || []).some((s) => s.startAt === slot?.startAt));
  const pa = await P.c.call('GET', `/api/pro/appointments?id=${apptId}`, { token: P.token });
  check(J2, 'the structure sees the appointment', { id: 'appointment', as: 'org A admin' }, '200 with 1 item, active status', pa, pa.status === 200 && (pa.json?.items || []).length === 1 && !/cancel/i.test(pa.json.items[0].status));
  const pb = await PB.c.call('GET', `/api/pro/appointments?id=${apptId}`, { token: PB.token });
  check(J2, 'another organization does not see it', { id: 'appointment', as: 'org B' }, '200 with 0 items (or 403/404)', pb, (pb.status === 200 && (pb.json?.items || []).length === 0) || [403, 404].includes(pb.status));
  const wrong = await anon.call('POST', `/api/rdv/appointments/${apptId}/cancel`, { body: { token: 'r35.wrong.token-0123456789abcdef0123456789abcdef' } });
  check(J2, 'cancel with a wrong confirmation token refused', { token: 'wrong' }, '404', wrong, wrong.status === 404);
  const still = await C.call('GET', `/api/rdv/appointments/${apptId}`);
  check(J2, 'appointment still active after the refused cancel', {}, '200, status not cancelled', still, still.status === 200 && !/cancel/i.test(String(still.json?.status || still.json?.appointment?.status || '')));
  const other = await PB.c.call('POST', `/api/rdv/appointments/${apptId}/cancel`, { token: PB.token, body: {} });
  check(J2, 'a professional token of another organization cannot cancel it through the citizen route', {}, '401 or 404', other, [401, 403, 404].includes(other.status));
  const cx = await anon.call('POST', `/api/rdv/appointments/${apptId}/cancel`, { body: { token: confToken } });
  check(J2, 'cancel from the confirmation link (token only, no session)', { token: 'confirmation' }, '200 status cancelled', cx, cx.status === 200 && /cancel/i.test(String(cx.json?.status || cx.json?.appointment?.status || '')));
  const sl3 = await C.call('GET', slotsQ);
  check(J2, 'the slot is free again', {}, 'slot offered again', { status: sl3.status }, sl3.status === 200 && (sl3.json?.slots || []).some((s) => s.startAt === slot?.startAt));
  const pa2 = await P.c.call('GET', `/api/pro/appointments?id=${apptId}`, { token: P.token });
  check(J2, 'the structure sees the cancellation', {}, 'status cancelled', pa2, pa2.status === 200 && /cancel/i.test(String(pa2.json?.items?.[0]?.status || '')));
}

// ═════════ 3 Pro: case access and referral A -> B (C outside)
{
  const c2 = await P2.c.call('GET', '/api/pro/cases?id=r31-case', { token: P2.token });
  check(J3, 'case assigned to a colleague: a non-admin member of the same organization cannot open it', { id: 'r31-case', as: 'pro2' }, '404', c2, c2.status === 404);
  const c1 = await P.c.call('GET', '/api/pro/cases?id=r31-case', { token: P.token });
  check(J3, 'case opens for its assignee', { id: 'r31-case', as: 'pro' }, '200', c1, c1.status === 200 && c1.json?.case?.id === 'r31-case');
  const cB = await PB.c.call('GET', '/api/pro/cases?id=r31-case', { token: PB.token });
  check(J3, 'another organization cannot open the case', { as: 'org B' }, '404', cB, cB.status === 404);
  const dA = await P.c.call('GET', '/api/pro/dossier?shareId=r31-dossier', { token: P.token });
  check(J3, 'dossier readable by the granted organization', { shareId: 'r31-dossier' }, '200', dA, dA.status === 200);
  const dC0 = await PC.c.call('GET', '/api/pro/dossier?shareId=r31-dossier', { token: PC.token });
  check(J3, 'dossier refused to an organization without a grant', { as: 'org C' }, '404', dC0, dC0.status === 404);

  const rcv = await P.c.call('GET', '/api/pro/referrals?receivers=fictive', { token: P.token });
  check(J3, 'eligible receivers list org B', { receivers: 'fictive' }, '200 including r31-s2', rcv, rcv.status === 200 && has(rcv, 'r31-s2'));
  const badR = await P.c.call('POST', '/api/pro/referrals', { token: P.token, body: { action: 'propose', caseId: 'r31-case', toStructureId: 'r31-s2', reasonCode: 'NOT_A_REASON' } });
  check(J3, 'referral with an unknown reason refused', { reasonCode: 'NOT_A_REASON' }, '400 INVALID_REASON', badR, badR.status === 400);
  const prB = await PB.c.call('POST', '/api/pro/referrals', { token: PB.token, body: { action: 'propose', caseId: 'r31-case', toStructureId: 'r35-s3', reasonCode: 'ACCESS_TO_RIGHTS' } });
  check(J3, 'another organization cannot refer a case it does not hold', { as: 'org B', caseId: 'r31-case' }, '404', prB, prB.status === 404);
  const body = { action: 'propose', caseId: 'r31-case', toStructureId: 'r31-s2', reasonCode: 'ACCESS_TO_RIGHTS', message: 'Orientation fictive R35 pour un accompagnement aux droits.', idempotencyKey: `r35-${crypto.randomUUID()}` };
  const pr = await P.c.call('POST', '/api/pro/referrals', { token: P.token, body });
  const refId = pr.json?.referral?.id;
  check(J3, 'org A proposes a referral to org B', { ...body, idempotencyKey: '…' }, '201 PENDING_CITIZEN', pr, pr.status === 201 && pr.json?.referral?.status === 'PENDING_CITIZEN');
  const bEarly = await PB.c.call('GET', `/api/pro/referrals?id=${refId}`, { token: PB.token });
  check(J3, 'org B does not see it before the citizen agrees', { id: 'referral', as: 'org B' }, '404', bEarly, bEarly.status === 404);
  const cl = await C.call('GET', '/api/citizen/referrals');
  check(J3, 'the citizen sees the proposal', {}, '200 listing it', cl, cl.status === 200 && has(cl, refId || 'x'));
  const thr = await citizenSession('throwaway');
  const tdec = thr.ok ? await thr.c.call('POST', '/api/citizen/referrals', { body: { id: refId, decision: 'accept' } }) : null;
  check(J3, 'another citizen cannot authorize it', { decision: 'accept', as: 'throwaway citizen' }, '404', tdec, tdec?.status === 404);
  const dec = await C.call('POST', '/api/citizen/referrals', { body: { id: refId, decision: 'accept' } });
  check(J3, 'the dossier owner authorizes the referral', { decision: 'accept' }, '200 SENT', dec, dec.status === 200 && dec.json?.referral?.status === 'SENT');
  const inbox = await PB.c.call('GET', '/api/pro/referrals?box=inbox', { token: PB.token });
  check(J3, 'org B inbox lists it', { box: 'inbox' }, '200 including it', inbox, inbox.status === 200 && has(inbox, refId || 'x'));
  const one = await PB.c.call('GET', `/api/pro/referrals?id=${refId}`, { token: PB.token });
  check(J3, 'org B opens it (receiver side, message visible)', { id: 'referral' }, '200 side RECEIVER', one, one.status === 200 && one.json?.side === 'RECEIVER' && has(one, 'Orientation fictive R35'));
  const cInbox = await PC.c.call('GET', '/api/pro/referrals?box=inbox', { token: PC.token });
  check(J3, 'org C inbox does not list it', { box: 'inbox', as: 'org C' }, '200 without it', cInbox, cInbox.status === 200 && !has(cInbox, refId || 'x'));
  const cOne = await PC.c.call('GET', `/api/pro/referrals?id=${refId}`, { token: PC.token });
  check(J3, 'org C cannot open it', { id: 'referral', as: 'org C' }, '404', cOne, cOne.status === 404);
  const cAct = await PC.c.call('POST', '/api/pro/referrals', { token: PC.token, body: { action: 'accept', id: refId } });
  check(J3, 'org C cannot accept it', { action: 'accept', as: 'org C' }, '404', cAct, cAct.status === 404);
  const ack = await PB.c.call('POST', '/api/pro/referrals', { token: PB.token, body: { action: 'acknowledge', id: refId } });
  check(J3, 'org B acknowledges', { action: 'acknowledge' }, '200 ACKNOWLEDGED', ack, ack.status === 200 && ack.json?.referral?.status === 'ACKNOWLEDGED');
  const accR = await PB.c.call('POST', '/api/pro/referrals', { token: PB.token, body: { action: 'accept', id: refId } });
  check(J3, 'org B accepts (its own case is opened)', { action: 'accept' }, '200 ACCEPTED with caseId', accR, accR.status === 200 && accR.json?.referral?.status === 'ACCEPTED' && accR.json?.caseId);
  const dB = await PB.c.call('GET', '/api/pro/dossier?shareId=r31-dossier', { token: PB.token });
  check(J3, 'org B now reads the dossier (grant created by the citizen’s authorization)', { shareId: 'r31-dossier', as: 'org B' }, '200', dB, dB.status === 200);
  const dC = await PC.c.call('GET', '/api/pro/dossier?shareId=r31-dossier', { token: PC.token });
  check(J3, 'org C still cannot read the dossier', { as: 'org C' }, '404', dC, dC.status === 404);
  const out = await P.c.call('GET', '/api/pro/referrals?box=outbox', { token: P.token });
  check(J3, 'org A outbox shows the accepted referral', { box: 'outbox' }, '200 including it as ACCEPTED', out, out.status === 200 && has(out, refId || 'x') && has(out, 'ACCEPTED'));
  const cr = await C.call('GET', '/api/citizen/referrals');
  check(J3, 'the citizen follows the status', {}, '200, status ACCEPTED', cr, cr.status === 200 && (cr.json?.referrals || []).some((r) => r.id === refId && r.status === 'ACCEPTED'));
}

// ═════════ 5 Documents
{
  // a 1x1 PNG (synthetic)
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const doc = { category: 'autre', originalName: 'justificatif-fictif-r35.png', mimeType: 'image/png', fileBase64: png.toString('base64') };
  const ua = await anon.call('POST', '/api/citizen/coffre', { body: doc });
  check(J5, 'Coffre upload refused without a session', { category: 'autre' }, '401', ua, ua.status === 401);
  const uh = await C.call('POST', '/api/citizen/coffre', { body: { ...doc, category: 'sante' } });
  check(J5, 'health documents refused (no HDS hosting)', { category: 'sante' }, '422 HEALTH_DOCUMENTS_NOT_ACCEPTED', uh, uh.status === 422);
  const ut = await C.call('POST', '/api/citizen/coffre', { body: { ...doc, originalName: 'note.txt', mimeType: 'text/plain', fileBase64: Buffer.from('texte fictif').toString('base64') } });
  check(J5, 'a non PDF/PNG/JPEG content refused', { mimeType: 'text/plain' }, '415 UNSUPPORTED_TYPE', ut, ut.status === 415);
  const up = await C.call('POST', '/api/citizen/coffre', { body: doc });
  const docId = up.json?.document?.id;
  check(J5, 'Coffre upload of a small synthetic PNG', { category: 'autre', originalName: doc.originalName }, '201 with document.id', up, up.status === 201 && docId);
  const ls = await C.call('GET', '/api/citizen/coffre');
  check(J5, 'Coffre list', {}, '200 listing the document with its name', ls, ls.status === 200 && (ls.json?.documents || []).some((d) => d.id === docId && d.name === doc.originalName));
  const dl = await C.call('GET', `/api/citizen/coffre?download=${docId}`, { raw: true });
  check(J5, 'the owner downloads it (same bytes)', {}, '200 image/png identical bytes', { status: dl.status, type: dl.type, buf: dl.buf }, dl.status === 200 && dl.buf.equals(png));
  const thr = await citizenSession('throwaway');
  const tdl = thr.ok ? await thr.c.call('GET', `/api/citizen/coffre?download=${docId}`, { raw: true }) : null;
  check(J5, 'another citizen cannot download it', { as: 'throwaway citizen' }, '404', tdl ? { status: tdl.status } : null, tdl?.status === 404);
  const shC = await C.call('POST', '/api/citizen/coffre', { body: { action: 'share', documentId: docId, shareId: 'r35-docs', structureId: 'r35-s3' } });
  check(J5, 'share to an organization without access refused', { shareId: 'r35-docs', structureId: 'r35-s3' }, '404 NO_ACTIVE_GRANT', shC, shC.status === 404);
  const sh = await C.call('POST', '/api/citizen/coffre', { body: { action: 'share', documentId: docId, shareId: 'r35-docs', structureId: 'r31-s1' } });
  const fileId = sh.json?.fileId;
  check(J5, 'share to the granted organization (consented dossier)', { shareId: 'r35-docs', structureId: 'r31-s1' }, '201 with fileId', sh, sh.status === 201 && fileId);
  const pd = await P.c.call('GET', '/api/pro/dossier?shareId=r35-docs', { token: P.token });
  const entry = (pd.json?.documents || []).find((d) => d.id === fileId);
  check(J5, 'the professional sees the shared document', { shareId: 'r35-docs' }, '200 listing it with a download capability', pd, pd.status === 200 && entry?.downloadToken);
  const pdl = entry ? await P.c.call('POST', '/api/download', { token: P.token, body: { token: entry.downloadToken }, raw: true }) : null;
  check(J5, 'the professional downloads it (same bytes)', {}, '200 identical bytes', pdl ? { status: pdl.status, type: pdl.type, buf: pdl.buf } : null, pdl?.status === 200 && pdl.buf.equals(png));
  const pC = await PC.c.call('GET', '/api/pro/dossier?shareId=r35-docs', { token: PC.token });
  check(J5, 'another organization cannot read the dossier', { as: 'org C' }, '404', pC, pC.status === 404);
  const rvA = await anon.call('POST', '/api/public/dossier-grants', { body: { shareId: 'r35-docs', action: 'revoke', structureId: 'r31-s1' } });
  check(J5, 'revoke refused to a caller who is not the owner', { action: 'revoke', as: 'anonymous' }, '404', rvA, rvA.status === 404);
  const rvT = thr.ok ? await thr.c.call('POST', '/api/public/dossier-grants', { body: { shareId: 'r35-docs', action: 'revoke', structureId: 'r31-s1' } }) : null;
  check(J5, 'revoke refused to another citizen', { action: 'revoke', as: 'throwaway citizen' }, '404', rvT, rvT?.status === 404);
  const rv = await C.call('POST', '/api/public/dossier-grants', { body: { shareId: 'r35-docs', action: 'revoke', structureId: 'r31-s1' } });
  check(J5, 'the owner revokes the organization’s access', { shareId: 'r35-docs', action: 'revoke', structureId: 'r31-s1' }, '200', rv, rv.status === 200);
  const pd2 = await P.c.call('GET', '/api/pro/dossier?shareId=r35-docs', { token: P.token });
  check(J5, 'after the revocation the dossier is refused', {}, '404', pd2, pd2.status === 404);
  const pdl2 = entry ? await P.c.call('POST', '/api/download', { token: P.token, body: { token: entry.downloadToken }, raw: true }) : null;
  check(J5, 'after the revocation the already issued download capability is refused', {}, '404', pdl2 ? { status: pdl2.status } : null, pdl2?.status === 404);
  const del = await C.call('DELETE', '/api/citizen/coffre', { body: { id: docId } });
  const ls2 = await C.call('GET', '/api/citizen/coffre');
  check(J5, 'the owner deletes the Coffre copy', { id: 'document' }, '200, no longer listed', { status: del.status, json: del.json }, del.status === 200 && !has(ls2, docId || 'x'));
}

// ═════════ 6 Institution
{
  const a = await anon.call('GET', '/api/institution/me');
  check(J6, 'anonymous caller refused', {}, '401', a, a.status === 401);
  const p = await P.c.call('GET', '/api/institution/observatoire', { token: P.token });
  check(J6, 'a professional token is not an institution session', { as: 'org A admin' }, '401', p, p.status === 401);
  const ic = await client();
  const bad = await ic.call('POST', '/api/institution/login', { body: { email: acc.institution.email, password: 'wrong-password-R35!' } });
  check(J6, 'login with a wrong password refused', { email: acc.institution.email }, '401', bad, bad.status === 401);
  const lo = await ic.call('POST', '/api/institution/login', { body: { email: acc.institution.email, password: acc.institution.password } });
  const it = lo.json?.token;
  check(J6, 'institution login (signed agreement, active account)', { email: acc.institution.email }, '200 with token', lo, lo.status === 200 && it);
  const me = await ic.call('GET', '/api/institution/me', { token: it });
  check(J6, 'institution/me', {}, '200 organisation + territory', me, me.status === 200 && me.json?.territory === '67');
  const ob = await ic.call('GET', '/api/institution/observatoire', { token: it });
  const text = JSON.stringify(ob.json || {});
  const leaks = [acc.citizen.email, acc.throwaway.email, acc.pro.email, acc.other.email, 'r35-citizen', 'r31-dossier', 'Citoyen fictif R35', 'Orientation fictive R35'].filter((x) => text.includes(x));
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  check(J6, 'aggregates readable', {}, '200 JSON', ob, ob.status === 200 && ob.json && typeof ob.json === 'object');
  check(J6, 'no personal data in the aggregates', {}, 'no e-mail address, account id, dossier id or free text of the journeys', `${leaks.length} seeded values, ${emails.length} e-mail-like strings${emails.length ? ` (${emails.slice(0, 3).join(', ')})` : ''}`, ob.status === 200 && !leaks.length && !emails.length);
  const ex = await ic.call('GET', '/api/institution/export?period=quarter', { token: it, raw: true });
  const csv = ex.buf.toString('utf8');
  check(J6, 'export: closed while the OPEN_DATA_EXPORT flag is off, or a CSV without personal data', { period: 'quarter' }, '503 EXPORT_NOT_OPEN or 200 CSV', { status: ex.status, type: ex.type, buf: ex.buf },
    ex.status === 503 || (ex.status === 200 && !/@/.test(csv)));
}

// ═════════ 8 Operations (before 7: the scan feeds the review queue)
{
  const n = await anon.call('GET', '/api/cron/review-queue/scan');
  check(J8, 'cron route without CRON_SECRET', {}, '401', n, n.status === 401);
  const w = await anon.call('GET', '/api/cron/review-queue/scan', { headers: { 'x-cron-secret': 'r35-wrong-secret' } });
  check(J8, 'cron route with a wrong secret', { 'x-cron-secret': 'wrong' }, '401', w, w.status === 401);
  const ok = CRON_SECRET ? await anon.call('GET', '/api/cron/review-queue/scan?limitPerType=20', { headers: { 'x-cron-secret': CRON_SECRET } }) : null;
  check(J8, 'review-queue scan runs with the LAB secret', { 'x-cron-secret': 'LAB', limitPerType: 20 }, '200 ok with a summary (not skipped)', ok || 'CRON_SECRET not given to the script', ok?.status === 200 && ok.json?.ok === true && ok.json?.summary && !ok.json?.skipped);
  const p = await anon.call('GET', '/api/cron/review-queue/scan', { token: P.token });
  check(J8, 'a professional token is not the cron secret', { as: 'org A admin' }, '401', p, p.status === 401);
}

// ═════════ 7 Admin
{
  const ac = await client();
  const al = await ac.call('POST', '/api/admin/login', { body: { email: acc.admin.email, password: acc.admin.password } });
  const mv = al.json?.token ? await ac.call('POST', '/api/admin/mfa-verify', { token: al.json.token, body: { code: totp(acc.admin.totp) } }) : null;
  const at = mv?.json?.token || null;
  check(J7, 'administrator sign-in with password + TOTP', { email: acc.admin.email }, '200 then MFA session', mv || al, al.status === 200 && at);
  const pre = al.json?.token ? await ac.call('GET', '/api/admin/audit-log', { token: al.json.token }) : null;
  check(J7, 'a pre-MFA token cannot read the audit log', {}, '401 or 403', pre, [401, 403].includes(pre?.status));
  const rqA = await anon.call('GET', '/api/admin/review-queue');
  check(J7, 'review queue refused to an anonymous caller', {}, '401', rqA, rqA.status === 401);
  const rqP = await P.c.call('GET', '/api/admin/review-queue', { token: P.token });
  check(J7, 'review queue refused to a professional', { as: 'org A admin' }, '401 or 403', rqP, [401, 403].includes(rqP.status));
  const rq = await ac.call('GET', '/api/admin/review-queue?status=open&limit=100', { token: at });
  check(J7, 'review queue list', { status: 'open' }, '200 listing the synthetic item r35-rq-1', rq, rq.status === 200 && has(rq, 'r35-rq-1'));
  const cv = await ac.call('GET', '/api/admin/content-verification?entityType=aide&entityId=r31-aide-apl', { token: at });
  check(J7, 'content-verification view of a record', { entityType: 'aide', entityId: 'r31-aide-apl' }, '200 with decision + version + history', cv, cv.status === 200 && cv.json?.decision && cv.json?.version && Array.isArray(cv.json?.history));
  const cvP = await P.c.call('GET', '/api/admin/content-verification?entityType=aide&entityId=r31-aide-apl', { token: P.token });
  check(J7, 'content-verification refused to a professional', { as: 'org A admin' }, '401', cvP, cvP.status === 401);
  const cvW = await ac.call('POST', '/api/admin/content-verification', { token: at, body: { entityType: 'aide', entityId: 'r31-aide-apl', action: 'VERIFY', sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', evidenceNote: 'Relecture fictive R35' } });
  check(J7, 'a VERIFY without the read version is refused', { action: 'VERIFY', expectedVersion: 'missing' }, '400 VERSION_REQUIRED', cvW, cvW.status === 400 && cvW.json?.error === 'VERSION_REQUIRED');
  const reason = 'Élément fictif R35 écarté après contrôle';
  const pP = await P.c.call('PATCH', '/api/admin/review-queue/r35-rq-1', { token: P.token, body: { status: 'dismissed', reason } });
  check(J7, 'a professional cannot decide on the queue', { status: 'dismissed', as: 'org A admin' }, '401 or 403', pP, [401, 403].includes(pP.status));
  const pa = await ac.call('PATCH', '/api/admin/review-queue/r35-rq-1', { token: at, body: { status: 'dismissed', reason } });
  check(J7, 'moderation decision on the queue item', { id: 'r35-rq-1', status: 'dismissed' }, '200 item dismissed', pa, pa.status === 200 && pa.json?.item?.status === 'dismissed');
  const au = await ac.call('GET', '/api/admin/audit-log?action=REVIEW_QUEUE_DECISION', { token: at });
  check(J7, 'audit log entry created by the decision', { action: 'REVIEW_QUEUE_DECISION' }, '200 with an entry for r35-rq-1 by the named administrator', au, au.status === 200 && has(au, 'r35-rq-1') && has(au, acc.admin.email));
  const auA = await anon.call('GET', '/api/admin/audit-log');
  check(J7, 'audit log refused to an anonymous caller', {}, '401', auA, auA.status === 401);
}

// ═════════ 9 R35 per-surface beta switch (second server: ADA_PUBLIC_BETA_RESTRICTED=1, ADA_BETA_OPEN_SURFACES=appointments)
if (betaBase) {
  const bc = await client(betaBase);
  const pub = await bc.call('GET', '/api/guides');
  check(J9, 'public information stays open', { path: '/api/guides' }, '200', pub, pub.status === 200);
  const rdv = await bc.call('GET', '/api/rdv/structures/r31-s1/services');
  check(J9, '/api/rdv reachable (appointments surface opened)', { path: '/api/rdv/structures/r31-s1/services' }, 'not 503 (401 without a session)', rdv, rdv.status !== 503 && rdv.status === 401);
  const pa = await bc.call('GET', '/api/pro/appointments');
  check(J9, '/api/pro/appointments reachable (appointments surface)', { path: '/api/pro/appointments' }, 'not 503 (401 without a session)', pa, pa.status !== 503);
  const su = await bc.call('POST', '/api/auth/signup', { body: { email: `beta.r35.${Date.now()}@lab.test`, password: `Lab${crypto.randomBytes(9).toString('hex')}!aA1` } });
  check(J9, '/api/auth/signup closed (accounts surface not opened)', { path: '/api/auth/signup' }, '503 PUBLIC_BETA_RESTRICTED', su, su.status === 503 && su.json?.error === 'PUBLIC_BETA_RESTRICTED');
  const cf = await bc.call('GET', '/api/citizen/coffre');
  check(J9, '/api/citizen/coffre closed (documents surface not opened)', { path: '/api/citizen/coffre' }, '503 PUBLIC_BETA_RESTRICTED', cf, cf.status === 503 && cf.json?.error === 'PUBLIC_BETA_RESTRICTED');
  const vi = await bc.call('GET', '/api/pro/appointments/visio');
  check(J9, '/api/pro/appointments/visio closed (video is its own surface)', { path: '/api/pro/appointments/visio' }, '503 PUBLIC_BETA_RESTRICTED', vi, vi.status === 503 && vi.json?.error === 'PUBLIC_BETA_RESTRICTED');
  const vp = await bc.call('POST', '/api/pro/appointments/visio', { body: {} });
  check(J9, 'POST /api/pro/appointments/visio closed too', { path: '/api/pro/appointments/visio', method: 'POST' }, '503', vp, vp.status === 503);
  const cr = await bc.call('GET', '/api/cron/review-queue/scan');
  check(J9, 'cron closed (jobs surface not opened)', { path: '/api/cron/review-queue/scan' }, '503', cr, cr.status === 503);
}

const journeys = [...new Set(rows.map((r) => r.journey))].map((j) => ({ journey: j, pass: rows.filter((r) => r.journey === j && r.ok).length, fail: rows.filter((r) => r.journey === j && !r.ok).length }));
const summary = { base, origin, betaBase, at: new Date().toISOString(), pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length, journeys };
console.log(`JOURNEYS ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
