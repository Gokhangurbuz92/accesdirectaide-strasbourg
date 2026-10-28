/**
 * PKG-11 slice 10 on REAL PostgreSQL (migration 0033) — the remaining technically actionable items after RC26.
 *  - ADM-10: administrator sessions are checked against AdminUser on every request: « terminer toutes mes sessions » ends them, an elevated superadmin ends
 *    another administrator's sessions or disables / re-enables the account (never their own, always with a reason, audited); a disabled administrator cannot sign in;
 *  - ADM-11: a FALC review is recorded per field with the text's sha256: only the fields read are « relu », and a field edited afterwards is no longer;
 *  - PUB-6: a shared dossier is size-bounded by the database (share/create.js stays byte-pinned);
 *  - E05: « serves this commune » lists only the places whose reviewed service area covers the commune;
 *  - PRO-11: the same e-mail in two organizations — the password decides, a password opening both asks for the organization, each account gets its own reset link;
 *  - N02: a configured SMS provider sends NOTHING while a « STOP » reply cannot be honoured (recorded NOT_DELIVERED);
 *  - R2-7: a correct password on an unconfirmed address gets the one refusal answer (no account-existence oracle).
 * Synthetic data only; the mailer is the in-memory test provider; skipped without DATABASE_URL; no provider is called.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const KV = vi.hoisted(() => new Map());
vi.mock('../../api/_utils/kv.js', () => ({ kv: { set: async (k, v) => { KV.set(k, v); return 'OK'; }, get: async (k) => (KV.has(k) ? KV.get(k) : null), del: async (k) => (KV.delete(k) ? 1 : 0), incr: async () => 1, expire: async () => 1 } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/pipelineLock.js', () => ({ withLock: async (_name, fn) => fn() }));   // the cron's distributed lock is infrastructure (KV), not under test here

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ID = { a1: `a3-adm1-${TS}`, a2: `a3-adm2-${TS}`, aide: `a3-aide-${TS}`, sA: `a3-sA-${TS}`, sB: `a3-sB-${TS}`, o1: `a3-o1-${TS}`, o2: `a3-o2-${TS}`, p1: `a3-p1-${TS}`, p2: `a3-p2-${TS}`,
  cit: `a3-cit-${TS}`, svc: `a3-svc-${TS}`, rdv: `a3-rdv-${TS}`, dos: `a3-dos-${TS}` };
const ADM1 = `a3-adm1-${TS}@example.test`; const ADM2 = `a3-adm2-${TS}@example.test`; const PRO = `a3-pro-${TS}@example.test`;
const COMMUNE = '67482';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe.skipIf(!hasDatabase)('PKG-11 slice 10 (real DB)', () => {
  let db, schema, auth, userAuth, identity, falc, vis, search, mailer;
  const bearer = (token) => ({ method: 'GET', url: '/api/admin/x', query: {}, headers: { host: 'localhost', authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); identity = await import('../../api/_services/admin-identity.js');
    falc = await import('../../api/_services/falc-governance.js'); vis = await import('../../api/lib/publicVisibility.js'); search = await import('../../api/lib/search-query.js');
    mailer = await import('../../api/_utils/mailer.js');
    const pw = await userAuth.hashPassword('Admin-Mot-2026x');
    for (const [id, email, role] of [[ID.a1, ADM1, 'superadmin'], [ID.a2, ADM2, 'admin']]) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "failedLoginAttempts", "mfaEnabled", "updatedAt") VALUES (${id}, ${email}, ${pw}, ${role}, 0, false, NOW())`);
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, summary_falc, conditions_falc, montant_falc, "updatedAt")
      VALUES (${ID.aide}, ${ID.aide}, 'Aide FALC', 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW(), 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1',
        'Résumé simple de cette aide.', 'Pour les personnes qui habitent ici.', 'Le montant dépend de vos revenus.', NOW())`);
    for (const [id, codes] of [[ID.sA, [COMMUNE, '67043']], [ID.sB, ['67218']]]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut,
        launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, insee_codes, "updatedAt", "createdAt")
      VALUES (${id}, ${'Lieu ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', true, 'VERIFIED', 'reviewer-seed@example.test', true, 'official',
        NOW() - interval '1 day', 'https://www.service-public.fr/x', ${'{' + codes.join(',') + '}'}::text[], NOW(), NOW())`);   // a JS array would be expanded as a list of parameters
    for (const id of [ID.o1, ID.o2]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
      VALUES (${id}, ${'Organisation ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "phoneVerifiedAt", "updatedAt") VALUES (${ID.cit}, ${ID.cit + '@example.test'}, 'x', NOW(), '0612345678', NOW(), NOW())`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const like = `a3-%-${TS}`;
    for (const q of [sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" = ${ID.rdv}`, sql`DELETE FROM "ProAppointment" WHERE id = ${ID.rdv}`, sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`,
      sql`DELETE FROM "ConsentLog" WHERE subject_id = ${ID.cit}`, sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${ID.cit}`, sql`DELETE FROM "SharedDiagnostic" WHERE id = ${ID.dos}`,
      sql`DELETE FROM "AuditLog" WHERE actor IN (${ADM1}, ${ADM2}) OR entity_id IN (${ID.a1}, ${ID.a2}, ${ID.aide})`, sql`DELETE FROM "EntityVersion" WHERE entity_id = ${ID.aide}`,
      sql`DELETE FROM "Aide" WHERE id = ${ID.aide}`, sql`DELETE FROM "ProUser" WHERE id LIKE ${like}`, sql`DELETE FROM "Structure" WHERE id LIKE ${like}`, sql`DELETE FROM "AuthToken" WHERE "userId" LIKE ${'a3-%'}`,
      sql`DELETE FROM "CitizenUser" WHERE id LIKE ${like} OR email LIKE ${'a3-r27-' + TS + '%'}`, sql`DELETE FROM "AdminUser" WHERE id LIKE ${like}`]) await db.execute(q).catch(() => {});
  });

  it('ADM-10: sessions end on logout, on revocation and on disabling; only an elevated superadmin acts on another administrator, with a reason; audited', async () => {
    const t1 = auth.signAdminSessionToken({ email: ADM2, role: 'admin', mfa_verified: true });
    expect(await auth.resolveAuthContext(bearer(t1))).toMatchObject({ email: ADM2, authType: 'admin_jwt' });
    await wait(5);
    expect((await identity.logoutAll({ email: ADM2 }, { db })).ok).toBe(true);
    expect(await auth.resolveAuthContext(bearer(t1))).toBeNull();                                            // ended by « terminer toutes mes sessions »
    await wait(5); const t2 = auth.signAdminSessionToken({ email: ADM2, role: 'admin', mfa_verified: true });
    expect(await auth.resolveAuthContext(bearer(t2))).toMatchObject({ email: ADM2 });                        // a new sign-in works
    const me = { email: ADM1, role: 'superadmin' };
    expect(await identity.actOnAdministrator(me, { action: 'revoke', email: ADM2, reason: 'Poste quitté, accès retiré.' }, { db, elevated: false })).toMatchObject({ ok: false, code: 'ELEVATION_REQUIRED' });
    expect(await identity.actOnAdministrator(me, { action: 'disable', email: ADM1, reason: 'Essai sur soi-même.' }, { db, elevated: true })).toMatchObject({ ok: false, code: 'NOT_ON_YOURSELF' });
    expect(await identity.actOnAdministrator(me, { action: 'revoke', email: ADM2, reason: 'court' }, { db, elevated: true })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    await wait(5);
    expect(await identity.actOnAdministrator(me, { action: 'disable', email: ADM2, reason: 'Départ de l’équipe, compte désactivé.' }, { db, elevated: true })).toMatchObject({ ok: true });
    expect(await auth.resolveAuthContext(bearer(t2))).toBeNull();
    await wait(5); const t3 = auth.signAdminSessionToken({ email: ADM2, role: 'admin', mfa_verified: true });
    expect(await auth.resolveAuthContext(bearer(t3))).toBeNull();                                            // a disabled account opens nothing, even a fresh token
    expect(await identity.adminLogin({ email: ADM2, password: 'Admin-Mot-2026x' }, { db })).toMatchObject({ ok: false, status: 401 });   // same answer as a wrong password
    expect(await identity.actOnAdministrator(me, { action: 'enable', email: ADM2, reason: 'Retour dans l’équipe, réactivation.' }, { db, elevated: true })).toMatchObject({ ok: true });
    const back = await identity.adminLogin({ email: ADM2, password: 'Admin-Mot-2026x' }, { db }); expect(back.ok).toBe(true);
    expect(await auth.resolveAuthContext(bearer(back.token))).toMatchObject({ email: ADM2 });
    const ov = await identity.sessionOverview({ db });
    expect(ov.admins.find((a) => a.email === ADM2)).toMatchObject({ disabledAt: null });
    expect(JSON.stringify(ov.admins)).not.toMatch(/password|mfaSecret|scrypt:/);
    const mine = ov.events.filter((e) => e.actor === ADM1 || e.actor === ADM2).map((e) => e.action);
    for (const a of ['ADMIN_LOGOUT', 'ADMIN_DISABLED', 'ADMIN_ENABLED', 'ADMIN_LOGIN_DISABLED', 'ADMIN_LOGIN_SUCCEEDED']) expect(mine, a).toContain(a);
  });

  it('ADM-11: FALC review per field — only the fields read are « relu »; a field edited afterwards is no longer; staff identities never public', async () => {
    expect((await falc.markReviewed('aide', ID.aide, 'a3-reviewer@example.test', 'Relu : le résumé et les conditions.', db, ['summary_falc', 'conditions_falc'])).ok).toBe(true);
    const row = async () => (await db.execute(sql`SELECT * FROM "Aide" WHERE id = ${ID.aide}`)).rows[0];
    let r = vis.falcFieldReview(await row());
    expect(r.summary_falc).toBeTruthy(); expect(r.conditions_falc).toBeTruthy(); expect(r.montant_falc).toBeNull();
    await db.execute(sql`UPDATE "Aide" SET conditions_falc = 'Pour les personnes qui habitent ici depuis trois mois.' WHERE id = ${ID.aide}`);
    r = vis.falcFieldReview(await row());
    expect([Boolean(r.summary_falc), r.conditions_falc, r.montant_falc]).toEqual([true, null, null]);
    const pub = vis.stripReviewFields(await row());
    expect(pub.falc_field_reviews).toBeUndefined(); expect(JSON.stringify(pub)).not.toContain('a3-reviewer@example.test'); expect(pub.falc_field_review.summary_falc).toBeTruthy();
    expect(await falc.markReviewed('aide', ID.aide, 'a3-reviewer@example.test', 'Champ inconnu demandé.', db, ['titre'])).toMatchObject({ ok: false, code: 'UNSUPPORTED_FIELD' });
  });

  it('PUB-6: the database refuses an oversized shared dossier (share/create.js untouched)', async () => {
    const big = { notes: 'x'.repeat(70000) };
    await expect(db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${ID.dos}, NOW() + interval '1 day', ${JSON.stringify(big)}::jsonb, '{}'::jsonb, 0)`)).rejects.toThrow();
    const create = (await import('../../api/_handlers/share/create.js')).default; const r = mk();
    await create({ method: 'POST', url: '/api/share/create', query: {}, headers: { host: 'localhost' }, body: { situation: big, results: { assessment: { items: [] } } } }, r);
    expect(r.statusCode).toBe(500); expect(JSON.stringify(r.body)).not.toContain('xxxxxxxxxx');   // refused; the pinned handler's generic message, never the payload
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE octet_length(situation::text) > 65536`)).rows[0].n).toBe(0);
  });

  it('E05: « serves this commune » lists only the places whose reviewed service area covers it', async () => {
    const { items } = await search.searchStructures({ serves: COMMUNE, q: undefined, page: 1, pageSize: 50, sort: 'quality' });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(ID.sA); expect(ids).not.toContain(ID.sB);
    const none = await search.searchStructures({ serves: '67999', page: 1, pageSize: 50, sort: 'quality' });
    expect(none.items.map((i) => i.id)).not.toContain(ID.sA);
  });

  it('PRO-11: same e-mail in two organizations — the password decides, a shared password asks for the organization, each account gets its own reset link', async () => {
    const login = (await import('../../api/_handlers/pro/auth/login.js')).default;
    const forgot = (await import('../../api/_handlers/pro/auth/forgot-password.js')).default;
    const post = async (h, body) => { const r = mk(); await h({ method: 'POST', url: '/api/pro/auth/x', query: {}, headers: { host: 'localhost' }, body }, r); return r; };
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES
      (${ID.p1}, ${PRO}, ${await userAuth.hashPassword('Premier-Mot-2026')}, 'PRO', 'active', ${ID.o1}, false, NOW()), (${ID.p2}, ${PRO}, ${await userAuth.hashPassword('Second-Mot-2026')}, 'PRO', 'active', ${ID.o2}, false, NOW())`);
    let r = await post(login, { email: PRO, password: 'Second-Mot-2026' });
    expect(r.statusCode).toBe(200); expect(r.body.user.structureId).toBe(ID.o2);                            // the first row used to be taken whatever the password
    // R14: the address is matched whatever its case (a phone keyboard's « A3-Pro-… » was « Invalid credentials »)
    r = await post(login, { email: `  ${PRO.toUpperCase()} `, password: 'Second-Mot-2026' }); expect(r.statusCode).toBe(200); expect(r.body.user.structureId).toBe(ID.o2);
    r = await post(login, { email: PRO, password: 'Premier-Mot-2026' }); expect(r.body.user.structureId).toBe(ID.o1);
    expect((await post(login, { email: PRO, password: 'Faux-Mot-2026x' })).statusCode).toBe(401);
    await db.execute(sql`UPDATE "ProUser" SET password_hash = ${await userAuth.hashPassword('Meme-Mot-2026x')} WHERE id IN (${ID.p1}, ${ID.p2})`);
    r = await post(login, { email: PRO, password: 'Meme-Mot-2026x' });
    expect(r.statusCode).toBe(409); expect(r.body.code).toBe('ORGANIZATION_CHOICE_REQUIRED'); expect(r.body.organizations.map((o) => o.structureId).sort()).toEqual([ID.o1, ID.o2].sort());
    r = await post(login, { email: PRO, password: 'Meme-Mot-2026x', structureId: ID.o2 }); expect(r.statusCode).toBe(200); expect(r.body.user.structureId).toBe(ID.o2);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${ID.p2}`);
    expect((await post(login, { email: PRO, password: 'Faux-Mot-2026x' })).statusCode).toBe(401);           // a wrong password says nothing about the disabled account
    mailer.__clearTestOutbox();
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${ID.p2}`);
    expect((await post(forgot, { email: PRO })).statusCode).toBe(200);
    const mails = mailer.__getTestOutbox().filter((m) => m.to === PRO);
    expect(mails).toHaveLength(2); expect(mails.map((m) => m.subject).join(' | ')).toContain(`Organisation ${ID.o1}`); expect(mails.map((m) => m.subject).join(' | ')).toContain(`Organisation ${ID.o2}`);
  });

  it('N02: with an SMS provider configured, nothing is sent while « STOP » cannot be honoured; the notice says NOT_DELIVERED', async () => {
    const svc = await import('../../api/_services/citizen-account.js'); const notices = await import('../../api/_services/appointment-notices.js'); const policy = await import('../../api/lib/sms-policy.js');
    expect(policy.optOutReady({ SMS_INBOUND_URL: 'https://example.test/x', TWILIO_AUTH_TOKEN: 't' })).toBe(false);   // configured, but not routed
    expect((await svc.setPreference(ID.cit, { channel: 'sms', category: 'reminder', enabled: true, consentGiven: true })).ok).toBe(true);
    const { start } = notices.parisDayWindow(new Date(), 1); const at = new Date(start.getTime() + 11 * 3600000);
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.o1, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", "citizenUserId", mode, "updatedAt")
      VALUES (${ID.rdv}, ${ID.o1}, ${ID.svc}, ${at}, ${new Date(at.getTime() + 1800000)}, 'confirmed', 'Particulier', '0612345678', ${ID.cit}, 'IN_PERSON', NOW())`);
    const sent = []; const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.twilio.com/')) { sent.push(String(url)); return new Response('{"sid":"SMqa"}', { status: 201 }); } return realFetch(url, init); };
    const saved = { sid: process.env.TWILIO_SID, tok: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_PHONE_NUMBER, from2: process.env.TWILIO_FROM };
    Object.assign(process.env, { TWILIO_SID: 'ACqa', TWILIO_AUTH_TOKEN: 'qa', TWILIO_PHONE_NUMBER: '+33600000000', TWILIO_FROM: '+33600000000' });
    try {
      // inside or outside the send window, the result is the same: no provider call, NOT_DELIVERED (the gate, or the window, refuses first)
      const cron = (await import('../../api/_handlers/cron/rdv-reminder.js')).default; const r = mk();
      await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r);
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
      expect(sent).toEqual([]);
      const sms = (await db.execute(sql`SELECT status FROM "AppointmentNotice" WHERE "appointmentId" = ${ID.rdv} AND channel = 'sms'`)).rows.map((x) => x.status);
      expect(sms).toEqual(['NOT_DELIVERED']);
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of [['TWILIO_SID', saved.sid], ['TWILIO_AUTH_TOKEN', saved.tok], ['TWILIO_PHONE_NUMBER', saved.from], ['TWILIO_FROM', saved.from2]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('R2-7: a correct password on an unconfirmed address gets the same answer as an unknown address; no session', async () => {
    const signup = (await import('../../api/_handlers/auth/signup.js')).default; const login = (await import('../../api/_handlers/auth/login.js')).default;
    const post = async (h, body) => { const r = mk(); await h({ method: 'POST', url: '/api/auth/x', query: {}, headers: { host: 'localhost' }, body }, r); return r; };
    const email = `a3-r27-${TS}@example.test`;
    expect((await post(signup, { email, password: 'Nouveau-Mot-2026x' })).statusCode).toBe(200);
    const fresh = await post(login, { email, password: 'Nouveau-Mot-2026x' });
    const unknown = await post(login, { email: `a3-r27-${TS}-nobody@example.test`, password: 'Nouveau-Mot-2026x' });
    expect([fresh.statusCode, unknown.statusCode]).toEqual([401, 401]); expect(fresh.body).toEqual(unknown.body);
    expect(fresh.headers['Set-Cookie']).toBeUndefined();
  });
});
