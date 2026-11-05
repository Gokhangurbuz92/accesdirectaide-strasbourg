/**
 * R42-BOOK — account-required appointment booking on a REAL PostgreSQL, at both database levels: 0042 (Production) and 0044 (LAB).
 * Synthetic data only (no real structure, no real person, no real Microsoft endpoint, no real e-mail: MAILER_PROVIDER=test).
 * Run: DBN=ada_r42_booking_0042_test bash $S/r42/booking/int.sh tests/integration/r42-booking-db.test.js   (and DBN=ada_r42_booking_0044_test)
 *
 * Covers: anonymous booking refused on every route (account API, retired guest routes with the switch ON, legacy adapter, opt-ins); public profile
 * without login (no internal configuration leaks); Mode A and Mode B (request → accept / refuse / expire, audit log, never shown as confirmed);
 * professional choice (selectable, no preference routing, absence, previous professional and its privacy: identical refusals, timing parity); the
 * optional message (limits, markup refused, sealed at rest, staff only, never in a notice or a log); minor and undeclared accounts; concurrency;
 * cross-citizen and cross-structure isolation; a DST boundary; the Outlook free/busy mock (busy excluded, stale and expired token = fail safe);
 * neutral e-mail subjects and the real e-mail outcome in the answer.
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { declareAdult } from './helpers/adult-age.mjs';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const MSG = `Besoin d’aide pour un dossier logement ${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const S = (k) => ({ id: `r42b-${k}-${TS}`, slug: `r42b-${k}-slug-${TS}`, svc: `r42b-${k}-svc-${TS}`, name: `Structure fictive R42 ${k}` });
const A = S('a'); const B = S('b'); const T = S('t'); const D = S('d');
const pro = (k, sid, role = 'STRUCTURE_ADMIN', extra = {}) => ({ id: `r42b-p${k}-${TS}`, email: `r42b-p${k}-${TS}@example.test`, sid, role, mfa: true, ...extra });
const ADMIN_A = pro('a', A.id); const ADMIN_B = pro('b', B.id); const ADMIN_T = pro('t', T.id);
const P1 = pro('1', T.id, 'PRO', { name: 'Camille Fictive', job: 'Conseillère' });
const P2 = pro('2', T.id, 'PRO', { name: 'Dominique Fictif', job: 'Travailleur social' });
const P3 = pro('3', T.id, 'PRO', { name: 'Sans MFA', mfa: false });
const PROS = [ADMIN_A, ADMIN_B, ADMIN_T, P1, P2, P3];
const cit = (k, ageBand) => ({ id: `r42b-c${k}-${TS}`, email: `r42b-c${k}-${TS}@example.test`, ageBand });
const C = [cit('0', '25-59'), cit('1', '18-24'), cit('2', '60-et-plus'), cit('3', '25-59')];
const MINOR = cit('m', null); const MINOR_BAND = cit('mb', null); const UNDECLARED = cit('u', null);

describe.skipIf(!hasDatabase)('R42-BOOK account-required booking (real DB)', () => {
  let db, rdv, auth, userAuth, proList, proSettings, proServices, proTimeoff, structures, legacyCreate, mailer, features, calendar, cryptoTok, logger;
  let level = '';
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, who, { method = 'GET', url, body, query = {} }) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsOf = async (s, as, { from = day(2), to = day(8), professional } = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: s.svc, from, to, ...(professional ? { professional } : {}) }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots;
  };
  const book = (s, as, startAt, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: s.svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const rowsOf = async (sid) => (await db.execute(sql`SELECT id, status, notes, "createdByProUserId" AS pro, "citizenUserId" AS cit FROM "ProAppointment" WHERE "structureId" = ${sid}`)).rows;

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}`}, ${s.id}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Accueil social', 30, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    features = await import('../../api/_utils/schema-features.js');
    calendar = await import('../../api/_services/rdv-calendar-busy.js');
    mailer = await import('../../api/_utils/mailer.js');
    logger = (await import('../../api/_utils/logger.js')).default;
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    proServices = (await import('../../api/_handlers/pro/services.js')).default;
    proTimeoff = (await import('../../api/_handlers/pro/timeoff.js')).default;
    structures = (await import('../../api/_handlers/structures.js')).default;
    legacyCreate = (await import('../../api/_handlers/public/appointments/create.js')).default;
    level = (await features.appointmentGuestSchema(db)).guestReminderConsent ? '0044' : '0042';
    for (const s of [A, B, T, D]) await seedStructure(s);
    for (const p of PROS) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', ${p.mfa}, NOW(), NOW())`);
      if (p.name) await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "jobTitle", "updatedAt") VALUES (${'pp-' + p.id}, ${p.id}, ${p.name}, ${p.job || null}, NOW())`);
    }
    for (const c of [...C, MINOR, MINOR_BAND, UNDECLARED]) {
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    }
    // R42-A07 (age-policy.js of R42-AUTH): the adult statement in ConsentLog; a person who stated « under 18 », one whose profile says « moins-de-18 », one with no statement
    for (const c of C) await declareAdult(db, sql, [c.id], { band: c.ageBand });
    await declareAdult(db, sql, [MINOR.id], { adult: false });
    await declareAdult(db, sql, [MINOR_BAND.id], { band: 'moins-de-18' });
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const ids = [A, B, T, D].map((s) => s.id);
    for (const sid of ids) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${sid})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${sid}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${sid}`);
    }
    for (const p of PROS) {
      await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const sid of ids) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${sid}`);
    for (const c of [...C, MINOR, MINOR_BAND, UNDECLARED]) {
      await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
  });

  it('runs on the database level it was started for', () => {
    console.info(`[r42-book] database level ${level}`);
    expect(['0042', '0044']).toContain(level);
  });

  it('anonymous booking is refused on every route, even with ADA_GUEST_BOOKING_ENABLED=true; nothing is written', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
    try {
      const slot = (await slotsOf(A, C[3]))[0];
      for (const [m, p] of [['POST', 'appointments'], ['GET', `structures/${A.slug}/slots`], ['GET', `structures/${A.slug}/services`], ['GET', `structures/${A.slug}/team`], ['GET', 'appointments']]) {
        const r = await call(m, p, { body: { structureSlug: A.slug, serviceId: A.svc, startAt: slot.startAt, idempotencyKey: 'anon' }, query: { serviceId: A.svc } });
        expect(r.statusCode, `${m} ${p} ${show(r)}`).toBe(401);
      }
      const guestRoutes = [['GET', `guest/structures/${A.slug}/services`], ['GET', `guest/structures/${A.slug}/slots`], ['POST', 'guest/hold'], ['POST', 'guest/confirm'], ['POST', 'guest/manage'],
        ['POST', 'guest/manage/cancel'], ['POST', 'guest/manage/reschedule'], ['POST', 'guest/manage/reminder'], ['DELETE', 'guest/anything']];
      for (const [m, p] of guestRoutes) {
        const r = await call(m, p, { body: { structureSlug: A.slug, serviceId: A.svc, startAt: slot.startAt, idempotencyKey: 'g', name: 'A B', email: 'anon@example.test', consent: true } });
        expect([r.statusCode, r.body.code], `${m} ${p}`).toEqual([410, 'ACCOUNT_REQUIRED']);
      }
      // a signed-in person gets the same 410 on the retired routes (they are not a back door either)
      const signed = await call('POST', 'guest/hold', { as: C[3], body: {} });
      expect(signed.statusCode).toBe(410);
      const legacy = mk(); await legacyCreate({ method: 'POST', url: '/api/public/appointments/create', body: { structureId: A.id, startAt: slot.startAt, email: 'x@example.test' }, headers: {} }, legacy);
      expect([legacy.statusCode, legacy.body.code]).toEqual([410, 'ACCOUNT_REQUIRED']);
      const optIn = await invoke(proSettings, ADMIN_A, { method: 'PUT', url: '/api/pro/rdv-settings', body: { allowGuestBooking: true } });
      expect([optIn.statusCode, optIn.body.code], show(optIn)).toEqual([409, 'GUEST_BOOKING_RETIRED']);
      const svcOptIn = await invoke(proServices, ADMIN_A, { method: 'PATCH', url: `/api/pro/services?id=${A.svc}`, query: { id: A.svc }, body: { guestBookable: true } });
      expect([svcOptIn.statusCode, svcOptIn.body.code], show(svcOptIn)).toEqual([409, 'GUEST_BOOKING_RETIRED']);
      expect(await rowsOf(A.id)).toEqual([]);
    } finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); }
  });

  it('discovery stays open: the public booking profile and the structure page work without login and leak no internal configuration', async () => {
    const p = await call('GET', `structures/${A.slug}/profile`);
    expect(p.statusCode, show(p)).toBe(200);
    expect(p.body.accountRequired).toBe(true);
    expect(p.body.services.map((s) => s.id)).toEqual([A.svc]);
    expect(p.body.nextAvailableDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const page = mk(); await structures({ method: 'GET', url: `/api/structures?slug=${A.slug}`, query: { slug: A.slug }, headers: { host: 'x' } }, page);
    expect(page.statusCode, show(page)).toBe(200);
    expect(page.body.rdv.accountRequired).toBe(true);
    expect(page.body).not.toHaveProperty('settings_json');
    expect(page.body.rdv).not.toHaveProperty('allowGuestBooking');
  });

  it('age rule: a minor account and an account without a declared age band cannot book (server-side)', async () => {
    const slot = (await slotsOf(A, C[3]))[0];
    const minor = await book(A, MINOR, slot.startAt);
    expect([minor.statusCode, minor.body.code]).toEqual([403, 'ADULT_ACCOUNT_REQUIRED']);
    const band = await book(A, MINOR_BAND, slot.startAt);
    expect([band.statusCode, band.body.code]).toEqual([403, 'ADULT_ACCOUNT_REQUIRED']);
    const none = await book(A, UNDECLARED, slot.startAt);
    expect([none.statusCode, none.body.code]).toEqual([409, 'AGE_DECLARATION_REQUIRED']);
    // the person states it (R42-AUTH endpoint, the step the booking page shows), then the same request goes through
    const { default: ageDecl } = await import('../../api/_handlers/citizen/age-declaration.js');
    const d = mk(); await ageDecl({ method: 'POST', url: '/api/citizen/age-declaration', query: {}, body: { adult: true }, headers: { host: 'localhost:3000', cookie: cookie(UNDECLARED) } }, d);
    expect([d.statusCode, d.body.adult], show(d)).toEqual([200, true]);
    const after = await book(A, UNDECLARED, (await slotsOf(A, UNDECLARED))[4].startAt);
    expect(after.statusCode, show(after)).toBe(201);
  });

  it('the optional message: bounded, plain text only, sealed at rest, shown to the structure only, never in a notice or a log line', async () => {
    const slot = (await slotsOf(A, C[0]))[1];
    const long = await book(A, C[0], slot.startAt, { message: 'x'.repeat(501) });
    expect([long.statusCode, long.body.code]).toEqual([400, 'MESSAGE_TOO_LONG']);
    for (const bad of ['<b>urgent</b>', 'voir <script>alert(1)</script>', 'a &lt; b', '<!-- x -->']) {
      const r = await book(A, C[0], slot.startAt, { message: bad });
      expect([r.statusCode, r.body.code], bad).toEqual([400, 'MESSAGE_MARKUP_REFUSED']);
    }
    const spies = ['info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(logger, k));
    const consoleSpies = ['log', 'info', 'warn', 'error'].map((k) => vi.spyOn(console, k));
    mailer.__clearTestOutbox();
    // R43 (dossier RGPD E6): a message travels only with the explicit consent — without it, refused (400) and nothing stored
    const noConsent = await book(A, C[0], slot.startAt, { message: `  ${MSG}  ` });
    expect([noConsent.statusCode, noConsent.body.code]).toEqual([400, 'MESSAGE_CONSENT_REQUIRED']);
    const ok = await book(A, C[0], slot.startAt, { message: `  ${MSG}  `, messageConsent: true });
    expect(ok.statusCode, show(ok)).toBe(201);
    expect(ok.body.state).toBe('CONFIRMED');
    expect(JSON.stringify(ok.body)).not.toContain(MSG);
    const [row] = (await db.execute(sql`SELECT notes FROM "ProAppointment" WHERE id = ${ok.body.id}`)).rows;
    expect(row.notes).toMatch(/^v1:/);
    expect(row.notes).not.toContain('logement');
    const agenda = await invoke(proList, ADMIN_A, { url: `/api/pro/appointments?id=${ok.body.id}`, query: { id: ok.body.id } });
    expect(agenda.body.items[0].citizenMessage).toBe(MSG);
    const overwrite = await invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${ok.body.id}`, query: { id: ok.body.id }, body: { status: 'cancelled', notes: 'autre' } });
    expect(overwrite.body.code).toBe('CITIZEN_MESSAGE_READ_ONLY');
    const outbox = mailer.__getTestOutbox();
    expect(outbox.length).toBeGreaterThan(0);
    for (const m of outbox) { expect(m.subject).not.toContain(MSG); expect(m.text).not.toContain(MSG); }
    for (const spy of [...spies, ...consoleSpies]) for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain('dossier logement');
    spies.concat(consoleSpies).forEach((s) => s.mockRestore());
    const profile = await call('GET', `structures/${A.slug}/profile`);
    expect(JSON.stringify(profile.body)).not.toContain(MSG);
    const own = await call('GET', `appointments/${ok.body.id}`, { as: C[0] });
    expect(JSON.stringify(own.body)).not.toContain(MSG);
  });

  it('Mode A: confirmed at once, neutral e-mail subject, the answer states the real e-mail outcome', async () => {
    const slot = (await slotsOf(A, C[1]))[2];
    mailer.__clearTestOutbox();
    const r = await book(A, C[1], slot.startAt);
    expect(r.statusCode, show(r)).toBe(201);
    expect([r.body.state, r.body.awaitingApproval, r.body.notification.email]).toEqual(['CONFIRMED', false, 'TEST_RECORDED']);
    expect(r.body.calendar).not.toBeNull();
    const mails = mailer.__getTestOutbox().filter((m) => m.to === C[1].email);
    expect(mails.length).toBe(1);
    expect(mails[0].subject).not.toContain(A.name);
    expect(mails[0].subject).not.toContain('Accueil social');
    // R45 / ENG-LR-3: the service's sensitivity is not verified (default resolver → unknown) → the MINIMAL e-mail: neutral subject, no structure,
    // service, date or slug anywhere, no calendar file, a link to the generic account page only (the details stay in the account: r.body.calendar)
    const privacy = await import('../../api/lib/notification-privacy.js');
    expect(mails[0].subject).toBe(privacy.minimalTexts('fr').subject);
    expect(mails[0].category).toBe(privacy.MINIMAL_CATEGORY);
    expect(mails[0].attachments || []).toEqual([]);
    for (const part of [mails[0].subject, mails[0].text, mails[0].html]) {
      expect(part).not.toContain(A.name); expect(part).not.toContain(A.slug); expect(part).not.toContain(r.body.id); expect(part).not.toContain('Accueil social');
    }
    expect([...mails[0].text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0])).toEqual([new URL('/compte', mails[0].text.match(/https?:\/\/[^/\s]+/)[0]).toString()]);
    const c = await call('POST', `appointments/${r.body.id}/cancel`, { as: C[1], body: {} });
    expect([c.statusCode, c.body.state], show(c)).toEqual([200, 'CANCELLED']);
    expect(['TEST_RECORDED', 'NOT_SENT', 'NO_PROVIDER', 'ACCEPTED_BY_PROVIDER']).toContain(c.body.notification.email);
    expect(mailer.__getTestOutbox().filter((m) => m.to === C[1].email).every((m) => !m.subject.includes(A.name))).toBe(true);
  });

  it('the e-mail outcome is never claimed when no provider is configured', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    try {
      const slot = (await slotsOf(A, C[2]))[3];
      const r = await book(A, C[2], slot.startAt);
      expect(r.statusCode, show(r)).toBe(201);
      expect(r.body.notification.email).toBe('NO_PROVIDER');
    } finally { vi.stubEnv('MAILER_PROVIDER', 'test'); }
  });

  it('Mode B: a request holds the slot, is never shown as confirmed, and the structure accepts / refuses it (journaled); a late one expires', async () => {
    const cfg = await invoke(proSettings, ADMIN_A, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' } });
    expect([cfg.statusCode, cfg.body.booking.confirmation], show(cfg)).toEqual([200, 'APPROVAL']);
    const slots = await slotsOf(A, C[0]);
    const r = await book(A, C[0], slots[5].startAt);
    expect(r.statusCode, show(r)).toBe(201);
    expect([r.body.state, r.body.awaitingApproval, r.body.calendar]).toEqual(['REQUESTED', true, null]);
    const notified = (await db.execute(sql`SELECT type FROM "ProNotification" WHERE "structureId" = ${A.id} AND type = 'rdv_request_received'`)).rows;
    expect(notified.length).toBeGreaterThan(0);   // the structure is asked to decide (in-app)
    expect((await slotsOf(A, C[1])).map((s) => s.startAt)).not.toContain(slots[5].startAt);
    const mine = await call('GET', 'appointments', { as: C[0] });
    expect(mine.body.appointments.find((a) => a.id === r.body.id).state).toBe('REQUESTED');
    // another structure's professional: the same 404 as an unknown id
    const foreign = await invoke(proList, ADMIN_B, { method: 'PATCH', url: `/api/pro/appointments?id=${r.body.id}`, query: { id: r.body.id }, body: { decision: 'ACCEPT' } });
    expect(foreign.statusCode).toBe(404);
    const acc = await invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${r.body.id}`, query: { id: r.body.id }, body: { decision: 'ACCEPT' } });
    expect([acc.statusCode, acc.body.status], show(acc)).toEqual([200, 'confirmed']);
    const again = await invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${r.body.id}`, query: { id: r.body.id }, body: { decision: 'REFUSE' } });
    expect(again.body.code).toBe('REQUEST_NOT_PENDING');
    expect((await call('GET', `appointments/${r.body.id}`, { as: C[0] })).body.state).toBe('CONFIRMED');
    const r2 = await book(A, C[1], slots[6].startAt);
    expect(r2.body.state).toBe('REQUESTED');
    const ref = await invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${r2.body.id}`, query: { id: r2.body.id }, body: { decision: 'REFUSE', reasonCode: 'NO_CAPACITY' } });
    expect([ref.statusCode, ref.body.status], show(ref)).toEqual([200, 'refused']);
    expect((await call('GET', `appointments/${r2.body.id}`, { as: C[1] })).body.state).toBe('REFUSED');
    expect((await slotsOf(A, C[1])).map((s) => s.startAt)).toContain(slots[6].startAt);   // a refused request frees its slot
    const cancelRefused = await call('POST', `appointments/${r2.body.id}/cancel`, { as: C[1], body: {} });
    expect(cancelRefused.body.code).toBe('APPOINTMENT_NOT_ACTIVE');
    const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE actor_id = ${ADMIN_A.id} AND action LIKE 'RDV_REQUEST_%'`)).rows.map((x) => x.action).sort();
    expect(audit).toEqual(['RDV_REQUEST_ACCEPTED', 'RDV_REQUEST_REFUSED']);
    // a request whose start passed unanswered: EXPIRED for the person, refused as expired for the structure
    const past = `r42b-past-${TS}`;
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", "updatedAt")
      VALUES (${past}, ${A.id}, ${A.svc}, NOW() - interval '2 hours', NOW() - interval '90 minutes', 'requested', 'Particulier', ${C[2].id}, ${'past-' + TS}, NOW())`);
    expect((await call('GET', `appointments/${past}`, { as: C[2] })).body.state).toBe('EXPIRED');
    const late = await invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${past}`, query: { id: past }, body: { decision: 'ACCEPT' } });
    expect(late.body.code).toBe('REQUEST_EXPIRED');
    expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${past}`)).rows[0].status).toBe('expired');
    // Mode B reschedule: the moved appointment goes back to the structure (REQUESTED)
    const mv = await call('POST', `appointments/${r.body.id}/reschedule`, { as: C[0], body: { startAt: (await slotsOf(A, C[0], { from: day(3), to: day(8) }))[0].startAt } });
    expect([mv.statusCode, mv.body.state, mv.body.rescheduled], show(mv)).toEqual([200, 'REQUESTED', true]);
    await invoke(proSettings, ADMIN_A, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'DIRECT' } });
  });

  it('cross-citizen and cross-structure isolation', async () => {
    const slot = (await slotsOf(A, C[2]))[7];
    const r = await book(A, C[2], slot.startAt);
    expect(r.statusCode, show(r)).toBe(201);
    for (const [m, p, b] of [['GET', `appointments/${r.body.id}`], ['POST', `appointments/${r.body.id}/cancel`, {}], ['POST', `appointments/${r.body.id}/reschedule`, { startAt: slot.startAt }]]) {
      const x = await call(m, p, { as: C[3], body: b });
      expect([x.statusCode, x.body.error], `${m} ${p}`).toEqual([404, 'Appointment not found']);
    }
    expect((await call('GET', 'appointments', { as: C[3] })).body.appointments.map((a) => a.id)).not.toContain(r.body.id);
    const other = await invoke(proList, ADMIN_B, { url: `/api/pro/appointments?id=${r.body.id}`, query: { id: r.body.id } });
    expect(other.body.items).toEqual([]);
    // a service of another structure cannot be booked through this one
    const wrong = await call('POST', 'appointments', { as: C[3], body: { structureSlug: A.slug, serviceId: B.svc, startAt: slot.startAt, idempotencyKey: `w-${TS}` } });
    expect(wrong.statusCode).toBe(404);
  });

  it('concurrency: two people on the same slot at the same time — exactly one wins', async () => {
    const slot = (await slotsOf(B, C[0]))[0];
    const [x, y] = await Promise.all([book(B, C[0], slot.startAt), book(B, C[1], slot.startAt)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    expect((await rowsOf(B.id)).filter((a) => a.status === 'confirmed').length).toBe(1);
  });

  describe('team choice', () => {
    let slots = [];
    let handleP1 = '';
    beforeAll(async () => {
      const r = await invoke(proSettings, ADMIN_T, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { team: { enabled: true, members: {
        [P1.id]: { bookable: true, selectable: true }, [P2.id]: { bookable: true, selectable: false }, [P3.id]: { bookable: true, selectable: true } } } } });
      expect(r.statusCode, show(r)).toBe(200);
    });

    it('lists only verified, publicly selectable members — display name and role, never an account id or an e-mail', async () => {
      const t = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[0] });
      expect(t.statusCode, show(t)).toBe(200);
      expect(t.body.professionals.map((p) => p.displayName)).toEqual(['Camille Fictive']);   // P2 not selectable, P3 without MFA
      handleP1 = t.body.professionals[0].id;
      expect(handleP1).toMatch(/^p_[A-Za-z0-9_-]{22}$/);
      const text = JSON.stringify(t.body);
      for (const p of [P1, P2, P3]) { expect(text).not.toContain(p.id); expect(text).not.toContain(p.email); }
      expect(text).not.toContain('Dominique');
      const anon = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc } });
      expect(anon.statusCode).toBe(401);
      const other = await call('GET', `structures/${A.slug}/team`, { query: { serviceId: T.svc }, as: C[0] });
      expect(other.statusCode).toBe(404);   // strict structure isolation
    });

    it('a chosen professional, then no-preference routing to the other free one, then the slot is full', async () => {
      slots = await slotsOf(T, C[0], { professional: handleP1 });
      const s = slots[0];
      const a = await book(T, C[0], s.startAt, { professional: handleP1 });
      expect(a.statusCode, show(a)).toBe(201);
      const b = await book(T, C[1], s.startAt, { professional: 'ANY' });
      expect(b.statusCode, show(b)).toBe(201);
      const c = await book(T, C[2], s.startAt, { professional: 'ANY' });
      expect(c.statusCode, show(c)).toBe(409);
      const byId = Object.fromEntries((await rowsOf(T.id)).map((r) => [r.id, r.pro]));
      expect([byId[a.body.id], byId[b.body.id]]).toEqual([P1.id, P2.id]);
      expect((await slotsOf(T, C[3], { professional: 'ANY' })).map((x) => x.startAt)).not.toContain(s.startAt);
    });

    it('a member\'s absence removes their slots only; no preference still finds the other one', async () => {
      const s = slots[3];
      const off = await invoke(proTimeoff, ADMIN_T, { method: 'POST', url: '/api/pro/timeoff', body: { startAt: s.startAt, endAt: s.endAt, scope: 'member', proUserId: P1.id, reason: 'R42' } });
      expect(off.statusCode, show(off)).toBe(201);
      expect((await slotsOf(T, C[3], { professional: handleP1 })).map((x) => x.startAt)).not.toContain(s.startAt);
      expect((await slotsOf(T, C[3], { professional: 'ANY' })).map((x) => x.startAt)).toContain(s.startAt);
      const r = await book(T, C[3], s.startAt, { professional: handleP1 });
      expect(r.statusCode).toBe(409);
    });

    it('previous professional: offered only to the person who really had one, and nobody else can learn it (same refusal, comparable time)', async () => {
      const past = `r42b-prev-${TS}`;
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "createdByProUserId", "idempotencyKey", "updatedAt")
        VALUES (${past}, ${T.id}, ${T.svc}, NOW() - interval '20 days', NOW() - interval '20 days' + interval '30 minutes', 'done', 'Particulier', ${C[3].id}, ${P2.id}, ${'prev-' + TS}, NOW())`);
      const mine = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[3] });
      expect(mine.body.previous).toEqual({ available: true, displayName: null });   // P2 is not publicly selectable: no name
      const theirs = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[2] });
      expect(theirs.body.previous).toEqual({ available: false, displayName: null });
      const s = slots[6];
      const tries = [['PREVIOUS', C[2]], ['p_unknownunknownunknown0', C[2]], [handleP1.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), C[2]], [P2.id, C[2]]];
      const bodies = [];
      for (const [choice, who] of tries) {
        const r = await book(T, who, s.startAt, { professional: choice });
        bodies.push([r.statusCode, r.body]);
        const q = await call('GET', `structures/${T.slug}/slots`, { query: { serviceId: T.svc, from: day(2), to: day(8), professional: choice }, as: who });
        bodies.push([q.statusCode, q.body]);
      }
      for (const b of bodies) expect(b).toEqual(bodies[0]);
      expect(bodies[0][0]).toBe(409);
      expect(bodies[0][1].code).toBe('PROFESSIONAL_UNAVAILABLE');
      // timing: refusing « PREVIOUS » for a person without one costs the same queries as an unknown handle
      const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const time = async (choice) => { const out = []; for (let i = 0; i < 12; i += 1) { const t0 = performance.now(); await call('GET', `structures/${T.slug}/slots`, { query: { serviceId: T.svc, from: day(2), to: day(3), professional: choice }, as: C[2] }); out.push(performance.now() - t0); } return median(out); };
      const [tPrev, tUnknown] = [await time('PREVIOUS'), await time('p_unknownunknownunknown0')];
      expect(Math.abs(tPrev - tUnknown)).toBeLessThan(Math.max(15, 0.5 * Math.max(tPrev, tUnknown)));
      const ok = await book(T, C[3], s.startAt, { professional: 'PREVIOUS' });
      expect(ok.statusCode, show(ok)).toBe(201);
      expect((await rowsOf(T.id)).find((r) => r.id === ok.body.id).pro).toBe(P2.id);
    });

    it('Outlook free/busy (mock): busy excluded; stale answer and expired token = none of that professional\'s slots (fail safe); no real endpoint', async () => {
      vi.stubEnv('OUTLOOK_ENABLED', 'true'); vi.stubEnv('OUTLOOK_CLIENT_ID', 'lab-client'); vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'lab-secret-value');
      vi.stubEnv('OUTLOOK_REDIRECT_URI', 'https://lab.invalid/api/auth/callback/outlook'); vi.stubEnv('ADA_VAULT_KEY', 'k'.repeat(40));
      vi.stubEnv('OUTLOOK_GRAPH_BASE_URL', 'https://graph.lab.invalid/v1.0'); vi.stubEnv('OUTLOOK_AUTHORITY_URL', 'https://login.lab.invalid/tenant/oauth2/v2.0');
      cryptoTok = await import('../../api/_utils/outlook-token-crypto.js');
      const realFetch = globalThis.fetch;
      const seen = [];
      let mode = 'busy';
      const target = slots[9];
      globalThis.fetch = async (url, init) => {
        const u = new URL(String(url)); seen.push({ host: u.host, body: String(init?.body || '') });
        if (!u.host.endsWith('.invalid')) throw new Error(`real endpoint called: ${u.host}`);
        if (u.pathname.endsWith('/token')) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        const req = JSON.parse(String(init.body));
        const from = new Date(`${req.startTime.dateTime}Z`); const to = new Date(`${req.endTime.dateTime}Z`);
        const n = Math.round((to - from) / 900000);
        let view = '';
        for (let i = 0; i < n; i += 1) { const t = from.getTime() + i * 900000; view += t >= new Date(target.startAt).getTime() && t < new Date(target.endAt).getTime() ? '2' : '0'; }
        if (mode === 'stale') view = view.slice(0, Math.max(0, n - 3));
        return new Response(JSON.stringify({ value: [{ scheduleId: 'x', availabilityView: view }] }), { status: 200 });
      };
      const token = async (expiresAt) => {
        await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${P1.id}`);
        const at = cryptoTok.encryptToken('AT-lab'); const rt = cryptoTok.encryptToken('RT-lab');
        await db.execute(sql`INSERT INTO "ProOutlookToken" (id, "userId", email, "accessTokenEnc", "refreshTokenEnc", iv, "expiresAt", scope, "updatedAt") VALUES (${'ot-' + TS}, ${P1.id}, ${P1.email}, ${at}, ${rt}, ${at.split(':')[0]}, ${expiresAt}, 'Calendars.ReadBasic', NOW())`);
        calendar.clearCalendarCache();
      };
      try {
        await token(new Date(Date.now() + 3600_000));
        const p1 = (await slotsOf(T, C[1], { professional: handleP1 })).map((x) => x.startAt);
        expect(p1).not.toContain(target.startAt);   // busy in Outlook
        expect(p1).toContain(slots[10].startAt);
        expect((await slotsOf(T, C[1], { professional: 'ANY' })).map((x) => x.startAt)).toContain(target.startAt);   // P2 is free
        const r = await book(T, C[1], target.startAt, { professional: handleP1 });
        expect(r.statusCode, show(r)).toBe(409);
        mode = 'stale'; calendar.clearCalendarCache();
        expect(await slotsOf(T, C[1], { professional: handleP1 })).toEqual([]);
        mode = 'busy'; await token(new Date(Date.now() - 60_000));   // expired, and the refresh is refused
        expect(await slotsOf(T, C[1], { professional: handleP1 })).toEqual([]);
        const refused = await book(T, C[1], slots[10].startAt, { professional: handleP1 });
        expect(refused.statusCode).toBe(409);
        expect(seen.length).toBeGreaterThan(0);
        for (const s of seen.filter((x) => x.host.startsWith('graph'))) {
          expect(s.body).not.toMatch(/subject|attendee|location/i);
          expect(JSON.parse(s.body).startTime.timeZone).toBe('UTC');
        }
      } finally {
        globalThis.fetch = realFetch; calendar.clearCalendarCache();
        await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${P1.id}`);
        vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test');
      }
    });
  });

  it('DST: opening hours follow Europe/Paris across the spring change (09:00 is 08:00Z before, 07:00Z after) and a slot after it books', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-03-24T10:00:00Z') });
    try {
      const r = await call('GET', `structures/${D.slug}/slots`, { query: { serviceId: D.svc, from: '2027-03-27', to: '2027-03-29' }, as: C[0] });
      expect(r.statusCode, show(r)).toBe(200);
      const starts = r.body.slots.map((s) => s.startAt);
      expect(starts).toContain('2027-03-27T08:00:00.000Z');
      expect(starts).toContain('2027-03-29T07:00:00.000Z');
      expect(starts).not.toContain('2027-03-29T08:30:00.000Z'.replace('08:30', '10:00'));   // 12:00 Paris after the change is 10:00Z: the window ends there
      const b = await book(D, C[0], '2027-03-29T07:00:00.000Z');
      expect([b.statusCode, b.body.startsAt], show(b)).toEqual([201, '2027-03-29T07:00:00.000Z']);
    } finally { vi.useRealTimers(); }
  });
});
