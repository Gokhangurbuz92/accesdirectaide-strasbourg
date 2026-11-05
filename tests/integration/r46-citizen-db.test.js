/**
 * R46 citizen worker on REAL PostgreSQL, through the real API entry (api/index.js: CSRF, routing, capability gate) with signed session cookies:
 *  - N03 in-app notifications: derived from the account's own records, isolation between accounts, no content / names in the payload, « read all »;
 *  - N08 FranceConnect: link from a signed-in session, sign-in of the LINKED account only, no sign-in for an unlinked identity (no account creation, no
 *    e-mail matching), one identity ↔ one account, unlink, logout with the provider's end-session address — against the LOCAL mock provider;
 *  - C05 verifier side: an administrator with MFA records the strong check (reason required; POLICY_PENDING without a DPO policy);
 *  - C09 Mon Coffre through the ProtectedStore boundary (LAB driver) and its refusal in production.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const BLOBS = vi.hoisted(() => new Map());
vi.mock('../../api/lib/storage.js', () => ({ storage: {
  upload: async (buf) => { const k = `r46-key-${BLOBS.size}-${Math.random().toString(36).slice(2)}`; BLOBS.set(k, Buffer.from(buf)); return k; },
  download: async (k) => { if (!BLOBS.has(k)) throw new Error('missing blob'); return BLOBS.get(k); },
  delete: async (k) => { BLOBS.delete(k); },
} }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `r46-a-${TS}`, email: `r46-a-${TS}@example.test` };
const B = { id: `r46-b-${TS}`, email: `r46-b-${TS}@example.test` };
const M = { id: `r46-m-${TS}`, email: `r46-m-${TS}@example.test` };   // a (pre-existing, synthetic) minor-band account
const ID = { str: `r46-str-${TS}`, svc: `r46-svc-${TS}`, rdv: `r46-rdv-${TS}`, conv: `r46-conv-${TS}` };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('synthetic r46 document '.repeat(10))]);

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}
const setCookies = (res) => [].concat(res.headers['set-cookie'] || []).map(String);
const cookieValue = (res, name) => { const c = setCookies(res).find((x) => x.startsWith(`${name}=`)); return c ? c.split(';')[0].slice(name.length + 1) : null; };

describe.skipIf(!hasDatabase)('R46 citizen journeys (real DB, real API entry)', () => {
  let db, api, userAuth, auth, mock;
  const sessionOf = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const CSRF = 'r46csrftoken0123456789abcdef';
  const call = async (method, url, { as, cookie = '', body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', cookie, `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:5182', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };

  beforeAll(async () => {
    const { startMockFranceConnect } = await import('../../scripts/lab/mock-franceconnect.mjs');
    mock = await startMockFranceConnect({ sub: `r46-sub-a-${TS}` });
    Object.assign(process.env, { FRANCECONNECT_ISSUER: mock.issuer, FRANCECONNECT_CLIENT_ID: mock.clientId, FRANCECONNECT_CLIENT_SECRET: mock.clientSecret, APP_BASE_URL: 'http://localhost:5182' });
    ({ db } = await import('../../src/db/index.js'));
    const schema = await import('../../src/db/schema.js');
    api = (await import('../../api/index.js')).default;
    userAuth = await import('../../api/_utils/user-auth.js');
    auth = await import('../../api/_utils/auth.js');
    for (const u of [A, B, M]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES (${A.id}, '25-59', 'Synthétique A', NOW()), (${M.id}, 'moins-de-18', 'Synthétique M', NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES (${ID.str}, 'Structure R46 secrète', ${'r46-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.str, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    const start = new Date(Date.now() + 3 * 86400000);
    await db.insert(schema.ProAppointment).values({ id: ID.rdv, structureId: ID.str, serviceId: ID.svc, startAt: start, endAt: new Date(start.getTime() + 1800000), status: 'confirmed', beneficiaryName: 'A', citizenUserId: A.id });
    await db.execute(sql`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES (${'r46-n1-' + TS}, ${ID.rdv}, 'RESCHEDULED', 'citizen', 'email', 'NOT_DELIVERED'), (${'r46-n2-' + TS}, ${ID.rdv}, 'RESCHEDULED', 'structure', 'email', 'NOT_DELIVERED')`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "updatedAt") VALUES (${ID.conv}, ${ID.rdv}, ${ID.str}, ${A.id}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", body) VALUES (${'r46-m1-' + TS}, ${ID.conv}, 'PRO', 'CONTENU-SECRET-DU-MESSAGE')`);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, status, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${'r46-p1-' + TS}, ${A.id}, 'MANUAL', 'custom', 'TITRE-SECRET', 'IN_PROGRESS', NOW() + interval '3 days', 'https://www.service-public.fr/particuliers/vosdroits/F0', NOW())`);
    await db.execute(sql`INSERT INTO "GuardianRelationship" (id, "minorId", "guardianId", status, scopes, "updatedAt") VALUES (${'r46-g-' + TS}, ${M.id}, ${A.id}, 'DECLARED', '[]'::jsonb, NOW())`);
  }, 60000);
  afterAll(async () => {
    await mock?.close();
    if (!db) return;
    await db.execute(sql`DELETE FROM "GuardianRelationship" WHERE "minorId" = ${M.id}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${ID.rdv}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID.str}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${A.id}, ${B.id}, ${M.id})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id}, ${M.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id}, ${M.id})`);
  });

  describe('N03 in-app notifications', () => {
    it('anonymous → 401; the account sees its own events only, without content or names', async () => {
      expect((await call('GET', '/api/citizen/notifications')).statusCode).toBe(401);
      const r = await call('GET', '/api/citizen/notifications', { as: A });
      expect(r.statusCode).toBe(200);
      const kinds = r.body.notifications.map((n) => n.kind).sort();
      expect(kinds).toEqual(['APPOINTMENT_RESCHEDULED', 'GUARDIAN_REQUEST', 'MESSAGE_FROM_STRUCTURE', 'PARCOURS_DEADLINE_SOON']);   // the structure-side notice is not listed
      expect(r.body.unread).toBe(4);
      const raw = JSON.stringify(r.body);
      for (const secret of ['CONTENU-SECRET', 'TITRE-SECRET', 'Structure R46', 'Synthétique', '@example.test', ID.rdv, M.id]) expect(raw).not.toContain(secret);
      expect(r.body.notifications.find((n) => n.kind === 'MESSAGE_FROM_STRUCTURE').link).toBe(`/compte/messages/${ID.conv}`);
      const b = await call('GET', '/api/citizen/notifications', { as: B });
      expect(b.body.notifications).toEqual([]);
    });
    it('« read all » sets the seen marker; nothing is unread after; the marker is not a preference', async () => {
      const w = await call('POST', '/api/citizen/notifications', { as: A, body: { action: 'read-all' } });
      expect(w.statusCode).toBe(200);
      const r = await call('GET', '/api/citizen/notifications', { as: A });
      expect(r.body.unread).toBe(0);
      expect(r.body.notifications.every((n) => n.unread === false)).toBe(true);
      const p = await call('GET', '/api/citizen/preferences', { as: A });
      expect(Object.keys(p.body.preferences).some((k) => k.includes('seen'))).toBe(false);
      expect((await call('POST', '/api/citizen/notifications', { as: A, body: { action: 'nope' } })).statusCode).toBe(400);
    });
    it('a mutation without the CSRF pair is refused', async () => {
      const req = { method: 'POST', url: '/api/citizen/notifications', query: {}, body: { action: 'read-all' }, cookies: {}, headers: { host: 'localhost:5182', cookie: sessionOf(A) } };
      const res = mkRes(); await api(req, res);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('N08 FranceConnect (mock provider)', () => {
    /** login|link → provider → callback, returns the callback response */
    const roundTrip = async (action, { as } = {}) => {
      const start = await call('GET', `/api/auth/franceconnect/${action}?next=/compte`, { as });
      expect(start.statusCode).toBe(302);
      const flow = cookieValue(start, 'ada_fc_flow');
      const prov = await fetch(start.headers.location, { redirect: 'manual' });
      const back = new URL(prov.headers.get('location'));
      return call('GET', `${back.pathname}${back.search}`, { as, cookie: `ada_fc_flow=${flow}` });
    };
    it('status says available in the LAB (not live) and whether the account is linked', async () => {
      const s = await call('GET', '/api/auth/franceconnect/status', { as: A });
      expect(s.body).toMatchObject({ available: true, live: false, linked: false });
    });
    it('an unlinked identity never signs in (no account created, no e-mail matching)', async () => {
      const users = (await db.execute(sql`SELECT count(*)::int n FROM "CitizenUser"`)).rows[0].n;
      const r = await roundTrip('login');
      expect([r.statusCode, r.headers.location]).toEqual([302, '/auth/login?fc=not_linked']);
      expect(setCookies(r).some((c) => c.startsWith('ada_user_session=') && !c.startsWith('ada_user_session=;'))).toBe(false);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenUser"`)).rows[0].n).toBe(users);
    });
    it('link from a session, then sign-in of that account; the link row holds no sub', async () => {
      const l = await roundTrip('link', { as: A });
      expect([l.statusCode, l.headers.location]).toEqual([302, '/compte?fc=linked']);
      const rows = (await db.execute(sql`SELECT type, "tokenHash" FROM "AuthToken" WHERE "userId" = ${A.id} AND type = 'FRANCECONNECT_LINK'`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toMatch(/^fclink:[0-9a-f]{64}$/);
      expect(rows[0].tokenHash).not.toContain(`r46-sub-a-${TS}`);
      const r = await roundTrip('login');
      expect([r.statusCode, r.headers.location]).toEqual([302, '/compte']);
      const session = cookieValue(r, 'ada_user_session');
      expect(userAuth.verifyUserSessionToken(decodeURIComponent(session)).userId).toBe(A.id);
      expect(cookieValue(r, 'ada_fc_idt')).toBeTruthy();
    });
    it('the same identity cannot be linked to a second account; a state mismatch is refused', async () => {
      const l = await roundTrip('link', { as: B });
      expect(l.headers.location).toBe('/auth/login?fc=linked_elsewhere');
      const start = await call('GET', '/api/auth/franceconnect/login');
      const prov = await fetch(start.headers.location, { redirect: 'manual' });
      const back = new URL(prov.headers.get('location'));
      const forged = await call('GET', `${back.pathname}?code=${back.searchParams.get('code')}&state=forged`, { cookie: `ada_fc_flow=${cookieValue(start, 'ada_fc_flow')}` });
      expect(forged.headers.location).toBe('/auth/login?fc=state_invalid');
      const noCookie = await call('GET', `${back.pathname}${back.search}`);
      expect(noCookie.headers.location).toBe('/auth/login?fc=state_invalid');
    });
    it('a tampered ID token signature is refused (no session)', async () => {
      mock.set({ badSignature: true });
      try {
        const r = await roundTrip('login');
        expect(r.headers.location).toBe('/auth/login?fc=verification_failed');
        expect(cookieValue(r, 'ada_user_session')).toBeNull();
      } finally { mock.set({}); }
    });
    it('logout revokes the ADA session and returns the provider end-session address; unlink removes the link', async () => {
      const r = await roundTrip('login');
      const idt = cookieValue(r, 'ada_fc_idt');
      const out = await call('POST', '/api/auth/franceconnect/logout', { as: A, cookie: `ada_fc_idt=${idt}` });
      expect(out.statusCode).toBe(200);
      expect(new URL(out.body.endSessionUrl).searchParams.get('id_token_hint')).toBe(decodeURIComponent(idt));
      const after = (await db.execute(sql`SELECT "sessionsValidAfter" s FROM "CitizenUser" WHERE id = ${A.id}`)).rows[0].s;
      expect(after).toBeTruthy();
      await new Promise((res) => { setTimeout(res, 5); });   // a session issued after the logout's revocation instant
      const u2 = await call('POST', '/api/auth/franceconnect/unlink', { as: A });
      expect(u2.statusCode).toBe(200);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AuthToken" WHERE "userId" = ${A.id} AND type = 'FRANCECONNECT_LINK'`)).rows[0].n).toBe(0);
      expect((await roundTrip('login')).headers.location).toBe('/auth/login?fc=not_linked');
    });
  });

  describe('C05 verifier side (admin, MFA)', () => {
    it('needs an MFA administrator session, a reason, and stays POLICY_PENDING without a DPO policy', async () => {
      const [rel] = (await db.execute(sql`SELECT id FROM "GuardianRelationship" WHERE "minorId" = ${M.id}`)).rows;
      await db.execute(sql`UPDATE "GuardianRelationship" SET status = 'STRONGER_VERIFICATION_REQUIRED' WHERE id = ${rel.id}`);
      const mfa = auth.signAdminSessionToken({ email: `r46-adm-${TS}@example.test`, role: 'admin', mfa_verified: true });
      const noMfa = auth.signAdminSessionToken({ email: `r46-adm-${TS}@example.test`, role: 'admin', mfa_verified: false });
      expect((await call('POST', '/api/admin/guardianships', { body: { action: 'list' } })).statusCode).toBe(401);
      expect((await call('POST', '/api/admin/guardianships', { bearer: noMfa, body: { action: 'list' } })).statusCode).toBe(403);
      const l = await call('POST', '/api/admin/guardianships', { bearer: mfa, body: { action: 'list' } });
      expect(l.body.pending.map((p) => p.id)).toContain(rel.id);
      expect(JSON.stringify(l.body)).not.toMatch(/@example\.test|Synthétique/);
      expect(l.body.policy.strongVerification).toBe('POLICY_PENDING');
      expect((await call('POST', '/api/admin/guardianships', { bearer: mfa, body: { action: 'record', id: rel.id, method: 'PROFESSIONAL_ATTESTATION', reason: 'court' } })).body.error).toBe('reason_required');
      const rec = await call('POST', '/api/admin/guardianships', { bearer: mfa, body: { action: 'record', id: rel.id, method: 'PROFESSIONAL_ATTESTATION', reason: 'Attestation synthétique vérifiée en LAB' } });
      expect([rec.statusCode, rec.body.error]).toEqual([409, 'POLICY_PENDING']);
      const prev = process.env.ADA_AGE_POLICY_JSON;
      process.env.ADA_AGE_POLICY_JSON = JSON.stringify({ status: 'CONFIGURED', version: 'test-dpo', bands: { 'moins-de-18': { account: 'GUARDIAN_CONSENT_REQUIRED' }, '18-24': { account: 'ALLOWED' }, '25-59': { account: 'ALLOWED' }, '60-et-plus': { account: 'ALLOWED' } },
        guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION'], scopes: ['household'] } });
      try {
        const ok = await call('POST', '/api/admin/guardianships', { bearer: mfa, body: { action: 'record', id: rel.id, method: 'PROFESSIONAL_ATTESTATION', reason: 'Attestation synthétique vérifiée en LAB' } });
        expect([ok.statusCode, ok.body.guardianship.status]).toEqual([200, 'VERIFIED_STRONG']);
        const a = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'guardian.strong_verification_recorded' AND entity_id = ${rel.id}`)).rows;
        expect(a).toHaveLength(1);
        await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id = ${rel.id}`);
      } finally { if (prev === undefined) delete process.env.ADA_AGE_POLICY_JSON; else process.env.ADA_AGE_POLICY_JSON = prev; }
    });
  });

  describe('C09 Mon Coffre through the ProtectedStore boundary', () => {
    it('LAB driver: upload, download (same bytes), delete purges the blob; production without HDS refuses before storage', async () => {
      const up = await call('POST', '/api/citizen/coffre', { as: A, body: { category: 'logement', originalName: 'bail.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') } });
      expect(up.statusCode).toBe(201);
      const [doc] = (await db.execute(sql`SELECT "storageKey" k FROM "CitizenDocument" WHERE id = ${up.body.document.id}`)).rows;
      expect(BLOBS.has(doc.k)).toBe(true);
      expect(BLOBS.get(doc.k).includes(Buffer.from('synthetic r46'))).toBe(false);   // sealed before the store
      const dl = await call('GET', `/api/citizen/coffre?download=${up.body.document.id}`, { as: A });
      expect(Buffer.compare(Buffer.from(dl.body), PDF)).toBe(0);
      const mon = await import('../../api/_services/mon-espace.js');
      const { createProtectedStore } = await import('../../api/lib/protected-store/index.js');
      const refused = await mon.uploadCoffre(A.id, { category: 'logement', originalName: 'x.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') },
        { storage: createProtectedStore({ env: { VERCEL_ENV: 'production' } }) }).catch((e) => e);
      expect(refused.code).toBe('PROTECTED_STORE_REFUSED');
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenDocument" WHERE "userId" = ${A.id}`)).rows[0].n).toBe(1);
      expect((await call('DELETE', '/api/citizen/coffre', { as: A, body: { id: up.body.document.id } })).statusCode).toBe(200);
      expect(BLOBS.has(doc.k)).toBe(false);
    });
  });
});
