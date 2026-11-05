/**
 * R43-BOOK — booking lifecycle, notice ledger (migration 0045) and security, on a REAL PostgreSQL at four database levels:
 *   0042 (Production), 0042 + 0045 (Production after the R43 procedure), 0044 (LAB), 0044 + 0045 (LAB, plain migrate).
 * Synthetic data only; MAILER_PROVIDER=test (nothing sent). Run: DBN=<db> bash $S/r43/booking/int.sh tests/integration/r43-booking-lifecycle-db.test.js
 *
 * Covers: every AppointmentNotice kind — recorded where the database's CHECK accepts it, skipped and counted (never mis-labelled) where it does not, the
 * booking itself unaffected; the four booking kinds through the real flows (Mode A, Mode B request / accept / refuse); an unanswered request past its start
 * written `expired` (person and structure); the explicit consent of the optional message (refused without it, ConsentLog row, withdrawal before the
 * appointment and after its start (R45), staff no longer see it); a decision on a request the person moved meanwhile (409); concurrency of two decisions and of two Mode B requests;
 * Europe/Paris autumn DST (2027-10-31) and the Paris-day lock key at both changes; a publicly registered citizen never obtains a professional, structure or
 * administrator role through sign-up, booking or the age statement.
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
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const S = (k) => ({ id: `r43b-${k}-${TS}`, slug: `r43b-${k}-slug-${TS}`, svc: `r43b-${k}-svc-${TS}`, name: `Structure fictive R43 ${k}` });
const A = S('a'); const B = S('b'); const D = S('d');
const pro = (k, sid) => ({ id: `r43b-p${k}-${TS}`, email: `r43b-p${k}-${TS}@example.test`, sid, role: 'STRUCTURE_ADMIN' });
const ADMIN_A = pro('a', A.id); const ADMIN_B = pro('b', B.id); const ADMIN_D = pro('d', D.id);
const cit = (k) => ({ id: `r43b-c${k}-${TS}`, email: `r43b-c${k}-${TS}@example.test` });
const C = [cit('0'), cit('1'), cit('2'), cit('3')];
const BASE_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED'];
const GUEST_KINDS = ['BOOKED_BY_GUEST', 'GUEST_CODE'];
const NEW_KINDS = ['BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED'];
const SIGNUP_EMAIL = `r43b-signup-${TS}@example.test`;

describe.skipIf(!hasDatabase)('R43-BOOK lifecycle, notice ledger and security (real DB)', () => {
  let db, rdv, auth, userAuth, proList, proSettings, notices, features, requests, signup, me;
  let level = { guest: false, ledger0045: false };
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, who, { method = 'GET', url, body, query = {}, headers } = {}) => {
    const r = mk(); await handler({ method, url, query, body, headers: headers || { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsOf = async (s, as, { from = day(2), to = day(8) } = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: s.svc, from, to }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots;
  };
  const book = (s, as, startAt, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: s.svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const ledger = async (id) => (await db.execute(sql`SELECT kind, recipient, channel, status FROM "AppointmentNotice" WHERE "appointmentId" = ${id} ORDER BY kind, recipient, channel`)).rows;
  const decide = (who, id, body) => invoke(proList, who, { method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body });

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
    notices = await import('../../api/_services/appointment-notices.js');
    requests = await import('../../api/_services/rdv-requests.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    signup = (await import('../../api/_handlers/auth/signup.js')).default;
    me = (await import('../../api/_handlers/auth/me.js')).default;
    level.guest = (await features.appointmentGuestSchema(db)).guestBooking;
    level.ledger0045 = Boolean((await features.noticeLedgerKinds(db))?.has('REQUEST_RECEIVED'));
    for (const s of [A, B, D]) await seedStructure(s);
    for (const p of [ADMIN_A, ADMIN_B, ADMIN_D]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, B, D]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${s.id}`);
    }
    for (const p of [ADMIN_A, ADMIN_B, ADMIN_D]) {
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const s of [A, B, D]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM "CitizenUser" WHERE email = ${SIGNUP_EMAIL})`).catch(() => {});
    for (const c of C) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email = ${SIGNUP_EMAIL}`).catch(() => {});
  });

  it('runs on the database level it was started for', () => {
    console.info(`[r43-book] level: guest columns ${level.guest}, ledger 0045 ${level.ledger0045}`);
    expect(typeof level.ledger0045).toBe('boolean');
  });

  it('ledger: every notice kind is recorded where the CHECK accepts it, skipped and counted where it does not — never under another kind', async () => {
    const slot = (await slotsOf(B, C[0]))[0];
    const r = await book(B, C[0], slot.startAt);
    expect(r.statusCode, show(r)).toBe(201);
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" = ${r.body.id}`);
    const before = notices.ledgerSkipCounts();
    for (const kind of [...BASE_KINDS, ...GUEST_KINDS, ...NEW_KINDS, 'REQUEST_EXPIRED']) await notices.recordNotice(r.body.id, kind, 'structure', 'in_app', 'DELIVERED', db);
    const kinds = (await ledger(r.body.id)).map((x) => x.kind).sort();
    const expected = [...BASE_KINDS, ...(level.guest ? GUEST_KINDS : []), ...(level.ledger0045 ? NEW_KINDS : [])].sort();
    expect(kinds).toEqual(expected);
    const after = notices.ledgerSkipCounts();
    const delta = (k) => (after[k] || 0) - (before[k] || 0);
    for (const k of NEW_KINDS) expect(delta(`${k}:MIGRATION_0045_NOT_APPLIED`), k).toBe(level.ledger0045 ? 0 : 1);
    expect(delta('REQUEST_EXPIRED:UNKNOWN_KIND')).toBe(1);
  });

  it('the four booking kinds through the real flows: Mode A, Mode B request, accept, refuse — the booking never depends on the ledger', async () => {
    const slots = await slotsOf(A, C[0]);
    const a = await book(A, C[0], slots[0].startAt);
    expect([a.statusCode, a.body.state], show(a)).toEqual([201, 'CONFIRMED']);
    const la = await ledger(a.body.id);
    if (level.ledger0045) {
      expect(la).toEqual(expect.arrayContaining([{ kind: 'BOOKED_BY_CITIZEN', recipient: 'citizen', channel: 'email', status: 'TEST_RECORDED' },
        expect.objectContaining({ kind: 'BOOKED_BY_CITIZEN', recipient: 'structure', channel: 'in_app' })]));
    } else expect(la.filter((x) => x.kind === 'BOOKED_BY_CITIZEN')).toEqual([]);
    const cfg = await invoke(proSettings, ADMIN_A, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' } });
    expect(cfg.statusCode, show(cfg)).toBe(200);
    try {
      const q1 = await book(A, C[1], slots[1].startAt); const q2 = await book(A, C[2], slots[2].startAt);
      expect([q1.body.state, q2.body.state]).toEqual(['REQUESTED', 'REQUESTED']);
      expect((await decide(ADMIN_A, q1.body.id, { decision: 'ACCEPT', expectedStartAt: slots[1].startAt })).statusCode).toBe(200);
      expect((await decide(ADMIN_A, q2.body.id, { decision: 'REFUSE', reasonCode: 'NOT_SUITABLE' })).statusCode).toBe(200);
      const k1 = (await ledger(q1.body.id)).map((x) => `${x.kind}/${x.recipient}/${x.channel}`);
      const k2 = (await ledger(q2.body.id)).map((x) => `${x.kind}/${x.recipient}/${x.channel}`);
      if (level.ledger0045) {
        expect(k1).toEqual(expect.arrayContaining(['REQUEST_RECEIVED/citizen/email', 'REQUEST_RECEIVED/structure/in_app', 'REQUEST_ACCEPTED/citizen/email']));
        expect(k2).toEqual(expect.arrayContaining(['REQUEST_RECEIVED/citizen/email', 'REQUEST_REFUSED/citizen/email']));
      } else {
        expect([...k1, ...k2]).toEqual([]);
      }
      // nothing recorded under a wrong kind
      expect([...k1, ...k2].every((x) => NEW_KINDS.includes(x.split('/')[0]))).toBe(true);
    } finally {
      await invoke(proSettings, ADMIN_A, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'DIRECT' } });
    }
  });

  it('an unanswered request past its start is written `expired` when the person or the structure next looks; a future one and a non-account row are left alone', async () => {
    const past = `r43b-past-${TS}`; const pastB = `r43b-pastb-${TS}`; const future = `r43b-future-${TS}`; const anon = `r43b-anon-${TS}`;
    const ins = (id, cit, offset) => db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", "updatedAt")
      VALUES (${id}, ${A.id}, ${A.svc}, NOW() + (${offset} || ' hours')::interval, NOW() + (${offset} || ' hours')::interval + interval '30 minutes', 'requested', 'Particulier', ${cit}, ${'idem-' + id}, NOW())`);
    await ins(past, C[3].id, '-3'); await ins(pastB, C[2].id, '-2'); await ins(future, C[3].id, '50'); await ins(anon, null, '-4');
    const status = async (id) => (await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${id}`)).rows[0].status;
    const mine = await call('GET', 'appointments', { as: C[3] });
    expect(mine.statusCode).toBe(200);
    expect(mine.body.appointments.find((x) => x.id === past).state).toBe('EXPIRED');
    expect([await status(past), await status(future), await status(pastB), await status(anon)]).toEqual(['expired', 'requested', 'requested', 'requested']);
    const agenda = await invoke(proList, ADMIN_A, { url: '/api/pro/appointments', query: {} });
    expect(agenda.statusCode, show(agenda)).toBe(200);
    const item = agenda.body.items.find((x) => x.id === pastB);
    expect([item.status, item.awaitingDecision]).toEqual(['expired', false]);
    expect(await status(anon), 'a row without an account (LAB guest hold) is never touched').toBe('requested');
    expect((await call('GET', `appointments/${pastB}`, { as: C[2] })).body.state).toBe('EXPIRED');
    // a late decision on an expired request: refused as expired (the structure sees « Demande expirée »)
    expect((await decide(ADMIN_A, pastB, { decision: 'ACCEPT' })).body.code).toBe('REQUEST_EXPIRED');
    expect(await requests.expireStaleRequests({})).toBe(0);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${past}, ${pastB}, ${future}, ${anon})`);
  });

  it('the optional message needs the explicit consent; the consent is in ConsentLog; the person withdraws it (before and, since R45, after the start) and the staff no longer see it', async () => {
    const slots = await slotsOf(A, C[1], { from: day(3), to: day(9) });
    const MSG = `Message fictif R43 ${TS}`;
    const refused = await book(A, C[1], slots[3].startAt, { message: MSG });
    expect([refused.statusCode, refused.body.code]).toEqual([400, 'MESSAGE_CONSENT_REQUIRED']);
    for (const v of ['true', 1, 'yes', null]) expect((await book(A, C[1], slots[3].startAt, { message: MSG, messageConsent: v })).body.code, String(v)).toBe('MESSAGE_CONSENT_REQUIRED');
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = ${C[1].id} AND "startAt" = ${slots[3].startAt}`)).rows[0].n, 'nothing stored').toBe(0);
    const noMsg = await book(A, C[1], slots[4].startAt, { message: '   ' });
    expect([noMsg.statusCode, noMsg.body.hasMessage], 'a blank message needs no consent').toEqual([201, false]);
    const ok = await book(A, C[1], slots[3].startAt, { message: MSG, messageConsent: true });
    expect([ok.statusCode, ok.body.hasMessage, ok.body.canWithdrawMessage], show(ok)).toEqual([201, true, true]);
    expect(JSON.stringify(ok.body)).not.toContain(MSG);
    const consent = (await db.execute(sql`SELECT decision, proof_level, policy_hash, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${C[1].id} AND purpose = 'BOOKING_MESSAGE_TRANSMISSION' ORDER BY created_at`)).rows;
    expect(consent.length).toBe(1);
    expect([consent[0].decision, consent[0].proof_level, consent[0].policy_hash.endsWith(`:${ok.body.id}`), consent[0].withdrawn_at]).toEqual([true, 'EXPLICIT_CHECKBOX', true, null]);
    const staff = async () => (await invoke(proList, ADMIN_A, { url: `/api/pro/appointments?id=${ok.body.id}`, query: { id: ok.body.id } })).body.items[0].citizenMessage;
    expect(await staff()).toBe(MSG);
    // someone else (and an unknown id): the same 404
    const other = await call('POST', `appointments/${ok.body.id}/message/withdraw`, { as: C[2], body: {} });
    const unknown = await call('POST', `appointments/nope-${TS}/message/withdraw`, { as: C[2], body: {} });
    expect([other.statusCode, other.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(other.statusCode).toBe(404);
    expect((await call('POST', `appointments/${ok.body.id}/message/withdraw`, { body: {} })).statusCode, 'no session').toBe(401);
    const w = await call('POST', `appointments/${ok.body.id}/message/withdraw`, { as: C[1], body: {} });
    expect([w.statusCode, w.body.hasMessage], show(w)).toEqual([200, false]);
    expect((await db.execute(sql`SELECT notes FROM "ProAppointment" WHERE id = ${ok.body.id}`)).rows[0].notes).toBeNull();
    expect(await staff()).toBeNull();
    const after = (await db.execute(sql`SELECT decision, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${C[1].id} AND purpose = 'BOOKING_MESSAGE_TRANSMISSION' ORDER BY created_at`)).rows;
    expect([after.length, after[1].decision, after[1].withdrawn_at !== null]).toEqual([2, false, true]);
    expect((await call('POST', `appointments/${ok.body.id}/message/withdraw`, { as: C[1], body: {} })).body.code).toBe('NO_MESSAGE');
    expect((await call('GET', `appointments/${ok.body.id}`, { as: C[1] })).body.hasMessage).toBe(false);
    // R45 (ENG-LR-1, art. 7(3)): after the start the message is STILL withdrawable (R43 pinned MESSAGE_WITHDRAWAL_TOO_LATE here — that refusal was the defect)
    const late = `r43b-late-${TS}`;
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", notes, "updatedAt")
      VALUES (${late}, ${A.id}, ${A.svc}, NOW() - interval '1 hour', NOW() - interval '30 minutes', 'confirmed', 'Particulier', ${C[1].id}, ${'idem-' + late}, 'v1:sealed', NOW())`);
    const lateW = await call('POST', `appointments/${late}/message/withdraw`, { as: C[1], body: {} });
    expect([lateW.statusCode, lateW.body.hasMessage], show(lateW)).toEqual([200, false]);
    expect((await db.execute(sql`SELECT notes FROM "ProAppointment" WHERE id = ${late}`)).rows[0].notes).toBeNull();
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${late}`);
  });

  it('Mode B: a decision on a request the person moved in between is refused (the team reloads); the structure is told the new time waits for its answer; two decisions at once: one wins', async () => {
    await invoke(proSettings, ADMIN_D, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' } });
    try {
      const slots = await slotsOf(D, C[0], { from: day(3), to: day(9) });
      const q = await book(D, C[0], slots[0].startAt);
      expect(q.body.state).toBe('REQUESTED');
      expect((await decide(ADMIN_D, q.body.id, { decision: 'ACCEPT', expectedStartAt: slots[0].startAt })).statusCode).toBe(200);
      const mv = await call('POST', `appointments/${q.body.id}/reschedule`, { as: C[0], body: { startAt: slots[5].startAt } });
      expect([mv.statusCode, mv.body.state], show(mv)).toEqual([200, 'REQUESTED']);
      const note = (await db.execute(sql`SELECT title, message FROM "ProNotification" WHERE "structureId" = ${D.id} AND type = 'rdv_rescheduled' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
      expect(note.title).toBe('Rendez-vous déplacé : nouvelle heure à valider');
      expect(note.message).toContain('attend votre réponse');
      const stale = await decide(ADMIN_D, q.body.id, { decision: 'ACCEPT', expectedStartAt: slots[0].startAt });
      expect([stale.statusCode, stale.body.code]).toEqual([409, 'APPOINTMENT_CHANGED']);
      expect((await decide(ADMIN_D, q.body.id, { decision: 'ACCEPT', expectedStartAt: 'not-a-date' })).body.code).toBe('APPOINTMENT_CHANGED');
      expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${q.body.id}`)).rows[0].status).toBe('requested');
      const [x, y] = await Promise.all([decide(ADMIN_D, q.body.id, { decision: 'ACCEPT', expectedStartAt: slots[5].startAt }), decide(ADMIN_D, q.body.id, { decision: 'REFUSE' })]);
      expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
      // two people request the same slot at the same time: one request holds it
      const [r1, r2] = await Promise.all([book(D, C[1], slots[7].startAt), book(D, C[2], slots[7].startAt)]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${D.id} AND "startAt" = ${slots[7].startAt} AND status IN ('requested', 'confirmed')`)).rows[0].n).toBe(1);
    } finally {
      await invoke(proSettings, ADMIN_D, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'DIRECT' } });
    }
  });

  it('DST: autumn change (31/10/2027) — 09:00 Paris is 07:00Z before and 08:00Z after; a slot after it books; the lock key is the Paris day at both changes', async () => {
    const { bookingLockKeyOf } = await import('../../api/_handlers/rdv.js');
    expect(bookingLockKeyOf('s', new Date('2027-10-31T22:30:00Z'))).toBe('s:2027-10-31');   // 23:30 CET, still the 31st in Paris
    expect(bookingLockKeyOf('s', new Date('2027-10-30T22:30:00Z'))).toBe('s:2027-10-31');   // 00:30 CEST on the 31st
    expect(bookingLockKeyOf('s', new Date('2027-03-27T23:30:00Z'))).toBe('s:2027-03-28');   // 00:30 CET on the 28th (spring change day)
    expect(bookingLockKeyOf('s', new Date('2027-03-28T22:30:00Z'))).toBe('s:2027-03-29');   // 00:30 CEST
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-10-27T10:00:00Z') });
    try {
      const r = await call('GET', `structures/${D.slug}/slots`, { query: { serviceId: D.svc, from: '2027-10-30', to: '2027-11-01' }, as: C[3] });
      expect(r.statusCode, show(r)).toBe(200);
      const starts = r.body.slots.map((s) => s.startAt);
      expect(starts).toContain('2027-10-30T07:00:00.000Z');
      expect(starts).toContain('2027-10-31T08:00:00.000Z');   // the change day itself: 09:00 CET
      expect(starts).toContain('2027-11-01T08:00:00.000Z');
      expect(starts).not.toContain('2027-11-01T07:00:00.000Z');   // 08:00 Paris: before opening
      expect(starts).not.toContain('2027-11-01T11:00:00.000Z');   // 12:00 Paris: the window ends
      const b = await book(D, C[3], '2027-11-01T08:00:00.000Z');
      expect([b.statusCode, b.body.startsAt], show(b)).toEqual([201, '2027-11-01T08:00:00.000Z']);
    } finally { vi.useRealTimers(); }
  });

  it('security: a publicly registered citizen never obtains a professional, structure, territory or administrator role (sign-up, booking, age statement)', async () => {
    const r = mk();
    await signup({ method: 'POST', url: '/api/auth/signup', headers: { host: 'localhost', 'x-forwarded-for': '10.43.0.1' }, body: { email: SIGNUP_EMAIL, password: 'Synthetic-QA-Pass-01', adultDeclaration: true,
      role: 'SUPERADMIN', kind: 'pro', structureId: A.id, isAdmin: true, territory: 'strasbourg', mfa_enabled: true } }, r);
    expect(r.statusCode, show(r)).toBe(200);
    const user = (await db.execute(sql`SELECT * FROM "CitizenUser" WHERE email = ${SIGNUP_EMAIL}`)).rows[0];
    expect(user).toBeTruthy();
    expect(Object.keys(user).filter((k) => /role|admin|structure|territor/i.test(k))).toEqual([]);   // the account table has no role column at all
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProUser" WHERE lower(email) = ${SIGNUP_EMAIL}`)).rows[0].n, 'no professional account').toBe(0);
    // the citizen session is a citizen session: « me » says user, and it opens no professional or administrator surface
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW() WHERE id = ${user.id}`);
    const c = { id: user.id, email: SIGNUP_EMAIL };
    const m = mk(); await me({ method: 'GET', url: '/api/auth/me', headers: { host: 'localhost', cookie: cookie(c) } }, m);
    expect([m.statusCode, m.body?.session?.kind, m.body?.user?.role ?? m.body?.session?.role]).toEqual([200, 'user', 'user']);
    const userToken = userAuth.signUserSessionToken({ userId: user.id, email: SIGNUP_EMAIL });
    expect(auth.verifyProToken(userToken), 'a citizen token is never a professional token').toBeNull();
    for (const headers of [{ host: 'x', cookie: cookie(c) }, { host: 'x', authorization: `Bearer ${userToken}` }]) {
      const list = await invoke(proList, null, { url: '/api/pro/appointments', headers });
      const settings = await invoke(proSettings, null, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' }, headers });
      expect([list.statusCode, settings.statusCode], show(list)).toEqual([401, 401]);
      expect(await auth.verifyAdmin({ method: 'GET', headers })).toBe(false);
    }
    // booking with forged professional fields: they are ignored (own account, routed by the server, status by the structure's mode)
    await declareAdult(db, sql, [user.id]);
    const slot = (await slotsOf(B, c, { from: day(4), to: day(9) }))[0];
    const b = await book(B, c, slot.startAt, { citizenUserId: C[0].id, createdByProUserId: ADMIN_B.id, status: 'done', structureId: A.id, role: 'STRUCTURE_ADMIN' });
    expect(b.statusCode, show(b)).toBe(201);
    const row = (await db.execute(sql`SELECT "citizenUserId", "createdByProUserId", status, "structureId" FROM "ProAppointment" WHERE id = ${b.body.id}`)).rows[0];
    expect(row).toEqual({ citizenUserId: user.id, createdByProUserId: null, status: 'confirmed', structureId: B.id });
    // the age statement with role fields: one consent row, nothing else
    const ageH = (await import('../../api/_handlers/citizen/age-declaration.js')).default;
    const ar = mk(); await ageH({ method: 'POST', url: '/api/citizen/age-declaration', headers: { host: 'localhost', cookie: cookie(c) }, body: { adult: true, role: 'SUPERADMIN', structureId: A.id } }, ar);
    expect(ar.statusCode, show(ar)).toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProUser" WHERE lower(email) = ${SIGNUP_EMAIL}`)).rows[0].n).toBe(0);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${b.body.id}`);
  });
});
