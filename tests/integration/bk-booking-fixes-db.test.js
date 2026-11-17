/**
 * Booking audit fixes (RECON_PUBLIC_CITIZEN 2026-11-15, A-25 … A-30) on a REAL PostgreSQL through the real handlers. Synthetic structures, professionals
 * and citizens only (…@example.test); MAILER_PROVIDER=test; no Microsoft endpoint is ever called.
 *
 *  A-25  replay: the same idempotency key answers the booking already made (200, same appointment, one row, no second e-mail) — what the page now sends
 *        after a lost answer; a NEW key for the same slot (what the page sent before) is the 409 « slot taken » the person used to read.
 *  A-27  the connected calendar's status line no longer claims, in the default single-agenda mode, that busy times count for the slots
 *        (rdv-settings GET channels[calendar].appliesToSlots = team choice on); the single-agenda engine indeed reads no calendar.
 *  A-29  GET rdv/structures/:slug/profile (no account) applies the same sensitivity gate as its signed-in siblings: a service whose online booking is not
 *        open is listed as CONTACT_STRUCTURE and discloses no availability (nextAvailableDay).
 *  A-26  GET rdv/structures/:slug/slots?appointment=<id> lists the slots THAT appointment can be moved to, from the same source as the move itself: with
 *        team choice only the assigned professional's free slots (the union of the team was listed and then refused); every listed slot is accepted.
 *  A-30  the same answer says whether the move will ask for the separate art. 9 agreement (move.sensitiveConsentRequired) — true exactly when the move
 *        itself answers SENSITIVE_CONSENT_REQUIRED without it.
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

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { declareAdult } from './helpers/adult-age.mjs';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const mk = () => ({ statusCode: 200, body: null, headers: {}, _finish: [], on(ev, fn) { if (ev === 'finish') this._finish.push(fn); }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; this._finish.forEach((f) => f()); return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const S = (k) => ({ id: `bkf-${k}-${TS}`, slug: `bkf-${k}-slug-${TS}`, svc: `bkf-${k}-svc-${TS}`, name: `Structure fictive BK ${k}` });
const A = S('a');   // single agenda (the default)
const T = S('t');   // team choice on, two professionals
const G = S('g');   // one service, used by the sensitivity gate scenario
const pro = (k, sid, name) => ({ id: `bkf-p${k}-${TS}`, email: `bkf-p${k}-${TS}@example.test`, sid, role: 'PRO', name });
const P1 = pro('1', T.id, 'Camille Fictive'); const P2 = pro('2', T.id, 'Dominique Fictif'); const P3 = pro('3', A.id, 'Alex Fictif');
const cit = (k) => ({ id: `bkf-c${k}-${TS}`, email: `test.citizen+bkf${k}-${TS}@example.test` });
const C = [cit('0'), cit('1'), cit('2')];

describe.skipIf(!hasDatabase)('booking audit fixes A-25 … A-30 (real DB)', () => {
  let db, rdv, userAuth, mailer, auth, proSettings;
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:5183', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const classify = (s, svc, value) => db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
    jsonb_build_object('v', 1, 'services', jsonb_build_object(${svc}::text, jsonb_build_object('value', ${value}::text, 'reviewedAt', '2026-11-05T10:00:00.000Z', 'reviewedBy', 'seed@example.test', 'reason', 'Classification fictive'))), true) WHERE id = ${s.id}`);
  const slotsOf = async (s, as, query = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: s.svc, from: day(3), to: day(10), ...query }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots.map((x) => x.startAt);
  };
  const book = (s, as, startAt, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: s.svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const move = (id, as, startAt, extra = {}) => call('POST', `appointments/${id}/reschedule`, { as, body: { startAt, ...extra } });
  const rows = async (q) => (await db.execute(q)).rows;
  const unclassify = (s) => db.execute(sql`UPDATE "Structure" SET settings_json = coalesce(settings_json, '{}'::jsonb) - 'serviceSensitivity' WHERE id = ${s.id}`);

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}`}, ${s.id}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Accueil social fictif', 30, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    mailer = await import('../../api/_utils/mailer.js');
    auth = await import('../../api/_utils/auth.js');
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    for (const s of [A, T, G]) await seedStructure(s);
    for (const p of [P1, P2, P3]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "jobTitle", "updatedAt") VALUES (${'pp-' + p.id}, ${p.id}, ${p.name}, 'Accueil', NOW())`);
    }
    const team = { v: 1, confirmation: 'DIRECT', services: {}, team: { enabled: true, members: { [P1.id]: { bookable: true, selectable: true, serviceIds: [] }, [P2.id]: { bookable: true, selectable: true, serviceIds: [] } } } };
    await db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rdvBooking}', ${JSON.stringify(team)}::jsonb, true) WHERE id = ${T.id}`);
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
  }, 60000);

  afterEach(async () => { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); });

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, T, G]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${s.id}`);
    }
    for (const p of [P1, P2, P3]) {
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const s of [A, T, G]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    for (const c of C) { await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${c.id}`).catch(() => {}); await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {}); }
  });

  // ───────────────────────────── A-29 ─────────────────────────────
  it('A-29: the account-free profile discloses no availability for a service whose online booking is not open (same gate as services / slots)', async () => {
    const open = await call('GET', `structures/${G.slug}/profile`);
    expect(open.statusCode, show(open)).toBe(200);
    expect(open.body.services).toEqual([expect.objectContaining({ id: G.svc, onlineBooking: 'OPEN' })]);
    expect(open.body.nextAvailableDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await classify(G, G.svc, 'sensitive');   // verified sensitive, art. 9 gate closed: never bookable online, in every environment
    try {
      const closed = await call('GET', `structures/${G.slug}/profile`);
      expect(closed.statusCode, show(closed)).toBe(200);
      expect(closed.body.services).toEqual([expect.objectContaining({ id: G.svc, onlineBooking: 'CONTACT_STRUCTURE' })]);
      expect(closed.body.nextAvailableDay).toBeNull();
      // the signed-in sibling answers the same way for the same service
      const slots = await call('GET', `structures/${G.slug}/slots`, { query: { serviceId: G.svc, from: day(1), to: day(8) }, as: C[0] });
      expect([slots.statusCode, slots.body.code], show(slots)).toEqual([409, 'SENSITIVE_BOOKING_NOT_OPEN']);
    } finally { await unclassify(G); }

    vi.stubEnv('ADA_SENSITIVITY_REVIEW_ENFORCED', '1');   // an unreviewed service where the review is enforced
    const unreviewed = await call('GET', `structures/${G.slug}/profile`);
    expect(unreviewed.body.services[0].onlineBooking).toBe('CONTACT_STRUCTURE');
    expect(unreviewed.body.nextAvailableDay).toBeNull();
  });

  // ───────────────────────────── A-26 ─────────────────────────────
  it('A-26 (team choice): the move list is the assigned professional’s own free slots — a slot only a colleague has free is not listed, and every listed slot moves', async () => {
    const teamView = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[0] });
    expect(teamView.statusCode, show(teamView)).toBe(200);
    const h1 = teamView.body.professionals.find((p) => p.displayName === P1.name).id;
    const all = await slotsOf(T, C[0], { professional: 'ANY' });
    const [s0, s1, s2] = all;
    const mine = await book(T, C[0], s0, { professional: h1 });
    expect(mine.statusCode, show(mine)).toBe(201);
    const other = await book(T, C[1], s1, { professional: h1 });   // the same professional is taken at s1; the colleague is still free then
    expect(other.statusCode, show(other)).toBe(201);
    expect((await rows(sql`SELECT "createdByProUserId" AS pro FROM "ProAppointment" WHERE id IN (${mine.body.id}, ${other.body.id})`)).map((r) => r.pro)).toEqual([P1.id, P1.id]);

    // the list without the appointment (what the panel asked before): the union of the team — s1 is there, although the move to s1 is refused
    const union = await slotsOf(T, C[0]);
    expect(union).toContain(s1);
    const refused = await move(mine.body.id, C[0], s1);
    expect([refused.statusCode, refused.body.code], show(refused)).toEqual([409, 'SLOT_TAKEN']);

    // the list FOR this appointment: the server's own move rules
    const forMove = await slotsOf(T, C[0], { appointment: mine.body.id });
    expect(forMove).not.toContain(s1);   // its professional is busy then
    expect(forMove).not.toContain(s0);   // the current slot is not a move
    expect(forMove).toContain(s2);
    // an absence of the assigned professional removes that time from the move list (a colleague being free does not help)
    const off = new Date(s2);
    await db.execute(sql`INSERT INTO "ProTimeOff" (id, "structureId", "proUserId", "startAt", "endAt", "updatedAt") VALUES (${'off-' + TS}, ${T.id}, ${P1.id}, ${off.toISOString()}::timestamptz, ${new Date(off.getTime() + 30 * 60_000).toISOString()}::timestamptz, NOW())`);
    const withAbsence = await slotsOf(T, C[0], { appointment: mine.body.id });
    expect(withAbsence).not.toContain(s2);
    expect(await slotsOf(T, C[0])).toContain(s2);
    const absent = await move(mine.body.id, C[0], s2);
    expect(absent.statusCode, show(absent)).toBe(409);
    // a listed slot is accepted by the move, and the appointment keeps its professional
    const target = withAbsence[0];
    const moved = await move(mine.body.id, C[0], target);
    expect(moved.statusCode, show(moved)).toBe(200);
    const after = (await rows(sql`SELECT "createdByProUserId" AS pro, (extract(epoch from "startAt") * 1000)::bigint AS ms FROM "ProAppointment" WHERE id = ${mine.body.id}`))[0];
    expect([after.pro, Number(after.ms)]).toEqual([P1.id, new Date(target).getTime()]);
  });

  it('A-26: the move list is for the person’s own appointment of that service only, and answers the move’s own refusals', async () => {
    const [s0, s1] = await slotsOf(A, C[0]);
    const mine = await book(A, C[0], s0);
    expect(mine.statusCode, show(mine)).toBe(201);
    const forMove = await slotsOf(A, C[0], { appointment: mine.body.id });
    expect(forMove).not.toContain(s0);
    expect(forMove).toContain(s1);
    const q = { serviceId: A.svc, from: day(3), to: day(10), appointment: mine.body.id };
    // someone else's appointment, an unknown one, and one of another structure: the same 404
    for (const r of [await call('GET', `structures/${A.slug}/slots`, { query: q, as: C[1] }), await call('GET', `structures/${A.slug}/slots`, { query: { ...q, appointment: 'no-such-id' }, as: C[0] }),
      await call('GET', `structures/${T.slug}/slots`, { query: { ...q, serviceId: T.svc }, as: C[0] })]) {
      expect([r.statusCode, r.body.error], show(r)).toEqual([404, 'Appointment not found']);
    }
    // an appointment that can no longer be moved (limit reached): the move's own refusal, no slot list
    await db.execute(sql`UPDATE "ProAppointment" SET "rescheduleCount" = 2 WHERE id = ${mine.body.id}`);
    const limit = await call('GET', `structures/${A.slug}/slots`, { query: q, as: C[0] });
    expect([limit.statusCode, limit.body.code], show(limit)).toEqual([409, 'RESCHEDULE_LIMIT']);
  });

  // ───────────────────────────── A-30 ─────────────────────────────
  it('A-30: the move list says when the art. 9 agreement is expected — exactly when the move refuses without it', async () => {
    const OPEN = { ADA_SENSITIVE_BOOKING_APPROVED: 'art9-explicit-consent-v1', ADA_HDS_BOOKING_ASSESSED: '1' };
    const open = () => { for (const [k, v] of Object.entries(OPEN)) vi.stubEnv(k, v); };
    const list = async (id) => { const r = await call('GET', `structures/${G.slug}/slots`, { query: { serviceId: G.svc, from: day(3), to: day(10), appointment: id }, as: C[2] }); expect(r.statusCode, show(r)).toBe(200); return r.body; };
    const first = await call('GET', `structures/${G.slug}/slots`, { query: { serviceId: G.svc, from: day(3), to: day(10) }, as: C[2] });
    const [s0, s1, s2] = first.body.slots.map((x) => x.startAt);
    const booked = await call('POST', 'appointments', { as: C[2], body: { structureSlug: G.slug, serviceId: G.svc, startAt: s0, idempotencyKey: `k-${Math.random()}` } });   // booked while ordinary / unreviewed (LAB)
    expect(booked.statusCode, show(booked)).toBe(201);
    const id = booked.body.id;
    expect((await list(id)).move).toEqual({ appointmentId: id, sensitiveConsentRequired: false });

    await classify(G, G.svc, 'sensitive'); open();   // reclassified sensitive, art. 9 gate open: no consent exists for this appointment
    try {
      expect((await list(id)).move.sensitiveConsentRequired).toBe(true);
      const without = await move(id, C[2], s1);
      expect([without.statusCode, without.body.code], show(without)).toEqual([400, 'SENSITIVE_CONSENT_REQUIRED']);
      const withBox = await move(id, C[2], s1, { sensitiveConsent: true });
      expect(withBox.statusCode, show(withBox)).toBe(200);
      // the agreement given with the move is recorded for this appointment: the next move no longer asks for it
      expect((await list(id)).move.sensitiveConsentRequired).toBe(false);
      const again = await move(id, C[2], s2);
      expect(again.statusCode, show(again)).toBe(200);
    } finally { await unclassify(G); }
  });

  // ───────────────────────────── A-25 ─────────────────────────────
  it('A-25 replay: a retry with the SAME key answers the confirmed booking (one row, one e-mail); a new key for the same slot is « slot taken »', async () => {
    const slot = (await slotsOf(A, C[1])).at(-1);
    const body = { structureSlug: A.slug, serviceId: A.svc, startAt: slot, idempotencyKey: `bkf-replay-${TS}` };
    mailer.__clearTestOutbox();
    const first = await call('POST', 'appointments', { as: C[1], body });   // its answer is « lost »: the person never sees it
    expect(first.statusCode, show(first)).toBe(201);
    const sent = mailer.__getTestOutbox().length;
    expect(sent).toBeGreaterThan(0);
    // what the page did before the fix: a new key on the second click → the person's own booking reads as someone else's
    const newKey = await call('POST', 'appointments', { as: C[1], body: { ...body, idempotencyKey: `bkf-other-${TS}` } });
    expect([newKey.statusCode, newKey.body.error], show(newKey)).toEqual([409, 'Slot no longer available']);
    // what it does now: the same key → the booking itself, confirmed, manageable
    const replay = await call('POST', 'appointments', { as: C[1], body });
    expect(replay.statusCode, show(replay)).toBe(200);
    expect([replay.body.id, replay.body.state, replay.body.startsAt]).toEqual([first.body.id, 'CONFIRMED', slot]);
    expect(replay.body.manageUrl).toContain(first.body.id);
    expect(await rows(sql`SELECT id FROM "ProAppointment" WHERE "citizenUserId" = ${C[1].id} AND "structureId" = ${A.id} AND "startAt" = ${slot}::timestamptz`)).toHaveLength(1);
    expect(mailer.__getTestOutbox().length).toBe(sent);   // no second confirmation e-mail
    // someone else's request with the same key string is not a replay of this booking
    const stranger = await call('POST', 'appointments', { as: C[2], body });
    expect(stranger.statusCode, show(stranger)).toBe(409);
  });

  // ───────────────────────────── A-27 ─────────────────────────────
  it('A-27: the calendar status says whether busy times count for the slots — not in the single-agenda mode (default), yes with team choice', async () => {
    const settingsOf = async (who) => { const r = mk(); await proSettings({ method: 'GET', url: '/api/pro/rdv-settings', query: {}, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); expect(r.statusCode, show(r)).toBe(200); return r.body; };
    const single = await settingsOf(P3);
    expect(single.booking.team.enabled).toBe(false);
    expect(single.channels.find((c) => c.channel === 'calendar').appliesToSlots).toBe(false);
    expect(single.channels.filter((c) => c.channel !== 'calendar').every((c) => !('appliesToSlots' in c))).toBe(true);
    expect((await settingsOf(P1)).channels.find((c) => c.channel === 'calendar').appliesToSlots).toBe(true);
    // the fact the line now states: in the single-agenda mode a professional's connected calendar is not read for the public slots
    await db.execute(sql`INSERT INTO "ProOutlookToken" (id, "userId", email, "accessTokenEnc", "refreshTokenEnc", iv, "expiresAt", scope, "updatedAt") VALUES (${'ot-' + P3.id}, ${P3.id}, ${P3.email}, 'not-an-envelope', 'not-an-envelope', 'x', NOW(), 'Calendars.ReadBasic', NOW())`);
    vi.stubEnv('OUTLOOK_ENABLED', 'true');   // a calendar that cannot be read removes ALL its owner's slots where it is read (team, fail safe)
    expect((await slotsOf(A, C[0])).length).toBeGreaterThan(10);
  });
});
