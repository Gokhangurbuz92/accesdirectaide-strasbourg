/**
 * Appointment messaging (citizen ↔ structure) — real PostgreSQL, real citizen cookies / pro JWTs, synthetic mail (test outbox).
 * Regression guard: the citizen handler (/api/messages/*) and the full pro handler (/api/pro/messages/conversations/*)
 * were unreachable after the 2026-03-14 cleanup. Also asserts the routes exist in api/routes.js and resolve like api/index.js does.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('AUTH_SECRET', 'test-auth-secret-messaging');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
// KV points at an unreachable localhost stub in tests (4s retry per call) — use an in-memory counter instead
vi.mock('../../api/_utils/kv.js', () => { const c = new Map(); return { kv: { incr: async (k) => { c.set(k, (c.get(k) || 0) + 1); return c.get(k); }, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }; });

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `msg-s1-${TS}`, S2 = `msg-s2-${TS}`, SVC = `msg-svc-${TS}`, APT_A = `msg-apt-a-${TS}`, APT_B = `msg-apt-b-${TS}`, APT_C = `msg-apt-c-${TS}`;
const P1 = { id: `msg-p1-${TS}`, email: `p1-${TS}@example.test` }, P2 = { id: `msg-p2-${TS}`, email: `p2-${TS}@example.test` };
const A = { id: `msg-ca-${TS}`, email: `a-${TS}@example.test` }, B = { id: `msg-cb-${TS}`, email: `b-${TS}@example.test` }, UNV = { id: `msg-cu-${TS}`, email: `u-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c) { this.statusCode = c; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('messaging (real DB)', () => {
  let db, schema, auth, ua, mailer, citizenH, proH, convId;
  const cit = (u) => ua.buildUserSessionCookie(ua.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const pro = (u, sid) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: sid, role: 'STRUCTURE_ADMIN' })}`;
  const callC = async (method, path, { body, user } = {}) => { const r = mk(); await citizenH({ method, url: `/api/messages${path}`, query: {}, body, headers: { host: 'x', ...(user ? { cookie: cit(user) } : {}) } }, r); return r; };
  const callP = async (method, path, { body, token } = {}) => { const r = mk(); await proH({ method, url: `/api/pro/messages/conversations${path}`, query: {}, body, headers: { host: 'x', ...(token ? { authorization: token } : {}) } }, r); return r; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js'); ua = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    ({ default: citizenH } = await import('../../api/_handlers/messages.js')); ({ default: proH } = await import('../../api/_handlers/pro/messages-conversations.js'));
    for (const [sid, n] of [[S1, 1], [S2, 2]]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'MSG ' + n}, ${'msg-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.insert(schema.ProUser).values([{ id: P1.id, email: P1.email, password_hash: 'x', structureId: S1, role: 'STRUCTURE_ADMIN', status: 'active' }, { id: P2.id, email: P2.email, password_hash: 'x', structureId: S2, role: 'STRUCTURE_ADMIN', status: 'active' }]);
    const v = new Date();
    await db.insert(schema.CitizenUser).values([{ id: A.id, email: A.email, passwordHash: 'x', emailVerifiedAt: v }, { id: B.id, email: B.email, passwordHash: 'x', emailVerifiedAt: v }, { id: UNV.id, email: UNV.email, passwordHash: 'x', emailVerifiedAt: null }]);
    await db.insert(schema.ProRdvService).values({ id: SVC, structureId: S1, name: 'Accompagnement', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    const t = (d) => new Date(Date.now() + d * 864e5);
    await db.insert(schema.ProAppointment).values([{ id: APT_A, structureId: S1, serviceId: SVC, startAt: t(3), endAt: t(3), status: 'confirmed', beneficiaryName: 'P', citizenUserId: A.id }, { id: APT_B, structureId: S1, serviceId: SVC, startAt: t(4), endAt: t(4), status: 'confirmed', beneficiaryName: 'P', citizenUserId: B.id }, { id: APT_C, structureId: S1, serviceId: SVC, startAt: t(5), endAt: t(5), status: 'confirmed', beneficiaryName: 'P', citizenUserId: null }]);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "RdvNotificationLog" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "structureId" IN (${S1}, ${S2}))`);
    await db.execute(sql`DELETE FROM "RdvConversationMessage" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "structureId" IN (${S1}, ${S2}))`);
    await db.execute(sql`DELETE FROM "RdvConversation" WHERE "structureId" IN (${S1}, ${S2})`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${S1}, ${S2})`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id}, ${UNV.id})`); await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${P1.id}, ${P2.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S1}, ${S2})`);
  });

  it('api/routes.js routes the messaging endpoints exactly like api/index.js resolves them', async () => {
    const { routes } = await import('../../api/routes.js');
    const resolve = (p) => routes.find((r) => (r.match === 'exact' ? r.path === p : p.startsWith(r.path) || p.startsWith(r.path + '/')));
    for (const [p, file] of [['messages/conversations', 'messages.js'], ['messages/conversations/x1', 'messages.js'], ['messages/from-appointment/a1', 'messages.js'],
      ['pro/messages/conversations', 'messages-conversations.js'], ['pro/messages/conversations/x1', 'messages-conversations.js'], ['pro/appointments/cancel', 'cancel.js'], ['pro/messages', 'messages.js']]) {
      const r = resolve(p); expect(r, p).toBeTruthy(); expect(String(r.handler), p).toContain(file);
    }
  });

  it('citizen: auth gates, from-appointment ownership, idempotent conversation', async () => {
    expect((await callC('GET', '/conversations')).statusCode).toBe(401);
    const unv = await callC('GET', '/conversations', { user: UNV }); expect(unv.statusCode).toBe(403); expect(unv.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await callC('POST', `/from-appointment/${APT_A}`, { user: B })).statusCode).toBe(403);   // not B's appointment
    expect((await callC('POST', '/from-appointment/does-not-exist', { user: A })).statusCode).toBe(404);
    const created = await callC('POST', `/from-appointment/${APT_A}`, { user: A }); expect(created.statusCode).toBe(200);
    convId = created.body.conversationId; expect(convId).toBeTruthy();
    expect((await callC('POST', `/from-appointment/${APT_A}`, { user: A })).body.conversationId).toBe(convId);
  });

  it('citizen sends: stored encrypted, structure notified without message content, validation, isolation', async () => {
    mailer.__clearTestOutbox();
    expect((await callC('POST', `/conversations/${convId}`, { user: A, body: { body: '   ' } })).statusCode).toBe(400);
    const text = 'Bonjour <b>besoin</b> d\'aide pour mon dossier';
    const sent = await callC('POST', `/conversations/${convId}`, { user: A, body: { body: text } });
    expect(sent.statusCode).toBe(201);
    const stored = (await db.execute(sql`SELECT body FROM "RdvConversationMessage" WHERE "conversationId" = ${convId}`)).rows;
    expect(stored).toHaveLength(1); expect(stored[0].body).not.toContain('besoin');        // encrypted at rest
    const box = mailer.__getTestOutbox();
    expect(box).toHaveLength(1); expect(box[0].to).toBe(P1.email); expect(box[0].text).not.toContain('besoin'); // no content in the mail
    expect(box[0].text).toContain(`/pro/messages/${convId}`);
    const long = await callC('POST', `/conversations/${convId}`, { user: A, body: { body: 'x'.repeat(5000) } });
    expect(long.statusCode).toBe(201);                                                    // truncated by sanitizeMessageBody (2000)
    // isolation
    expect((await callC('POST', `/conversations/${convId}`, { user: B, body: { body: 'intrus' } })).statusCode).toBe(404);   // PKG-4: no existence oracle (was 403)
    expect((await callC('GET', `/conversations/${convId}`, { user: B })).statusCode).toBe(404);
    expect((await callC('GET', '/conversations/unknown-id', { user: A })).statusCode).toBe(404);
    expect((await callC('POST', '/conversations/unknown-id', { user: A, body: { body: 'x' } })).statusCode).toBe(404);
    expect(((await callC('GET', '/conversations', { user: B })).body.items || [])).toHaveLength(0);
    const list = await callC('GET', '/conversations', { user: A }); expect(list.body.items.map((i) => i.id)).toContain(convId);
    const detail = await callC('GET', `/conversations/${convId}`, { user: A });
    expect(detail.statusCode).toBe(200);
    const bodies = JSON.stringify(detail.body); expect(bodies).toContain('Bonjour'); expect(bodies).not.toContain('<b>');   // decrypted + sanitised for the owner
  });

  it('pro: scoped to own structure; send notifies the citizen; actors cannot cross over', async () => {
    mailer.__clearTestOutbox();
    const t1 = pro(P1, S1), t2 = pro(P2, S2);
    expect((await callP('GET', '')).statusCode).toBe(401);
    expect((await callP('GET', '', { token: t1 })).body.items.map((i) => i.id)).toContain(convId);
    expect(((await callP('GET', '', { token: t2 })).body.items || []).map((i) => i.id)).not.toContain(convId);
    expect((await callP('GET', `/${convId}`, { token: t1 })).statusCode).toBe(200);
    expect((await callP('GET', `/${convId}`, { token: t2 })).statusCode).toBe(404);   // PKG-4: no existence oracle (was 403)
    expect((await callP('POST', `/${convId}`, { token: t2, body: { body: 'intrus' } })).statusCode).toBe(404);
    expect((await callP('POST', `/${convId}`, { token: t1, body: { body: '' } })).statusCode).toBe(400);
    const sent = await callP('POST', `/${convId}`, { token: t1, body: { body: 'Rendez-vous confirmé, merci' } });
    expect(sent.statusCode).toBe(201);
    const box = mailer.__getTestOutbox(); expect(box).toHaveLength(1); expect(box[0].to).toBe(A.email); expect(box[0].text).not.toContain('confirmé');
    expect(JSON.stringify((await callC('GET', `/conversations/${convId}`, { user: A })).body)).toContain('Rendez-vous confirmé');
    expect((await callP('GET', `/${convId}`, { token: `Bearer ${auth.signAdminSessionToken({ email: 'a@example.test', role: 'admin', mfa_verified: true })}` })).statusCode).toBe(401);
    const r = mk(); await citizenH({ method: 'GET', url: '/api/messages/conversations', query: {}, headers: { host: 'x', authorization: t1 } }, r); expect(r.statusCode).toBe(401); // pro token is not a citizen session
  });

  it('pro cancel appointment: structure-scoped', async () => {
    const { default: cancelH } = await import('../../api/_handlers/pro/appointments/cancel.js');
    const call = async (token, id) => { const r = mk(); await cancelH({ method: 'POST', url: '/api/pro/appointments/cancel', query: {}, body: { id }, headers: { host: 'x', authorization: token } }, r); return r; };
    expect((await call(pro(P2, S2), APT_B)).statusCode).toBe(404);   // R12: same answer as unknown
    mailer.__clearTestOutbox();
    const ok = await call(pro(P1, S1), APT_B); expect(ok.statusCode).toBe(200); expect(ok.body.item.status).toBe('cancelled');
    const row = (await db.execute(sql`SELECT status, "cancelledAt", "cancelledBy" FROM "ProAppointment" WHERE id = ${APT_B}`)).rows[0];
    expect(row.status).toBe('cancelled'); expect(row.cancelledBy).toBe('PRO'); expect(row.cancelledAt).toBeTruthy();
    const box = mailer.__getTestOutbox(); expect(box).toHaveLength(1); expect(box[0].to).toBe(B.email); expect(box[0].subject).not.toContain('MSG');   // citizen told, no structure name in subject
    expect((await call(pro(P1, S1), APT_B)).statusCode).toBe(200); expect(mailer.__getTestOutbox()).toHaveLength(1);      // idempotent: no second mail
    expect((await call(pro(P1, S1), 'nope')).statusCode).toBe(404);
  });

  it('pro/messages?appointmentId= adapter (AppointmentDetail tab): contract, scoping, no-account case', async () => {
    const { default: h } = await import('../../api/_handlers/pro/messages.js');
    const call = async (method, id, { token, body } = {}) => { const r = mk(); await h({ method, url: `/api/pro/messages?appointmentId=${id}`, query: { appointmentId: id }, body, headers: { host: 'x', ...(token ? { authorization: token } : {}) } }, r); return r; };
    const t1 = pro(P1, S1), t2 = pro(P2, S2);
    expect((await call('GET', APT_A)).statusCode).toBe(401);
    expect((await call('GET', APT_A, { token: t2 })).statusCode).toBe(404);                 // foreign structure: no existence leak
    expect((await call('POST', APT_A, { token: t2, body: { content: 'x' } })).statusCode).toBe(404);
    expect((await call('GET', '', { token: t1 })).statusCode).toBe(400);
    const before = await call('GET', APT_A, { token: t1 });
    expect(before.statusCode).toBe(200); expect(before.body.messages.length).toBeGreaterThan(0);   // citizen + pro messages from earlier tests
    expect(before.body.messages[0]).toMatchObject({ sender: expect.stringMatching(/^(PRO|BENEFICIARY)$/), attachments: [] });
    expect((await call('POST', APT_A, { token: t1, body: { content: '  ' } })).statusCode).toBe(400);
    mailer.__clearTestOutbox();
    const sent = await call('POST', APT_A, { token: t1, body: { content: 'Via onglet messages' } });
    expect(sent.statusCode).toBe(201); expect(sent.body.item).toMatchObject({ sender: 'PRO', content: 'Via onglet messages' });
    expect(mailer.__getTestOutbox()).toHaveLength(1); expect(mailer.__getTestOutbox()[0].text).not.toContain('onglet');
    expect((await call('GET', APT_A, { token: t1 })).body.messages.at(-1).content).toBe('Via onglet messages');
    expect(JSON.stringify((await callC('GET', `/conversations/${convId}`, { user: A })).body)).toContain('Via onglet messages');   // same thread as the citizen sees
    expect((await call('GET', APT_C, { token: t1 })).body).toMatchObject({ messages: [], conversationId: null });
    const none = await call('POST', APT_C, { token: t1, body: { content: 'x' } });
    expect(none.statusCode).toBe(409); expect(none.body.code).toBe('NO_CITIZEN_ACCOUNT');
  });
});
