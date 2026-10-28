/**
 * K0 / C20 on REAL PostgreSQL: SMS reminders are consent-bound and owner-bound.
 *  - POST /api/public/sms-notify was unauthenticated: anyone holding an appointment id could attach any phone number and trigger an SMS naming the professional.
 *    Now: only the appointment's own account session, or the owner secret of a dossier attached to that same account, may (un)subscribe; anything else is a uniform 404.
 *  - subscribing records the consent (NotificationPreference sms.reminder + ConsentLog NOTIF_SMS_REMINDER) BEFORE the number is stored; withdrawing records a second decision.
 *  - the J-1 reminder cron sends an SMS only when canNotify(citizen, 'sms', 'reminder') is true; a number without a consenting account is skipped.
 *  - the passport lists the appointments of the account the dossier is attached to (the former read of a non-existent column always returned nothing).
 * Synthetic data only; skipped without DATABASE_URL; no SMS provider is configured, so nothing leaves the machine.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

// the distributed cron lock lives in Upstash Redis, which has only a dummy URL in every QA environment; the lock itself is covered by tests/unit/cron-concurrency.test.js
vi.mock('../../api/_utils/pipelineLock.js', () => ({ withLock: async (_name, fn) => fn() }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
// PKG-11 / N02 TEST-ONLY OVERLAY (N02_SMS_SEND_WINDOW_OVERLAY_V1.md): SMS are now sent only 08:00-20:00 Paris; the window is pinned OPEN here so this consent
// test does not depend on the hour the suite runs. Titles and assertions unchanged. The window itself: pkg11-n02-sms-policy (unit) and pkg11-n02-sms-stop-db.
// V2 (2026-10-24, owner decision on N02): the SMS channel stays inactive until a reply « STOP » is honoured (optOutReady); this CONSENT test pins that gate open
// too, as it pins the window — the gate itself is proven closed in pkg11-audit3 (unit) and pkg11-audit3-db (a configured provider sends nothing).
vi.mock('../../api/lib/sms-policy.js', async (importOriginal) => ({ ...(await importOriginal()), isSmsSendWindow: () => true, optOutReady: () => true }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `c20-a-${TS}`, email: `c20-a-${TS}@example.test` };
const B = { id: `c20-b-${TS}`, email: `c20-b-${TS}@example.test` };
const ID = { str: `c20-str-${TS}`, svc: `c20-svc-${TS}`, rdv: `c20-rdv-${TS}`, rdvNoAccount: `c20-rdv-na-${TS}`, share: `c20-share-${TS}` };
const OWNER_SECRET = crypto.randomBytes(32).toString('base64url');
const PHONE = '06 12 34 56 78';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('K0 / C20 SMS consent (real DB)', () => {
  let db, userAuth, sms, passport, svc;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (handler, { method = 'POST', body, headers = {}, as, url = '/api/x' } = {}) => {
    const r = mk();
    await handler({ method, url, query: {}, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}), ...headers } }, r);
    return r;
  };
  const phoneOf = async (id) => (await db.execute(sql`SELECT "beneficiaryPhone" p FROM "ProAppointment" WHERE id = ${id}`)).rows[0].p;
  const ledger = async (uid) => (await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${uid} AND purpose = 'NOTIF_SMS_REMINDER' ORDER BY created_at`)).rows.map((r) => r.decision);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    const schema = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    sms = (await import('../../api/_handlers/public/sms-notify.js')).default;
    passport = (await import('../../api/_handlers/public/passport.js')).default;
    svc = await import('../../api/_services/citizen-account.js');
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES (${ID.str}, 'C20', ${'c20-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.str, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    const start = new Date(Date.now() + 3 * 86400000);
    await db.insert(schema.ProAppointment).values({ id: ID.rdv, structureId: ID.str, serviceId: ID.svc, startAt: start, endAt: new Date(start.getTime() + 1800000), status: 'confirmed', beneficiaryName: 'A', citizenUserId: A.id });
    await db.insert(schema.ProAppointment).values({ id: ID.rdvNoAccount, structureId: ID.str, serviceId: ID.svc, startAt: start, endAt: new Date(start.getTime() + 1800000), status: 'confirmed', beneficiaryName: 'N', beneficiaryPhone: '0600000000' });
    const hash = crypto.createHash('sha256').update(OWNER_SECRET, 'utf8').digest('hex');
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${ID.share}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0, ${hash}, ${'t-' + TS}, 'GUEST_SHARE', ${A.id})`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${ID.rdv}, ${ID.rdvNoAccount})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID.str}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${ID.share}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);
  });

  it('anonymous, another account, a wrong owner secret and an appointment without an account are all the same 404; nothing is stored', async () => {
    const body = { appointmentId: ID.rdv, phoneNumber: PHONE, action: 'subscribe' };
    for (const r of [await call(sms, { body }), await call(sms, { body, as: B }), await call(sms, { body: { ...body, shareId: ID.share }, headers: { 'x-share-owner-secret': 'wrong' } }),
      await call(sms, { body: { ...body, appointmentId: ID.rdvNoAccount } }), await call(sms, { body: { ...body, appointmentId: 'does-not-exist' } })]) {
      expect(r.statusCode).toBe(404); expect(r.body).toEqual({ error: 'Rendez-vous introuvable.' });
    }
    expect(await phoneOf(ID.rdv)).toBeNull();
    expect(await ledger(A.id)).toEqual([]);
    expect((await call(sms, { body: { appointmentId: ID.rdvNoAccount, action: 'unsubscribe' } })).statusCode).toBe(404);
    expect(await phoneOf(ID.rdvNoAccount)).toBe('0600000000');   // an anonymous caller can no longer erase someone else's number either
  });

  it('the owner (passport secret) subscribes: consent recorded first, then the number; the passport now lists the account appointments', async () => {
    const r = await call(sms, { body: { appointmentId: ID.rdv, phoneNumber: PHONE, action: 'subscribe', shareId: ID.share }, headers: { 'x-share-owner-secret': OWNER_SECRET } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(await phoneOf(ID.rdv)).toBe('0612345678');
    expect(await ledger(A.id)).toEqual([true]);
    expect(await svc.canNotify(A.id, 'sms', 'reminder')).toBe(true);
    const p = await call(passport, { method: 'GET', url: `/api/public/passport?shareId=${ID.share}`, headers: { 'x-share-owner-secret': OWNER_SECRET } });
    expect(p.statusCode).toBe(200);
    expect(JSON.stringify(p.body)).toContain(ID.rdv);
  });

  it('the account session withdraws: a second ledger decision, the number is forgotten, canNotify is false', async () => {
    const r = await call(sms, { body: { appointmentId: ID.rdv, action: 'unsubscribe' }, as: A });
    expect(r.statusCode).toBe(200);
    expect(await phoneOf(ID.rdv)).toBeNull();
    expect(await ledger(A.id)).toEqual([true, false]);
    expect(await svc.canNotify(A.id, 'sms', 'reminder')).toBe(false);
  });

  it('the J-1 reminder cron texts a beneficiary only with a live consent of the appointment account; a typed number without a consenting account is skipped', async () => {
    const schema = await import('../../src/db/schema.js');
    // « demain » of the Paris calendar, like the reminder (servers run in UTC: between 23:00 and 24:00 UTC the UTC « tomorrow » is the Paris « today »)
    const tomorrow = new Date((await import('../../api/_services/appointment-notices.js')).parisDayWindow(new Date(), 1).start.getTime() + 12 * 3600000);
    const pro = `c20-pro-${TS}`; const r1 = `c20-cron-a-${TS}`; const r2 = `c20-cron-n-${TS}`;
    await db.insert(schema.ProUser).values({ id: pro, email: `${pro}@example.test`, password_hash: 'x', role: 'PRO', status: 'active', structureId: ID.str, notificationEmailEnabled: false });
    const base = { structureId: ID.str, serviceId: ID.svc, startAt: tomorrow, endAt: new Date(tomorrow.getTime() + 1800000), status: 'confirmed', createdByProUserId: pro };
    await db.insert(schema.ProAppointment).values({ id: r1, ...base, beneficiaryName: 'A', citizenUserId: A.id, beneficiaryPhone: '0611111111' });
    await db.insert(schema.ProAppointment).values({ id: r2, ...base, beneficiaryName: 'N', beneficiaryPhone: '0622222222' });
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.twilio.com/')) { sent.push(new URLSearchParams(init.body).get('To')); return new Response('{"sid":"SMqa"}', { status: 201 }); } return realFetch(url, init); };
    const saved = { sid: process.env.TWILIO_SID, tok: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_PHONE_NUMBER, from2: process.env.TWILIO_FROM };
    Object.assign(process.env, { TWILIO_SID: 'ACqa', TWILIO_AUTH_TOKEN: 'qa', TWILIO_PHONE_NUMBER: '+33600000000', TWILIO_FROM: '+33600000000' });
    const cron = (await import('../../api/_handlers/cron/rdv-reminder.js')).default;
    const run = async () => { const r = mk(); await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); return r; };
    const reset = () => db.execute(sql`UPDATE "ProAppointment" SET reminder_sent_at = NULL, reminder_locked_at = NULL WHERE id IN (${r1}, ${r2})`);
    try {
      expect(await svc.canNotify(A.id, 'sms', 'reminder')).toBe(false);   // withdrawn in the previous test
      let res = await run(); expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
      // PKG-11 audit pass 2 TEST-ONLY OVERLAY (STRASBOURG_FULL_PRODUCT_PLAN/AUDIT2_SMS_E164_OVERLAY_V1.md): the provider now receives the number in E.164 (+33…), as Twilio
      // requires; the same two numbers are watched in that form. Title and assertions unchanged otherwise.
      expect(sent.filter((to) => to === '+33611111111' || to === '+33622222222')).toEqual([]);
      await svc.setPreference(A.id, { channel: 'sms', category: 'reminder', enabled: true, consentGiven: true });
      await reset(); res = await run(); expect(res.statusCode).toBe(200);
      expect(sent.filter((to) => to === '+33611111111' || to === '+33622222222')).toEqual(['+33611111111']);   // the consenting account only; never the number without an account
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of [['TWILIO_SID', saved.sid], ['TWILIO_AUTH_TOKEN', saved.tok], ['TWILIO_PHONE_NUMBER', saved.from], ['TWILIO_FROM', saved.from2]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${r1}, ${r2})`);
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "userId" = ${pro}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${pro}`);
      await svc.setPreference(A.id, { channel: 'sms', category: 'reminder', enabled: false });
    }
  });

  it('a self-declared minor cannot subscribe while the age policy is pending (no number stored)', async () => {
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${A.id}, 'moins-de-18', NOW()) ON CONFLICT ("userId") DO UPDATE SET "ageBand" = 'moins-de-18'`);
    try {
      const r = await call(sms, { body: { appointmentId: ID.rdv, phoneNumber: PHONE, action: 'subscribe' }, as: A });
      expect(r.statusCode).toBe(409); expect(r.body.error).toBe('AGE_POLICY_PENDING');
      expect(await phoneOf(ID.rdv)).toBeNull();
    } finally { await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${A.id}`); }
  });
});
