/**
 * Booking audit fixes (RECON_PUBLIC_CITIZEN 2026-11-15, A-25 … A-30) on a REAL PostgreSQL through the real handlers. Synthetic structures, professionals
 * and citizens only (…@example.test); MAILER_PROVIDER=test; no Microsoft endpoint is ever called.
 *
 *  A-29  GET rdv/structures/:slug/profile (no account) applies the same sensitivity gate as its signed-in siblings: a service whose online booking is not
 *        open is listed as CONTACT_STRUCTURE and discloses no availability (nextAvailableDay).
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
const P1 = pro('1', T.id, 'Camille Fictive'); const P2 = pro('2', T.id, 'Dominique Fictif');
const cit = (k) => ({ id: `bkf-c${k}-${TS}`, email: `test.citizen+bkf${k}-${TS}@example.test` });
const C = [cit('0'), cit('1'), cit('2')];

describe.skipIf(!hasDatabase)('booking audit fixes A-25 … A-30 (real DB)', () => {
  let db, rdv, userAuth;
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
    for (const s of [A, T, G]) await seedStructure(s);
    for (const p of [P1, P2]) {
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
    for (const p of [P1, P2]) {
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
});
