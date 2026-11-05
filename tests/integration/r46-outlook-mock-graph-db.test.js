/**
 * R46 (B02 / B10) — the Outlook free/busy integration end to end against a LOCAL MOCK of Microsoft identity + Graph (a real HTTP server on 127.0.0.1,
 * reached through the real fetch: no injected fetch, no Microsoft endpoint, no real tenant), on a REAL PostgreSQL, through the real handlers:
 *   connect (signed state bound to the browser) → callback (code exchange, encrypted storage, eligibility) → status → public slots minus Outlook busy →
 *   access-token renewal (rotation persisted encrypted) → runtime 401 = one refresh + one retry → Graph outage = none of that professional's slots, booking
 *   refused (fail safe), other professionals still offered → recovery without any manual step → refused renewal = reconnect required, honest status →
 *   reconnect → the professional's own availability route on the same mock → disconnect = internal engine only.
 * Also: a state for another browser, a forged / foreign-structure state, a moved account and a refused code never store a token; the scope is
 * Calendars.ReadBasic only; getSchedule asks only free/busy in UTC; no token appears in the database in clear, in AuditLog or in any response.
 * Synthetic structure, professionals and citizens only.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { declareAdult } from './helpers/adult-age.mjs';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const T = { id: `r46o-t-${TS}`, slug: `r46o-t-slug-${TS}`, svc: `r46o-t-svc-${TS}`, name: 'Structure fictive R46 Outlook' };
const OTHER = { id: `r46o-x-${TS}`, slug: `r46o-x-slug-${TS}`, name: 'Autre structure fictive R46' };
const pro = (k, sid, role, name) => ({ id: `r46o-p${k}-${TS}`, email: `r46o-p${k}-${TS}@example.test`, sid, role, name });
const ADMIN = pro('a', T.id, 'STRUCTURE_ADMIN', null);
const P1 = pro('1', T.id, 'PRO', 'Camille Fictive');
const P2 = pro('2', T.id, 'PRO', 'Dominique Fictif');
const PROS = [ADMIN, P1, P2];
const cit = (k) => ({ id: `r46o-c${k}-${TS}`, email: `test.citizen+r46o${k}-${TS}@example.test` });
const C = [cit('0'), cit('1')];

/** the mock identity platform + Graph: every behaviour is switchable; every call is recorded (no secret is printed) */
const mock = { port: 0, calls: [], tokenSeq: 0, refresh: 'ok', graph: 'ok', validAccess: new Set(), busy: null, server: null };
function startMock() {
  return new Promise((resolve) => {
    mock.server = http.createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'POST' && url.pathname === '/tenant/oauth2/v2.0/token') {
          const form = new URLSearchParams(raw);
          mock.calls.push({ kind: `token:${form.get('grant_type')}`, clientId: form.get('client_id') });
          const issue = () => { mock.tokenSeq += 1; const at = `AT-${mock.tokenSeq}-${TS}`; mock.validAccess = new Set([at]); return { token_type: 'Bearer', access_token: at, refresh_token: `RT-${mock.tokenSeq}-${TS}`, expires_in: 3600, scope: 'Calendars.ReadBasic' }; };
          if (form.get('grant_type') === 'authorization_code') return form.get('code') === 'GOOD-CODE' ? send(200, issue()) : send(400, { error: 'invalid_grant', error_description: 'AADSTS70008 synthetic' });
          if (form.get('grant_type') === 'refresh_token') return mock.refresh === 'ok' && /^RT-\d+-/.test(String(form.get('refresh_token'))) ? send(200, issue()) : send(400, { error: 'invalid_grant' });
          return send(400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'POST' && url.pathname === '/v1.0/me/calendar/getSchedule') {
          const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
          const body = JSON.parse(raw || '{}');
          mock.calls.push({ kind: 'getSchedule', bearer, body });
          if (!mock.validAccess.has(bearer)) return send(401, { error: { code: 'InvalidAuthenticationToken' } });
          if (mock.graph === '503') return send(503, { error: { code: 'ServiceNotAvailable' } });
          const from = new Date(`${body.startTime.dateTime}Z`); const to = new Date(`${body.endTime.dateTime}Z`);
          const n = Math.round((to - from) / 900000); let view = '';
          for (let i = 0; i < n; i += 1) { const t = from.getTime() + i * 900000; view += mock.busy && t >= mock.busy.start && t < mock.busy.end ? '2' : '0'; }
          if (mock.graph === 'stale') view = view.slice(0, Math.max(0, n - 2));
          return send(200, { value: [{ scheduleId: body.schedules?.[0], availabilityView: view }] });
        }
        return send(404, { error: 'not_found' });
      });
    });
    mock.server.listen(0, '127.0.0.1', () => { mock.port = mock.server.address().port; resolve(); });
  });
}

