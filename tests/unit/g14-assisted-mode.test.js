/**
 * G14-AID — « mode accompagnant »: the route policy of an assisted session (allow-list, forbidden security routes, areas, professional helper), the session
 * claim (signed, well-formed or no session), the ADA Pro helper code, the router gate (ended → 401 + cookie cleared, refused → 403 logged, reads and writes
 * logged BEFORE the handler, no unlogged access), and the capability (closed by default, opened only by name). Pure / mocked: the database proofs are in
 * tests/integration/g14-assisted-mode-db.test.js.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'g14-aid-unit-secret-0123456789abcdef';

const svc = vi.hoisted(() => ({ live: true, recordFails: false, events: [], outcomes: [] }));
vi.mock('../../api/_services/assisted-mode.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    assistSessionLive: vi.fn(async () => svc.live),
    recordAssistEvent: vi.fn(async (userId, assist, kind, what) => { if (svc.recordFails) throw new Error('db down'); svc.events.push({ kind, ...what }); return `id-${svc.events.length}`; }),
    recordAssistOutcome: vi.fn(async (id, status) => { svc.outcomes.push({ id, status }); }),
  };
});

const { assistDecision, assistActionLabel, proHelperCode, proHelperCodeValid, ACCOUNT_FAMILIES, ASSIST_AREAS, ASSIST_MINUTES, PRO_FORBIDDEN_AREAS } = await import('../../api/_services/assisted-mode.js');
const userAuth = await import('../../api/_utils/user-auth.js');
const { handleAssisted } = await import('../../api/_utils/assist-gate.js');
const { CAPABILITIES, capabilityState, capabilitiesOfRoute } = await import('../../api/_utils/capabilities.js');

const ALL = { areas: [...ASSIST_AREAS], pro: false };
const PRO = { areas: [...ASSIST_AREAS], pro: true };
const SID = '0b0e2d6e-7a51-4a43-9a43-1f1c2b3d4e5f';

describe('G14-AID route policy of an assisted session', () => {
  it('the account\'s security is NEVER reachable, whatever the areas opened', () => {
    const forbidden = [['DELETE', 'auth/delete-account'], ['GET', 'auth/delete-account'], ['GET', 'auth/export-data'], ['POST', 'auth/login'], ['POST', 'auth/signup'],
      ['POST', 'auth/reset-password'], ['POST', 'auth/forgot-password'], ['GET', 'auth/franceconnect/start'], ['POST', 'citizen/email-change'], ['GET', 'citizen/email-change-confirm'],
      ['PUT', 'citizen/phone'], ['PUT', 'citizen/preferences'], ['POST', 'citizen/restriction'], ['POST', 'citizen/delegations'], ['GET', 'citizen/delegations'],
      ['POST', 'citizen/household'], ['POST', 'citizen/guardians'], ['POST', 'citizen/shares'], ['GET', 'citizen/dossier'], ['GET', 'citizen/referrals'], ['POST', 'citizen/push'],
      ['GET', 'citizen/history'], ['POST', 'citizen/favorites'], ['POST', 'citizen/age-declaration'], ['GET', 'share/abc'], ['GET', 'download'], ['POST', 'public/dossier-revoke'],
      ['GET', 'pro/me'], ['GET', 'pro/assist-code'], ['GET', 'admin/audit-log'], ['GET', 'institution/me'], ['POST', 'citizen/coffre'], ['DELETE', 'citizen/coffre']];
    for (const [m, p] of forbidden) {
      expect(assistDecision(p, m, ALL).allow, `${m} ${p}`).toBe(false);
      expect(assistDecision(`/api/${p}`, m, PRO).allow, `${m} /api/${p} (pro)`).toBe(false);
    }
  });

  it('every account route of the router is refused unless it is in the explicit allow-list (a new route is closed to helpers by default)', () => {
    const routes = [...readFileSync(resolve('api/routes.js'), 'utf8').matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1]);
    const inFamily = routes.filter((r) => ACCOUNT_FAMILIES.some((f) => r === f || r.startsWith(`${f}/`)));
    expect(inFamily.length).toBeGreaterThan(100);
    const allowed = new Set();
    for (const r of inFamily) for (const m of ['GET', 'POST', 'PUT', 'DELETE']) if (assistDecision(r, m, ALL).allow) allowed.add(`${m} ${r}`);
    expect([...allowed].sort()).toEqual(['DELETE citizen/parcours', 'DELETE messages', 'DELETE rdv', 'GET auth/me', 'GET citizen/age-declaration', 'GET citizen/assist', 'GET citizen/coffre',
      'GET citizen/espace', 'GET citizen/notifications', 'GET citizen/parcours', 'GET citizen/profile', 'GET messages', 'GET rdv', 'POST auth/logout', 'POST citizen/assist',
      'POST citizen/parcours', 'POST messages', 'POST rdv', 'PUT citizen/profile', 'PUT messages', 'PUT rdv'].sort());
  });

  it('only the areas the person opened; Mon Coffre only when opened, read-only, never for a professional', () => {
    expect(assistDecision('rdv/appointments', 'POST', { areas: ['PARCOURS'], pro: false })).toMatchObject({ allow: false, area: 'RDV' });
    expect(assistDecision('rdv/appointments', 'POST', { areas: ['RDV'], pro: false })).toMatchObject({ allow: true, kind: 'AREA', area: 'RDV' });
    expect(assistDecision('rdv/appointments/x/cancel', 'POST', { areas: ['RDV'], pro: true }).allow).toBe(true);
    expect(assistDecision('citizen/parcours', 'POST', { areas: ['RDV'], pro: false }).allow).toBe(false);
    expect(assistDecision('citizen/profile', 'PUT', { areas: ['PROFIL'], pro: false }).allow).toBe(true);
    expect(assistDecision('citizen/coffre', 'GET', { areas: ['RDV'], pro: false }).allow).toBe(false);
    expect(assistDecision('citizen/coffre', 'GET', { areas: ['COFFRE'], pro: false }).allow).toBe(true);
    expect(assistDecision('citizen/coffre', 'GET', { areas: ['COFFRE'], pro: true }).allow).toBe(false);
    expect(PRO_FORBIDDEN_AREAS).toEqual(['COFFRE']);
    expect(assistDecision('citizen/parcours', 'GET', { areas: ['BOGUS'], pro: false }).allow).toBe(false);
  });

  it('public information is served as usual; the session, the summary and the notices always', () => {
    for (const p of ['aides', 'structures/search', 'demarches/x', 'public/page', 'guides', 'notices']) expect(assistDecision(p, 'GET', { areas: [], pro: false }).kind, p).toBe('PUBLIC');
    for (const [m, p] of [['GET', 'auth/me'], ['POST', 'auth/logout'], ['GET', 'citizen/espace'], ['GET', 'citizen/assist'], ['POST', 'citizen/assist']]) {
      expect(assistDecision(p, m, { areas: [], pro: true }).kind, p).toBe('ALWAYS');
    }
  });

  it('labels the writes for the person (« fait avec l\'aide de … »)', () => {
    expect(assistActionLabel('rdv/appointments', 'POST')).toBe('RDV_BOOKED');
    expect(assistActionLabel('/api/rdv/appointments/a1/cancel', 'POST')).toBe('RDV_CANCELLED');
    expect(assistActionLabel('rdv/appointments/a1/reschedule', 'POST')).toBe('RDV_MOVED');
    expect(assistActionLabel('messages/c1', 'POST')).toBe('MESSAGE_SENT');
    expect(assistActionLabel('citizen/parcours', 'POST')).toBe('PARCOURS_CHANGED');
    expect(assistActionLabel('citizen/profile', 'PUT')).toBe('PROFILE_CHANGED');
    expect(ASSIST_MINUTES).toEqual([30, 60, 120]);
  });
});

describe('G14-AID session claim', () => {
  const user = { userId: 'u-1', email: 'Person@Example.test' };
  it('an assisted token carries its claim and lives at most until its end; a normal token has none', () => {
    const until = Date.now() + 30 * 60000;
    const tok = userAuth.signUserSessionToken(user, { assist: { sid: SID, areas: ['RDV'], pro: false, name: 'Marie', role: 'PROCHE', until }, maxAgeSeconds: 1800 });
    const c = userAuth.verifyUserSessionToken(tok);
    expect(c.assist).toEqual({ sid: SID, areas: ['RDV'], pro: false, name: 'Marie', role: 'PROCHE', until });
    const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(1800);
    expect(userAuth.verifyUserSessionToken(userAuth.signUserSessionToken(user)).assist).toBeNull();
  });
  it('a malformed claim is refused at signing and is NO session at verification (never a full session)', async () => {
    expect(() => userAuth.signUserSessionToken(user, { assist: { sid: 'not-a-uuid', areas: [], until: 1 } })).toThrow();
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ scope: 'user', role: 'user', userId: 'u-1', email: 'person@example.test', assist: { sid: 'x' } }, process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h', issuer: 'accesdirectaide', audience: 'accesdirectaide-user' });
    expect(userAuth.verifyUserSessionToken(forged)).toBeNull();
    expect(userAuth.parseAssistClaim({ sid: SID, areas: 'RDV', until: 1 })).toBeNull();
  });
});

describe('G14-AID ADA Pro helper code', () => {
  const secret = 'unit-secret';
  it('8 digits, bound to the member and to a 10-minute window; accepted for the current and the previous window only', () => {
    const t0 = Date.UTC(2026, 10, 23, 10, 0, 0);
    const c = proHelperCode('pro-1', t0, secret);
    expect(c).toMatch(/^\d{8}$/);
    expect(proHelperCode('pro-1', t0 + 60000, secret)).toBe(c);
    expect(proHelperCodeValid('pro-1', `${c.slice(0, 4)} ${c.slice(4)}`, t0 + 5 * 60000, secret)).toBe(true);
    expect(proHelperCodeValid('pro-1', c, t0 + 15 * 60000, secret)).toBe(true);
    expect(proHelperCodeValid('pro-1', c, t0 + 25 * 60000, secret)).toBe(false);
    expect(proHelperCodeValid('pro-2', c, t0, secret)).toBe(false);
    expect(proHelperCodeValid('pro-1', '1234', t0, secret)).toBe(false);
    expect(proHelperCodeValid('pro-1', c, t0, '')).toBe(false);
  });
});

describe('G14-AID router gate (api/_utils/assist-gate.js)', () => {
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
  const cookieFor = (assist) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: 'u-1', email: 'p@example.test' }, assist ? { assist, maxAgeSeconds: 3600 } : {})).split(';')[0];
  const A = { sid: SID, areas: ['RDV'], pro: false, name: 'Marie', role: 'PROCHE', until: Date.now() + 3600000 };
  const call = async (method, url, cookie) => { const res = mk(); const inner = vi.fn(async (_q, r) => r.status(201).json({ ok: true })); await handleAssisted({ method, url, headers: { host: 'x', ...(cookie ? { cookie } : {}) } }, res, inner); return { res, inner }; };
  beforeEach(() => { svc.live = true; svc.recordFails = false; svc.events = []; svc.outcomes = []; });

  it('a request without an assisted session passes untouched (no lookup, no log)', async () => {
    for (const c of [null, cookieFor(null)]) {
      const { inner } = await call('POST', '/api/citizen/email-change', c);
      expect(inner).toHaveBeenCalledTimes(1);
    }
    expect(svc.events).toEqual([]);
  });
  it('an ended or expired assisted session is no session: 401 ASSIST_ENDED, cookie cleared, handler not run', async () => {
    svc.live = false;
    const { res, inner } = await call('GET', '/api/auth/me', cookieFor(A));
    expect(res.statusCode).toBe(401); expect(res.body.error).toBe('ASSIST_ENDED');
    expect(String(res.headers['Set-Cookie'])).toMatch(/ada_user_session=;.*Max-Age=0/);
    expect(inner).not.toHaveBeenCalled();
  });
  it('a refused route answers 403 and the attempt is logged for the person; the handler never runs', async () => {
    const { res, inner } = await call('POST', '/api/citizen/email-change', cookieFor(A));
    expect(res.statusCode).toBe(403); expect(res.body.error).toBe('ASSIST_NOT_ALLOWED');
    expect(inner).not.toHaveBeenCalled();
    expect(svc.events).toEqual([expect.objectContaining({ kind: 'REFUSED', route: 'citizen/email-change' })]);
  });
  it('a read of an opened area is logged, then served; a write is logged BEFORE it runs and its outcome after', async () => {
    let r = await call('GET', '/api/rdv/appointments', cookieFor(A));
    expect(r.inner).toHaveBeenCalledTimes(1); expect(svc.events[0]).toMatchObject({ kind: 'VIEW', area: 'RDV' });
    r = await call('POST', '/api/rdv/appointments/a1/cancel', cookieFor(A));
    expect(r.inner).toHaveBeenCalledTimes(1);
    expect(svc.events[1]).toMatchObject({ kind: 'ACTION', area: 'RDV', label: 'RDV_CANCELLED', method: 'POST' });
    expect(svc.outcomes).toEqual([{ id: 'id-2', status: 201 }]);
  });
  it('no unlogged helper access: when the log cannot be written the request is refused (503) and not run', async () => {
    svc.recordFails = true;
    const { res, inner } = await call('POST', '/api/rdv/appointments', cookieFor(A));
    expect(res.statusCode).toBe(503); expect(inner).not.toHaveBeenCalled();
  });
  it('public information is served without any log; the session routes without an area log', async () => {
    for (const u of ['/api/aides?q=x', '/api/auth/me', '/api/citizen/espace']) {
      const { inner } = await call('GET', u, cookieFor(A));
      expect(inner, u).toHaveBeenCalledTimes(1);
    }
    expect(svc.events).toEqual([]);
  });
});

describe('G14-AID capability (closed by default, opened by name only)', () => {
  const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts', VERCEL_ENV: 'production' };
  it('is outside the AIPD, not HDS, on the accounts surface (full scope or the « assist » addition)', () => {
    expect(CAPABILITIES['citizen.assisted_mode']).toMatchObject({ aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true });
    expect(capabilitiesOfRoute('citizen/assist')).toEqual(['citizen.assisted_mode']);
    expect(capabilitiesOfRoute('pro/assist-code')).toEqual(['pro.account', 'citizen.assisted_mode']);
  });
  it('production: closed unless ADA_CAPABILITIES_OPEN names it AND the accounts scope serves it', () => {
    expect(capabilityState('citizen.assisted_mode', beta)).toMatchObject({ open: false });
    expect(capabilityState('citizen.assisted_mode', { ...beta, ADA_CAPABILITIES_OPEN: 'citizen.assisted_mode' })).toMatchObject({ open: false, reason: 'SURFACE_CLOSED' });
    expect(capabilityState('citizen.assisted_mode', { ...beta, ADA_CAPABILITIES_OPEN: 'citizen.assisted_mode', ADA_BETA_ACCOUNTS_EXTRA: 'assist' }).open).toBe(true);
    expect(capabilityState('citizen.assisted_mode', { ...beta, ADA_CAPABILITIES_OPEN: 'citizen.assisted_mode', ADA_BETA_ACCOUNTS_SCOPE: 'full' }).open).toBe(true);
    expect(capabilityState('citizen.assisted_mode', { ...beta, ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_CAPABILITIES_OPEN: 'citizen.delegations' }).open).toBe(false);
    expect(capabilityState('citizen.assisted_mode', { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'citizen.*' }).open).toBe(false);
  });
});
