/**
 * R44-BOOK — the refusal reason end to end and the modality-bound slots, on a REAL PostgreSQL (the R44 harness applies every migration; the R44 report
 * also runs it on a 0042-only database: AuditLog, ProAppointment and CitizenProfile exist there, nothing here needs a newer table or column).
 * Synthetic data only; MAILER_PROVIDER=test (nothing leaves the machine).
 *
 * Covers: Mode B request refused from the agenda API with a chosen fixed code (journal row: code + reasonChosen, no free text), without a code (OTHER,
 * reasonChosen false), an unknown code (OTHER); the person's « Mes rendez-vous » shows the code of THEIR appointment only — a journal row naming another
 * structure is ignored (tenant check), another person sees nothing; the refusal e-mail carries the fixed sentence in the reader's stored language as well
 * as the French one; a slot list asked in a modality the service does not offer is refused (409 MODE_UNAVAILABLE) and booking it too.
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
const S = (k) => ({ id: `r44r-${k}-${TS}`, slug: `r44r-${k}-slug-${TS}`, svc: `r44r-${k}-svc-${TS}`, name: `Structure fictive R44 ${k}` });
const A = S('a'); const B = S('b');
const ADMIN_A = { id: `r44r-pa-${TS}`, email: `r44r-pa-${TS}@example.test`, sid: A.id, role: 'STRUCTURE_ADMIN' };
const cit = (k) => ({ id: `r44r-c${k}-${TS}`, email: `r44r-c${k}-${TS}@example.test` });
const C = [cit('0'), cit('1'), cit('2'), cit('3')];

describe.skipIf(!hasDatabase)('R44-BOOK refusal reason and modality-bound slots (real DB)', () => {
  let db, rdv, auth, userAuth, proList, proSettings, mailer, requests, catalogue;
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, who, { method = 'GET', url, body, query = {} } = {}) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsOf = async (s, as) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: s.svc, from: day(2), to: day(8), mode: 'IN_PERSON' }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots;
  };
  const book = (s, as, startAt, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: s.svc, startAt, mode: 'IN_PERSON', idempotencyKey: `k-${Math.random()}`, ...extra } });
  const decide = (id, body) => invoke(proList, ADMIN_A, { method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body });
  const journal = async (id) => (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'RDV_REQUEST_REFUSED' AND details->>'appointmentId' = ${id}`)).rows.map((r) => r.details);
  const mineOf = async (c) => { const r = await call('GET', 'appointments', { as: c }); expect(r.statusCode, show(r)).toBe(200); return r.body.appointments; };

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
    mailer = await import('../../api/_utils/mailer.js');
    requests = await import('../../api/_services/rdv-requests.js');
    catalogue = await import('../../api/_utils/mail-catalogue.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    for (const s of [A, B]) await seedStructure(s);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${ADMIN_A.id}, ${ADMIN_A.email}, 'x', ${A.id}, 'STRUCTURE_ADMIN', 'active', true, NOW(), NOW())`);
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "preferredLanguage", "updatedAt") VALUES (${C[1].id}, 'de', NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
    const cfg = await invoke(proSettings, ADMIN_A, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' } });
    expect(cfg.statusCode, show(cfg)).toBe(200);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, B]) {
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ANY(${C.map((c) => c.id)})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureBookingConfig" WHERE "structureId" = ${s.id}`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${ADMIN_A.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ADMIN_A.id}`);
    for (const s of [A, B]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`).catch(() => {});
    for (const c of C) {
      await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
  });

  it('a chosen code is journaled with reasonChosen, the person reads it in « Mes rendez-vous »; no code / an unknown code = OTHER, not chosen', async () => {
    const slots = await slotsOf(A, C[0]);
    const q0 = await book(A, C[0], slots[0].startAt); const q2 = await book(A, C[2], slots[1].startAt); const q3 = await book(A, C[3], slots[2].startAt);
    expect([q0.body.state, q2.body.state, q3.body.state], show(q0)).toEqual(['REQUESTED', 'REQUESTED', 'REQUESTED']);
    const r0 = await decide(q0.body.id, { decision: 'REFUSE', reasonCode: 'NO_CAPACITY', expectedStartAt: slots[0].startAt });
    expect(r0.statusCode, show(r0)).toBe(200);
    expect(r0.body.notification.citizenEmail).toBe('TEST_RECORDED');
    expect((await decide(q2.body.id, { decision: 'REFUSE' })).statusCode).toBe(200);
    expect((await decide(q3.body.id, { decision: 'REFUSE', reasonCode: 'Votre dossier de santé…' })).statusCode).toBe(200);
    expect((await journal(q0.body.id))[0]).toMatchObject({ appointmentId: q0.body.id, reasonCode: 'NO_CAPACITY', reasonChosen: true, structureId: A.id });
    expect((await journal(q2.body.id))[0]).toMatchObject({ reasonCode: 'OTHER', reasonChosen: false });
    const j3 = await journal(q3.body.id);
    expect(j3[0]).toMatchObject({ reasonCode: 'OTHER', reasonChosen: false });
    expect(JSON.stringify(j3), 'no team text in the journal').not.toContain('santé');
    const mine0 = (await mineOf(C[0])).find((x) => x.id === q0.body.id);
    expect(mine0).toMatchObject({ state: 'REFUSED', refusal: { reasonCode: 'NO_CAPACITY' } });
    expect((await mineOf(C[2])).find((x) => x.id === q2.body.id).refusal).toEqual({ reasonCode: 'OTHER' });
    // another person never sees these appointments (nor their reason)
    expect((await mineOf(C[3])).some((x) => x.id === q0.body.id)).toBe(false);
  });

  it('tenant check: a journal row naming ANOTHER structure for this appointment is ignored', async () => {
    const slots = await slotsOf(A, C[0]);
    const q = await book(A, C[0], slots[3].startAt);
    expect((await decide(q.body.id, { decision: 'REFUSE', reasonCode: 'NO_CAPACITY' })).statusCode).toBe(200);
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, details, "timestamp") VALUES (${`r44r-forged-${TS}`}, 'RDV_REQUEST_REFUSED', 'x', 'x', 'ProUser',
      ${JSON.stringify({ appointmentId: q.body.id, structureId: B.id, reasonCode: 'NOT_SUITABLE' })}::jsonb, NOW() + interval '1 minute')`);
    const reasons = await requests.refusalReasonsFor([{ id: q.body.id, structureId: A.id, status: 'refused' }]);
    expect(reasons.get(q.body.id)).toBe('NO_CAPACITY');
    expect((await mineOf(C[0])).find((x) => x.id === q.body.id).refusal).toEqual({ reasonCode: 'NO_CAPACITY' });
    await db.execute(sql`DELETE FROM "AuditLog" WHERE id = ${`r44r-forged-${TS}`}`);
  });

  it('the refusal e-mail: neutral subject, the French sentence, and the same sentence in the reader\'s stored language (German here)', async () => {
    mailer.__clearTestOutbox();
    const slots = await slotsOf(A, C[1]);
    const q = await book(A, C[1], slots[4].startAt);
    mailer.__clearTestOutbox();
    expect((await decide(q.body.id, { decision: 'REFUSE', reasonCode: 'NOT_SUITABLE' })).statusCode).toBe(200);
    const mail = mailer.__getTestOutbox().find((m) => m.to === C[1].email);
    expect(mail, 'the refusal notice is in the test outbox').toBeTruthy();
    expect(mail.subject).toBe(catalogue.mailText('appointment_refusal', 'de').subject);
    expect(mail.subject).not.toMatch(/refus|abgelehnt/i);
    expect(mail.text).toContain(requests.REFUSAL_REASONS.NOT_SUITABLE);
    expect(mail.text).toContain(catalogue.REFUSAL_REASON_TEXTS.NOT_SUITABLE.de);
  });

  it('slots and booking are bound to the modality: a modality the service does not offer is refused, nothing stored', async () => {
    const r = await call('GET', `structures/${A.slug}/slots`, { query: { serviceId: A.svc, from: day(2), to: day(8), mode: 'VIDEO' }, as: C[0] });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MODE_UNAVAILABLE']);
    const slots = await slotsOf(A, C[0]);
    const before = (await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${A.id}`)).rows[0].n;
    const b = await book(A, C[0], slots[5].startAt, { mode: 'VIDEO', videoConsent: true });
    expect([b.statusCode, b.body.code], show(b)).toEqual([409, 'MODE_UNAVAILABLE']);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${A.id}`)).rows[0].n).toBe(before);
  });

  it('the services answer gives the journey what it shows before the commitment: modalities, the recorded address with its verification state, the video state', async () => {
    const r = await call('GET', `structures/${A.slug}/services`, { as: C[0] });
    expect(r.statusCode, show(r)).toBe(200);
    expect(r.body.structure.location).toEqual({ address: '1 rue Fictive, 67000 Strasbourg', verified: true, stepFreeAccess: false });
    expect(r.body.structure.modes).toEqual(['IN_PERSON']);
    expect(typeof r.body.video.available).toBe('boolean');
    expect(r.body.items[0].modes).toEqual(['IN_PERSON']);
  });
});
