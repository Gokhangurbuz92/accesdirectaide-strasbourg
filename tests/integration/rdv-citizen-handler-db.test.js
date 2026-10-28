/**
 * RDV citizen handler — real PostgreSQL, real session cookies (no handler mocks).
 * Covers the real contract behind the Strasbourg journey:
 *   auth (401) → e-mail verification (403 EMAIL_NOT_VERIFIED) → services/slots → booking
 *   → idempotent replay → double-booking (409) → IDOR (403) → cancel → capability-token confirmation.
 * Only the rate limiter is replaced (it needs KV); the mailer uses its built-in `test` outbox (no network).
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-rdv-db-test');

const hoisted = vi.hoisted(() => ({ probe: null }));
vi.mock('../../api/_utils/mailer.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, sendMail: async (payload) => { if (hoisted.probe) await hoisted.probe(payload); return original.sendMail(payload); } };
});
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const IDS = {
  structure: `rdvdb-str-${TS}`, service: `rdvdb-svc-${TS}`,
  userA: `rdvdb-ua-${TS}`, userB: `rdvdb-ub-${TS}`, userUnverified: `rdvdb-uu-${TS}`,
};
const SLUG = `rdvdb-slug-${TS}`;
const EMAILS = {
  a: `a-${TS}@example.test`, b: `b-${TS}@example.test`, u: `u-${TS}@example.test`,
};

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
    end(d) { if (d !== undefined) this.body = d; return this; },
  };
}

describe.skipIf(!hasDatabase)('RDV citizen handler (real DB)', () => {
  let handler, db, schema, userAuth, mailer;
  let slot; // { startAt, endAt }

  const cookieFor = (userId, email) => {
    const token = userAuth.signUserSessionToken({ userId, email });
    return userAuth.buildUserSessionCookie(token).split(';')[0];
  };
  const call = async ({ method = 'GET', path, query = {}, body, cookie }) => {
    const res = makeRes();
    await handler({
      method, url: `/api/rdv/${path}`, query, body,
      headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(cookie ? { cookie } : {}) },
    }, res);
    return res;
  };

  beforeAll(async () => {
    ({ default: handler } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    mailer = await import('../../api/_utils/mailer.js');

    // E01 fixture overlay v1 (PKG-5, 2026-10-20): the synthetic organization is identity-VERIFIED so new bookings are allowed (owner decision E01). Only this fixture changed; no assertion.
    await db.execute(sql`
      INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${IDS.structure}, 'RDV DB Test Structure', ${SLUG}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['consultation'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.insert(schema.StructureRdvSettings).values({ structureId: IDS.structure, isPublished: true, bookingMode: 'IN_PERSON' });
    await db.insert(schema.ProRdvService).values({
      id: IDS.service, structureId: IDS.structure, name: 'Accompagnement social DB',
      durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true,
    });
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.insert(schema.ProAvailabilityRule).values({
        structureId: IDS.structure, weekday, startTime: '09:00', endTime: '12:00', timezone: 'Europe/Paris', isActive: true,
      });
    }
    const verifiedAt = new Date();
    await db.insert(schema.CitizenUser).values([
      { id: IDS.userA, email: EMAILS.a, passwordHash: 'x', emailVerifiedAt: verifiedAt },
      { id: IDS.userB, email: EMAILS.b, passwordHash: 'x', emailVerifiedAt: verifiedAt },
      { id: IDS.userUnverified, email: EMAILS.u, passwordHash: 'x', emailVerifiedAt: null },
    ]);

    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const next = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const res = await call({
      path: `structures/${SLUG}/slots`, query: { serviceId: IDS.service, from: day, to: next },
      cookie: cookieFor(IDS.userA, EMAILS.a),
    });
    expect(res.statusCode).toBe(200);
    const all = (res.body.days || []).flatMap((d) => d.slots || []);
    expect(all.length).toBeGreaterThan(1);
    slot = all[0];
  });

  afterAll(async () => {
    if (!hasDatabase || !db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${IDS.service}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${IDS.userA}, ${IDS.userB}, ${IDS.userUnverified})`);
  });

  it('services: 401 without session, 403 EMAIL_NOT_VERIFIED when unverified, 200 when verified', async () => {
    const anon = await call({ path: `structures/${SLUG}/services` });
    expect(anon.statusCode).toBe(401);
    const unverified = await call({ path: `structures/${SLUG}/services`, cookie: cookieFor(IDS.userUnverified, EMAILS.u) });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');
    const ok = await call({ path: `structures/${SLUG}/services`, cookie: cookieFor(IDS.userA, EMAILS.a) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.items.map((s) => s.id)).toEqual([IDS.service]);
  });

  it('a session signed for a different e-mail than the stored user is rejected (401)', async () => {
    const res = await call({ path: `structures/${SLUG}/services`, cookie: cookieFor(IDS.userA, `evil-${TS}@example.test`) });
    expect(res.statusCode).toBe(401);
  });

  it('slots require authentication and an existing published structure', async () => {
    const anon = await call({ path: `structures/${SLUG}/slots`, query: { serviceId: IDS.service, from: '2030-01-01', to: '2030-01-02' } });
    expect(anon.statusCode).toBe(401);
    const missing = await call({ path: 'structures/does-not-exist/slots', query: { serviceId: 'x', from: '2030-01-01', to: '2030-01-02' }, cookie: cookieFor(IDS.userA, EMAILS.a) });
    expect(missing.statusCode).toBe(404);
  });

  it('booking: 401 anonymous, 403 unverified, 400 incomplete body, 409 for a non-offered slot', async () => {
    const body = { structureSlug: SLUG, serviceId: IDS.service, startAt: slot.startAt, idempotencyKey: `k-neg-${TS}` };
    expect((await call({ method: 'POST', path: 'appointments', body })).statusCode).toBe(401);
    const unv = await call({ method: 'POST', path: 'appointments', body, cookie: cookieFor(IDS.userUnverified, EMAILS.u) });
    expect(unv.statusCode).toBe(403);
    expect(unv.body.code).toBe('EMAIL_NOT_VERIFIED');
    const bad = await call({ method: 'POST', path: 'appointments', body: { structureSlug: SLUG }, cookie: cookieFor(IDS.userA, EMAILS.a) });
    expect(bad.statusCode).toBe(400);
    const off = new Date(new Date(slot.startAt).getTime() + 7 * 60000).toISOString();
    const notOffered = await call({ method: 'POST', path: 'appointments', body: { ...body, startAt: off, idempotencyKey: `k-off-${TS}` }, cookie: cookieFor(IDS.userA, EMAILS.a) });
    expect(notOffered.statusCode).toBe(409);
  });

  it('end-to-end: confirmed booking, e-mail+ICS, idempotent replay, double-booking, IDOR, cancel, capability token', async () => {
    mailer.__clearTestOutbox();
    const cookieA = cookieFor(IDS.userA, EMAILS.a);
    const cookieB = cookieFor(IDS.userB, EMAILS.b);
    const body = { structureSlug: SLUG, serviceId: IDS.service, startAt: slot.startAt, idempotencyKey: `k-main-${TS}` };

    // At e-mail time the booking must already be COMMITTED (visible from an independent connection) and the
    // advisory lock released: a slow provider must never hold the booking transaction open.
    let visibleAtMailTime = null;
    hoisted.probe = async () => {
      const { default: pg } = await import('pg');
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const r = await client.query('SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = $1 AND "idempotencyKey" = $2', [IDS.structure, body.idempotencyKey]);
        visibleAtMailTime = r.rows[0].n;
      } finally { await client.end(); }
    };
    const created = await call({ method: 'POST', path: 'appointments', body, cookie: cookieA });
    hoisted.probe = null;
    expect(visibleAtMailTime).toBe(1);
    expect(created.statusCode).toBe(201);
    expect(created.body.status).toBe('CONFIRMED');
    expect(created.body.calendar?.contentType).toMatch(/text\/calendar/);
    expect(created.body.calendar.content).toContain("BEGIN:VCALENDAR");
    expect(created.body.structure.slug).toBe(SLUG);
    expect(created.body.service.id).toBe(IDS.service);
    const id = created.body.id;

    const outbox = mailer.__getTestOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(EMAILS.a);
    expect(outbox[0].attachments[0].filename).toMatch(/\.ics$/);
    // R13 (N05): the confirmation's calendar file is an iTIP PUBLISH from the sending address, with the same method in its Content-Type (RFC 5545 §3.7.2)
    expect(outbox[0].attachments[0].contentType).toBe('text/calendar; method=PUBLISH; charset=utf-8');
    expect(outbox[0].attachments[0].content.replace(/\r\n[ \t]/g, '')).toMatch(/\r\nORGANIZER;CN="[^"]*":mailto:noreply@example\.test\r\n/);
    const manageUrl = new URL(outbox[0].text.match(/https?:\/\/\S+/)[0]);
    expect(manageUrl.searchParams.get('appointment')).toBe(id);
    const token = new URLSearchParams(manageUrl.hash.replace(/^#/, '')).get('token');
    expect(token && token.length).toBeGreaterThanOrEqual(20);

    // idempotent replay: same key => same appointment, no second row, no second e-mail
    const replay = await call({ method: 'POST', path: 'appointments', body, cookie: cookieA });
    expect(replay.statusCode).toBe(200);
    expect(replay.body.id).toBe(id);
    expect(mailer.__getTestOutbox()).toHaveLength(1);

    // another citizen cannot take the same slot
    const clash = await call({ method: 'POST', path: 'appointments', body: { ...body, idempotencyKey: `k-clash-${TS}` }, cookie: cookieB });
    expect(clash.statusCode).toBe(409);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${IDS.structure} AND "startAt" = ${new Date(slot.startAt)} AND status <> 'cancelled'`);
    expect(rows.rows[0].n).toBe(1);

    // IDOR: owner only
    expect((await call({ path: `appointments/${id}`, cookie: cookieA })).statusCode).toBe(200);
    expect((await call({ path: `appointments/${id}`, cookie: cookieB })).statusCode).toBe(404);   // R12: same answer as unknown
    expect((await call({ path: `appointments/${id}` })).statusCode).toBe(401);
    expect((await call({ method: 'POST', path: `appointments/${id}/cancel`, cookie: cookieB })).statusCode).toBe(404);

    // capability-token confirmation: valid token works without a session; tampered/foreign tokens fail closed
    const viaToken = await call({ method: 'POST', path: `appointments/${id}/confirmation`, body: { token } });
    expect(viaToken.statusCode).toBe(200);
    expect(viaToken.body.id).toBe(id);
    const tampered = await call({ method: 'POST', path: `appointments/${id}/confirmation`, body: { token: token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa') } });
    expect(tampered.statusCode).toBe(404);
    const otherId = await call({ method: 'POST', path: 'appointments/00000000-0000-0000-0000-000000000000/confirmation', body: { token } });
    expect(otherId.statusCode).toBe(404);

    // R12 (B04): the e-mail link's token cancels without a session; a tampered token cancels nothing; the owner's own cancel is then idempotent
    expect((await call({ method: 'POST', path: `appointments/${id}/cancel`, body: { token: token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa') } })).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${id}`)).rows[0].status).not.toBe('cancelled');
    const byLink = await call({ method: 'POST', path: `appointments/${id}/cancel`, body: { token } });
    expect(byLink.statusCode).toBe(200); expect(String(byLink.body.status).toLowerCase()).toBe('cancelled');
    // owner cancels => slot is bookable again by someone else
    const cancelled = await call({ method: 'POST', path: `appointments/${id}/cancel`, cookie: cookieA });
    expect(cancelled.statusCode).toBe(200);
    expect(String(cancelled.body.status).toLowerCase()).toBe('cancelled');
    const rebook = await call({ method: 'POST', path: 'appointments', body: { ...body, idempotencyKey: `k-rebook-${TS}` }, cookie: cookieB });
    expect(rebook.statusCode).toBe(201);
  });
});