describe.skipIf(!hasDatabase)('R46 Outlook free/busy against a local mock Graph (real DB, real HTTP)', () => {
  let db, rdv, auth, userAuth, proSettings, outlook, callback, availability, calendar, svc, cryptoTok;
  let handleP1 = ''; let slots = [];
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:5183', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const asPro = (who, sid = who.sid) => ({ host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: sid, role: who.role })}` });
  const invoke = async (handler, who, { method = 'GET', url, body, query = {}, headers = {} } = {}) => { const r = mk(); await handler({ method, url, query, body, headers: { ...asPro(who), ...headers } }, r); return r; };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsFor = async (professional, as = C[0]) => {
    const r = await call('GET', `structures/${T.slug}/slots`, { query: { serviceId: T.svc, from: day(2), to: day(6), professional }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots.map((s) => s.startAt);
  };
  const tokenRow = async () => (await db.execute(sql`SELECT "accessTokenEnc" AS a, "refreshTokenEnc" AS r, "expiresAt" AS e, scope FROM "ProOutlookToken" WHERE "userId" = ${P1.id}`)).rows[0];
  const status = async () => (await invoke(outlook, P1, { url: '/api/pro/outlook?action=status', query: { action: 'status' } })).body.status;
  /** the professional starts the connection; returns the state, the browser cookie and the authorisation URL */
  const authorize = async (who = P1) => {
    const r = await invoke(outlook, who, { url: '/api/pro/outlook?action=authorize', query: { action: 'authorize' } });
    expect(r.statusCode, show(r)).toBe(200);
    const u = new URL(r.body.authUrl);
    return { url: u, state: u.searchParams.get('state'), cookie: String(r.headers['Set-Cookie']).split(';')[0] };
  };
  const back = async ({ state, code = 'GOOD-CODE', cookieHeader }) => {
    const r = mk();
    await callback({ method: 'GET', url: `/api/auth/callback/outlook?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, query: {}, headers: { host: 'x', ...(cookieHeader ? { cookie: cookieHeader } : {}) } }, r);
    return r;
  };

  beforeAll(async () => {
    await startMock();
    vi.stubEnv('OUTLOOK_ENABLED', 'true'); vi.stubEnv('OUTLOOK_CLIENT_ID', 'lab-client'); vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'lab-secret-value-r46');
    vi.stubEnv('OUTLOOK_REDIRECT_URI', 'https://lab.invalid/api/auth/callback/outlook'); vi.stubEnv('ADA_VAULT_KEY', 'v'.repeat(48));
    vi.stubEnv('OUTLOOK_AUTHORITY_URL', `http://127.0.0.1:${mock.port}/tenant/oauth2/v2.0`); vi.stubEnv('OUTLOOK_GRAPH_BASE_URL', `http://127.0.0.1:${mock.port}/v1.0`);
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    calendar = await import('../../api/_services/rdv-calendar-busy.js');
    svc = await import('../../api/_services/calendar-outlook.js');
    cryptoTok = await import('../../api/_utils/outlook-token-crypto.js');
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    outlook = (await import('../../api/_handlers/pro/outlook.js')).default;
    callback = (await import('../../api/_handlers/auth/outlook-callback.js')).default;
    availability = (await import('../../api/_handlers/pro/outlook-availability.js')).default;
    for (const s of [T, OTHER]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + T.id}, ${T.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${T.id}-${weekday}`}, ${T.id}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${T.svc}, ${T.id}, 'Accueil social', 30, 0, 0, true, NOW())`);
    for (const p of PROS) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
      if (p.name) await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "jobTitle", "updatedAt") VALUES (${'pp-' + p.id}, ${p.id}, ${p.name}, 'Conseil', NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
    const team = await invoke(proSettings, ADMIN, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { team: { enabled: true, members: { [P1.id]: { bookable: true, selectable: true }, [P2.id]: { bookable: true, selectable: true } } } } });
    expect(team.statusCode, show(team)).toBe(200);
    const t = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[0] });
    handleP1 = t.body.professionals.find((p) => p.displayName === P1.name).id;
    slots = await slotsFor(handleP1);
    expect(slots.length).toBeGreaterThan(10);
    mock.busy = { start: new Date(slots[2]).getTime(), end: new Date(slots[2]).getTime() + 30 * 60000 };
  }, 60000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise((r) => (mock.server ? mock.server.close(() => r()) : r()));
    if (!db) return;
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${T.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${T.id}`).catch(() => {});
    for (const q of [sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${T.id}`, sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${T.id}`,
      sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${T.id}`, sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${T.id}`]) await db.execute(q);
    for (const p of PROS) {
      await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id} OR entity_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const s of [T, OTHER]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    for (const c of C) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
  });

  it('connect: least-privilege scope on the mock authority; a state for another browser, a refused code, a forged or foreign-structure state store nothing', async () => {
    expect(await status()).toBe('not_connected');
    const a = await authorize();
    expect(a.url.origin).toBe(`http://127.0.0.1:${mock.port}`);
    expect(a.url.searchParams.get('scope')).toBe('openid profile email offline_access Calendars.ReadBasic');
    expect(a.url.searchParams.get('scope')).not.toMatch(/ReadWrite|Calendars\.Read\b/);
    const before = mock.calls.length;
    const otherBrowser = await back({ state: a.state, cookieHeader: '__ada_outlook_state=someone-else-nonce' });
    const noCookie = await back({ state: a.state });
    const forged = await back({ state: `${a.state.split('.')[0]}.AAAA`, cookieHeader: a.cookie });
    expect([otherBrowser.statusCode, noCookie.statusCode, forged.statusCode]).toEqual([400, 400, 400]);
    expect(mock.calls.length, 'no code exchanged without the right browser and a valid signature').toBe(before);
    const refused = await back({ state: a.state, code: 'BAD-CODE', cookieHeader: a.cookie });
    expect(refused.statusCode).toBe(400);
    expect(JSON.stringify(refused.body)).not.toMatch(/AADSTS|invalid_grant/);   // the provider's text is never echoed
    // a state issued while the professional belonged to another structure (moved since) links nothing
    const nonce = 'r46-foreign-nonce-0000000000';
    const foreign = svc.signState({ userId: P1.id, structureId: OTHER.id }, { nonce });
    const moved = await back({ state: foreign, cookieHeader: `__ada_outlook_state=${nonce}` });
    expect(moved.statusCode).toBe(403);
    expect(await tokenRow()).toBeUndefined();
  });

  it('callback stores the tokens encrypted for THIS professional; status connected; public slots lose the Outlook-busy slot only for that professional', async () => {
    const a = await authorize();
    const r = await back({ state: a.state, cookieHeader: a.cookie });
    expect([r.statusCode, r.headers.Location], show(r)).toEqual([302, '/pro/dashboard?outlook=connected']);
    const row = await tokenRow();
    expect(row.a).not.toContain('AT-'); expect(row.r).not.toContain('RT-');
    expect(cryptoTok.decryptToken(row.a)).toMatch(/^AT-\d+-/);
    expect(await status()).toBe('connected');
    const audit = (await db.execute(sql`SELECT details::text AS d FROM "AuditLog" WHERE action = 'OUTLOOK_CONNECTED' AND entity_id = ${P1.id}`)).rows;
    expect(audit.length).toBe(1); expect(audit[0].d).not.toMatch(/AT-|RT-|GOOD-CODE/);
    calendar.clearCalendarCache();
    const p1 = await slotsFor(handleP1);
    expect(p1).not.toContain(slots[2]); expect(p1).toContain(slots[3]);
    expect(await slotsFor('ANY')).toContain(slots[2]);   // P2 has no connected calendar: the internal engine decides
    const asked = mock.calls.filter((c) => c.kind === 'getSchedule').at(-1);
    expect(asked.body.startTime.timeZone).toBe('UTC'); expect(asked.body.availabilityViewInterval).toBe(15);
    expect(Object.keys(asked.body).sort()).toEqual(['availabilityViewInterval', 'endTime', 'schedules', 'startTime']);
    const refused = await call('POST', 'appointments', { as: C[0], body: { structureSlug: T.slug, serviceId: T.svc, startAt: slots[2], idempotencyKey: `k-${Math.random()}`, professional: handleP1 } });
    expect(refused.statusCode, show(refused)).toBe(409);
  });

  it('renewal: an expired access token is refreshed once on the mock, the rotated pair is stored encrypted; a runtime 401 is one refresh + one retry', async () => {
    await db.execute(sql`UPDATE "ProOutlookToken" SET "expiresAt" = NOW() - interval '1 minute' WHERE "userId" = ${P1.id}`);
    calendar.clearCalendarCache();
    const n0 = mock.calls.filter((c) => c.kind === 'token:refresh_token').length;
    const p1 = await slotsFor(handleP1);
    expect(p1).not.toContain(slots[2]); expect(p1.length).toBeGreaterThan(5);
    expect(mock.calls.filter((c) => c.kind === 'token:refresh_token').length).toBe(n0 + 1);
    const row = await tokenRow();
    expect(cryptoTok.decryptToken(row.a)).toBe(`AT-${mock.tokenSeq}-${TS}`); expect(cryptoTok.decryptToken(row.r)).toBe(`RT-${mock.tokenSeq}-${TS}`);
    expect(new Date(row.e).getTime()).toBeGreaterThan(Date.now() + 3000_000);
    // revoked early at the provider (still « valid » for us): Graph answers 401 → one refresh, one retry, success
    mock.validAccess = new Set(['revoked-everything']);
    calendar.clearCalendarCache();
    const n1 = mock.calls.filter((c) => c.kind === 'token:refresh_token').length;
    const again = await slotsFor(handleP1);
    expect(again).not.toContain(slots[2]); expect(again.length).toBeGreaterThan(5);
    expect(mock.calls.filter((c) => c.kind === 'token:refresh_token').length).toBe(n1 + 1);
  });

  it('error recovery: a Graph outage or an incomplete answer offers none of that professional\'s slots (others still offered); it recovers on its own', async () => {
    mock.graph = '503'; calendar.clearCalendarCache();
    expect(await slotsFor(handleP1)).toEqual([]);
    expect(await slotsFor('ANY')).toContain(slots[4]);
    const refused = await call('POST', 'appointments', { as: C[1], body: { structureSlug: T.slug, serviceId: T.svc, startAt: slots[5], idempotencyKey: `k-${Math.random()}`, professional: handleP1 } });
    expect(refused.statusCode).toBe(409);
    mock.graph = 'stale';
    expect(await slotsFor(handleP1)).toEqual([]);   // a failure is never cached as « free »
    mock.graph = 'ok';   // healed: no cache flush, no manual step
    const back2 = await slotsFor(handleP1);
    expect(back2).toContain(slots[5]); expect(back2).not.toContain(slots[2]);
    const booked = await call('POST', 'appointments', { as: C[1], body: { structureSlug: T.slug, serviceId: T.svc, startAt: slots[5], idempotencyKey: `k-${Math.random()}`, professional: handleP1 } });
    expect(booked.statusCode, show(booked)).toBe(201);
    const owner = (await db.execute(sql`SELECT "createdByProUserId" AS p FROM "ProAppointment" WHERE id = ${booked.body.id}`)).rows[0].p;
    expect(owner).toBe(P1.id);
  });

  it('a refused renewal = reconnect required (honest status, fail safe); reconnecting restores; the professional\'s own availability route reads the same mock', async () => {
    mock.refresh = 'invalid_grant';
    await db.execute(sql`UPDATE "ProOutlookToken" SET "expiresAt" = NOW() - interval '1 minute' WHERE "userId" = ${P1.id}`);
    calendar.clearCalendarCache();
    expect(await slotsFor(handleP1)).toEqual([]);
    expect(await status()).toBe('token_expired');
    const own = await invoke(availability, P1, { url: `/api/pro/outlook-availability?start=${day(3)}T08:00:00&end=${day(3)}T12:00:00` });
    expect(own.statusCode).toBe(401);
    mock.refresh = 'ok';
    const a = await authorize();
    expect((await back({ state: a.state, cookieHeader: a.cookie })).statusCode).toBe(302);
    expect(await status()).toBe('connected');
    calendar.clearCalendarCache();
    expect((await slotsFor(handleP1)).length).toBeGreaterThan(5);
    const own2 = await invoke(availability, P1, { url: `/api/pro/outlook-availability?start=${day(3)}T08:00:00&end=${day(3)}T12:00:00` });
    expect(own2.statusCode, show(own2)).toBe(200);
    expect(own2.body.slots.length).toBeGreaterThan(0);
    expect(JSON.stringify(own2.body)).not.toMatch(/AT-|RT-/);
    expect(mock.calls.filter((c) => c.kind === 'getSchedule').at(-1).bearer).toMatch(/^AT-\d+-/);
  });

  it('disconnect deletes the tokens: the internal engine alone decides again; with Outlook switched off nothing is read', async () => {
    const d = await invoke(outlook, P1, { method: 'POST', url: '/api/pro/outlook?action=disconnect', query: { action: 'disconnect' } });
    expect(d.statusCode, show(d)).toBe(200);
    expect(await tokenRow()).toBeUndefined();
    calendar.clearCalendarCache();
    const n = mock.calls.length;
    expect(await slotsFor(handleP1)).toContain(slots[2]);   // no calendar connected: busy in Outlook is no longer known
    expect(mock.calls.length).toBe(n);
    vi.stubEnv('OUTLOOK_ENABLED', 'false');
    const off = await invoke(availability, P1, { url: `/api/pro/outlook-availability?start=${day(3)}T08:00:00&end=${day(3)}T12:00:00` });
    expect([off.statusCode, off.body.ok, off.body.status]).toEqual([200, false, 'not_configured']);
    const offStatus = await invoke(outlook, P1, { url: '/api/pro/outlook?action=status', query: { action: 'status' } });
    expect(offStatus.body.status).toBe('not_configured');
    expect(mock.calls.length).toBe(n);
    vi.stubEnv('OUTLOOK_ENABLED', 'true');
  });
});
