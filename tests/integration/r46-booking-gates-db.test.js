/**
 * R46 (booking worker) — the R45 sensitivity rule closed on the two paths R45 left open, the calendar export, the channel status and cross-structure
 * isolation, on a REAL PostgreSQL through the real handlers. Synthetic structures, professionals and citizens only (…@example.test); MAILER_PROVIDER=test.
 *
 *  1. Reschedule re-checks the CURRENT verified classification: unreviewed + enforcement → SERVICE_SENSITIVITY_UNREVIEWED; verified sensitive with the art. 9
 *     gate closed → SENSITIVE_BOOKING_NOT_OPEN in every environment; the appointment is unchanged and can still be cancelled; verified ordinary moves under
 *     enforcement; gate open + sensitive → the active consent of THIS appointment is needed (given now = ConsentLog row, channel « reschedule »).
 *     The citizen notice of a move of a non-ordinary service is the minimal one: no service, no structure, no .ics.
 *  2. Professional-created appointments follow the same rule (LAB unknown books; enforced unknown / sensitive closed refused; gate open needs the recorded
 *     explicit agreement); another structure's service is the same 404 as an unknown one.
 *  3. The professional agenda export (.ics) never names a verified sensitive service (nor an unreviewed one where the review is enforced); another
 *     structure's events never appear.
 *  4. Cross-structure / cross-citizen isolation of every appointment route touched here.
 *  5. The channel status line (rdv-settings GET) carries states and variable names only — never a configured secret value.
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
const S = (k) => ({ id: `r46g-${k}-${TS}`, slug: `r46g-${k}-slug-${TS}`, svc: `r46g-${k}-svc-${TS}`, svc2: `r46g-${k}-svc2-${TS}`, name: `Structure fictive R46 ${k}` });
const A = S('a'); const B = S('b');
const pro = (k, sid) => ({ id: `r46g-p${k}-${TS}`, email: `r46g-p${k}-${TS}@example.test`, sid, role: 'STRUCTURE_ADMIN' });
const PRO_A = pro('a', A.id); const PRO_B = pro('b', B.id);
const cit = (k) => ({ id: `r46g-c${k}-${TS}`, email: `test.citizen+r46g${k}-${TS}@example.test` });
const C = [cit('0'), cit('1')];
const OPEN = { ADA_SENSITIVE_BOOKING_APPROVED: 'art9-explicit-consent-v1', ADA_HDS_BOOKING_ASSESSED: '1' };
const SVC2_NAME = 'Consultation addictologie fictive';

describe.skipIf(!hasDatabase)('R46 booking gates: reschedule + pro-created sensitivity, agenda export, isolation, channel status (real DB)', () => {
  let db, rdv, auth, userAuth, proList, proIcs, proSettings, mailer;
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:5183', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const asPro = (who) => ({ host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` });
  const invoke = async (handler, who, { method = 'GET', url, body, query = {} } = {}) => { const r = mk(); await handler({ method, url, query, body, headers: asPro(who) }, r); return r; };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsOf = async (s, as, svc, { from = day(3), to = day(10) } = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: svc, from, to }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots;
  };
  const free = [];   // slots handed out once each (every scenario uses its own slots: no collision between scenarios)
  const take = () => { const s = free.shift(); expect(s, 'enough synthetic slots').toBeTruthy(); return s; };
  const book = (s, as, startAt, svc, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const move = (id, as, startAt, extra = {}) => call('POST', `appointments/${id}/reschedule`, { as, body: { startAt, ...extra } });
  const rows = async (q) => (await db.execute(q)).rows;
  const classify = (s, svc, value) => db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
    jsonb_build_object('v', 1, 'services', coalesce(settings_json -> 'serviceSensitivity' -> 'services', '{}'::jsonb) || jsonb_build_object(${svc}::text, jsonb_build_object('value', ${value}::text, 'reviewedAt', '2026-11-05T10:00:00.000Z', 'reviewedBy', 'seed@example.test', 'reason', 'Classification fictive'))), true) WHERE id = ${s.id}`);
  const unclassify = (s) => db.execute(sql`UPDATE "Structure" SET settings_json = coalesce(settings_json, '{}'::jsonb) - 'serviceSensitivity' WHERE id = ${s.id}`);
  const stub = (vars) => { for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v); };

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}`}, ${s.id}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Accueil social', 30, 0, 0, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc2}, ${s.id}, ${SVC2_NAME}, 30, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    mailer = await import('../../api/_utils/mailer.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proIcs = (await import('../../api/_handlers/pro/appointments/ics.js')).default;
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    for (const s of [A, B]) await seedStructure(s);
    for (const p of [PRO_A, PRO_B]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
    // the same rules for both services: one pool of distinct slot times, each used once
    free.push(...(await slotsOf(A, C[0], A.svc)));
    expect(free.length).toBeGreaterThan(30);
  }, 60000);

  afterEach(async () => { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); if (db) await unclassify(A); });

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, B]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${s.id}`);
    }
    for (const p of [PRO_A, PRO_B]) { await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {}); await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`); }
    for (const s of [A, B]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    for (const c of C) { await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${c.id}`).catch(() => {}); await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {}); }
  });

  // ───────────────────────────── 1. reschedule ─────────────────────────────
  it('reschedule: unreviewed service under enforcement and a verified sensitive service (gate closed) are refused; the appointment is unchanged and still cancellable', async () => {
    const s0 = take(); const ok = await book(A, C[0], s0.startAt, A.svc2);   // LAB: an unreviewed service books
    expect(ok.statusCode, show(ok)).toBe(201);
    const id = ok.body.id;
    const before = (await rows(sql`SELECT "startAt", status, "rescheduleCount" FROM "ProAppointment" WHERE id = ${id}`))[0];

    stub({ ADA_SENSITIVITY_REVIEW_ENFORCED: '1' });
    const unreviewed = await move(id, C[0], take().startAt);
    expect([unreviewed.statusCode, unreviewed.body.code], show(unreviewed)).toEqual([409, 'SERVICE_SENSITIVITY_UNREVIEWED']);
    vi.unstubAllEnvs(); stub({ MAILER_PROVIDER: 'test', MAILER_FROM: 'noreply@example.test' });

    await classify(A, A.svc2, 'sensitive');   // reclassified after booking; the art. 9 gate stays closed — refused even without enforcement (LAB)
    const sensitive = await move(id, C[0], take().startAt);
    expect([sensitive.statusCode, sensitive.body.code], show(sensitive)).toEqual([409, 'SENSITIVE_BOOKING_NOT_OPEN']);
    expect(JSON.stringify(sensitive.body)).not.toMatch(/addictolog|sensible|santé/i);   // neutral: the rule of the service's online booking, never the person
    const after = (await rows(sql`SELECT "startAt", status, "rescheduleCount" FROM "ProAppointment" WHERE id = ${id}`))[0];
    expect(after).toEqual(before);
    // someone else (and an unknown id) gets the plain 404 before any rule is evaluated — no oracle on the service's classification
    const other = await move(id, C[1], take().startAt); const unknown = await move(`nope-${TS}`, C[1], take().startAt);
    expect([other.statusCode, other.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(other.statusCode).toBe(404);
    // the existing appointment can still be cancelled by the person
    const cx = await call('POST', `appointments/${id}/cancel`, { as: C[0], body: {} });
    expect(cx.statusCode, show(cx)).toBe(200);
    // no AuditLog row of the citizen's actions mentions the sensitivity or the service
    const audit = await rows(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE entity_id = ${id} OR details::text LIKE ${'%' + id + '%'}`);
    for (const a of audit) expect(`${a.action} ${a.d}`).not.toMatch(/sensitiv|addictolog/i);
  });

  it('reschedule: a verified ordinary service moves under enforcement; the move of a non-ordinary service sends the minimal notice (no .ics, no service, no structure)', async () => {
    await classify(A, A.svc, 'ordinary');
    stub({ ADA_SENSITIVITY_REVIEW_ENFORCED: '1' });
    const b = await book(A, C[0], take().startAt, A.svc);
    expect(b.statusCode, show(b)).toBe(201);
    const target = take();
    mailer.__clearTestOutbox();
    const m = await move(b.body.id, C[0], target.startAt);
    expect([m.statusCode, m.body.startsAt], show(m)).toEqual([200, target.startAt]);
    const reduced = mailer.__getTestOutbox().filter((x) => x.to === C[0].email);
    expect(reduced.length).toBe(1);
    expect((reduced[0].attachments || []).some((x) => /calendar/.test(String(x.contentType || x.content_type || ''))), 'ordinary: the updated event is attached').toBe(true);

    // LAB, unreviewed: the move is allowed, the notice is minimal (unknown is treated as sensitive for notifications)
    vi.unstubAllEnvs(); stub({ MAILER_PROVIDER: 'test', MAILER_FROM: 'noreply@example.test' });
    const u = await book(A, C[0], take().startAt, A.svc2);
    expect(u.statusCode, show(u)).toBe(201);
    mailer.__clearTestOutbox();
    const mu = await move(u.body.id, C[0], take().startAt);
    expect(mu.statusCode, show(mu)).toBe(200);
    const minimal = mailer.__getTestOutbox().filter((x) => x.to === C[0].email);
    expect(minimal.length).toBe(1);
    expect(minimal[0].attachments || []).toEqual([]);
    const all = `${minimal[0].subject}\n${minimal[0].text}\n${minimal[0].html}`;
    for (const leak of [SVC2_NAME, A.name, A.slug, u.body.id, '.ics']) expect(all).not.toContain(leak);
  });

  it('reschedule with the art. 9 gate open (tests only): a sensitive service needs the active consent of THIS appointment; given now it is recorded (channel « reschedule »)', async () => {
    const b = await book(A, C[1], take().startAt, A.svc2);   // booked while unreviewed (LAB), no art. 9 consent exists
    expect(b.statusCode, show(b)).toBe(201);
    await classify(A, A.svc2, 'sensitive');
    stub(OPEN);
    const t1 = take();
    const refused = await move(b.body.id, C[1], t1.startAt);
    expect([refused.statusCode, refused.body.code], show(refused)).toEqual([400, 'SENSITIVE_CONSENT_REQUIRED']);
    expect((await rows(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${C[1].id} AND purpose = 'SENSITIVE_SERVICE_BOOKING_ART9'`))[0].n).toBe(0);
    const pre = await move(b.body.id, C[1], t1.startAt, { sensitiveConsent: 'yes' });   // only the boolean true counts
    expect(pre.statusCode).toBe(400);
    const ok = await move(b.body.id, C[1], t1.startAt, { sensitiveConsent: true });
    expect(ok.statusCode, show(ok)).toBe(200);
    const log = await rows(sql`SELECT decision, collection_channel AS ch, policy_hash AS h FROM "ConsentLog" WHERE subject_id = ${C[1].id} AND purpose = 'SENSITIVE_SERVICE_BOOKING_ART9'`);
    expect(log.map((r) => [r.decision, r.ch])).toEqual([[true, 'reschedule']]);
    expect(log[0].h).toContain(b.body.id);
    const again = await move(b.body.id, C[1], take().startAt);   // the consent is active: no second box
    expect(again.statusCode, show(again)).toBe(200);
  });

  // ───────────────────────────── 2. professional-created ─────────────────────────────
  it('professional-created: same rule (LAB unknown books; enforced unknown and closed sensitive refused; gate open needs the recorded agreement); other structure = 404', async () => {
    const create = (who, svc, startAt, extra = {}) => invoke(proList, who, { method: 'POST', url: '/api/pro/appointments', body: { serviceId: svc, startAt, beneficiaryName: 'Personne Fictive', personConsent: true, ...extra } });
    const lab = await create(PRO_A, A.svc2, take().startAt);
    expect(lab.statusCode, show(lab)).toBe(201);

    stub({ ADA_SENSITIVITY_REVIEW_ENFORCED: '1' });
    const unreviewed = await create(PRO_A, A.svc2, take().startAt);
    expect([unreviewed.statusCode, unreviewed.body.code], show(unreviewed)).toEqual([409, 'SERVICE_SENSITIVITY_UNREVIEWED']);
    await classify(A, A.svc, 'ordinary');
    const ordinary = await create(PRO_A, A.svc, take().startAt);
    expect(ordinary.statusCode, show(ordinary)).toBe(201);
    vi.unstubAllEnvs(); stub({ MAILER_PROVIDER: 'test', MAILER_FROM: 'noreply@example.test' });

    await classify(A, A.svc2, 'sensitive');
    const closed = await create(PRO_A, A.svc2, take().startAt);
    expect([closed.statusCode, closed.body.code], show(closed)).toEqual([409, 'SENSITIVE_BOOKING_NOT_OPEN']);
    stub(OPEN);
    const t = take();
    const noAgreement = await create(PRO_A, A.svc2, t.startAt);
    expect([noAgreement.statusCode, noAgreement.body.code], show(noAgreement)).toEqual([400, 'SENSITIVE_CONSENT_REQUIRED']);
    const agreed = await create(PRO_A, A.svc2, t.startAt, { sensitiveConsent: true });
    expect(agreed.statusCode, show(agreed)).toBe(201);
    // nothing about the classification is written to AuditLog by the professional path
    for (const a of await rows(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE actor_id = ${PRO_A.id}`)) expect(`${a.action} ${a.d}`).not.toMatch(/sensitiv|addictolog/i);
    // another structure's service: the same 404 as an unknown id (no existence oracle), whatever its classification
    const foreign = await create(PRO_B, A.svc2, take().startAt, { sensitiveConsent: true });
    const unknownSvc = await create(PRO_B, `nope-${TS}`, take().startAt);
    expect([foreign.statusCode, foreign.body]).toEqual([unknownSvc.statusCode, unknownSvc.body]);
    expect(foreign.statusCode).toBe(404);
  });

  // ───────────────────────────── 3. agenda export ─────────────────────────────
  it('agenda export (.ics): a verified sensitive service is never named; an unreviewed one only in LAB; an ordinary one is; no other structure\'s event', async () => {
    const sens = await book(A, C[0], take().startAt, A.svc2); expect(sens.statusCode, show(sens)).toBe(201);
    const ord = await book(A, C[0], take().startAt, A.svc); expect(ord.statusCode, show(ord)).toBe(201);
    const bSlot = (await slotsOf(B, C[1], B.svc))[0];
    const foreign = await book(B, C[1], bSlot.startAt, B.svc); expect(foreign.statusCode, show(foreign)).toBe(201);
    const exportOf = async (who) => { const r = await invoke(proIcs, who, { url: '/api/pro/appointments/ics' }); expect(r.statusCode, show(r)).toBe(200); return String(r.body); };
    const unfold = (ics) => ics.replace(/\r\n /g, '');

    let ics = unfold(await exportOf(PRO_A));   // LAB, nothing reviewed: names kept (as the launcher's agenda journey expects)
    expect(ics).toContain(`SUMMARY:RDV - ${SVC2_NAME}`);
    expect(ics).not.toContain(foreign.body.id);
    expect(ics).not.toContain(C[0].email);

    stub({ ADA_SENSITIVITY_REVIEW_ENFORCED: '1' });   // enforced, nothing reviewed: every event neutral
    ics = unfold(await exportOf(PRO_A));
    expect(ics).not.toContain(SVC2_NAME); expect(ics).not.toContain('Accueil social');
    expect(ics).toContain(`UID:${sens.body.id}@accesdirectaide.fr`);
    expect(ics).toContain('SUMMARY:RDV - Rendez-vous');
    vi.unstubAllEnvs(); stub({ MAILER_PROVIDER: 'test', MAILER_FROM: 'noreply@example.test' });

    await classify(A, A.svc2, 'sensitive'); await classify(A, A.svc, 'ordinary');   // LAB, reviewed: sensitive neutral, ordinary named
    ics = unfold(await exportOf(PRO_A));
    expect(ics).not.toContain(SVC2_NAME);
    expect(ics).toContain('SUMMARY:RDV - Accueil social');
    const other = unfold(await exportOf(PRO_B));
    expect(other).toContain(foreign.body.id);
    for (const id of [sens.body.id, ord.body.id]) expect(other).not.toContain(id);
  });

  // ───────────────────────────── 4. isolation ─────────────────────────────
  it('isolation: another structure\'s professional neither lists, changes, cancels nor exports an appointment; another citizen cannot read, cancel or move it', async () => {
    const b = await book(A, C[0], take().startAt, A.svc); expect(b.statusCode, show(b)).toBe(201);
    const id = b.body.id;
    const listB = await invoke(proList, PRO_B, { url: `/api/pro/appointments?id=${id}`, query: { id } });
    expect(listB.body.items?.length ?? 0).toBe(0);
    const patchB = await invoke(proList, PRO_B, { method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body: { id, status: 'cancelled' } });
    expect(patchB.statusCode).toBe(404);
    const decideB = await invoke(proList, PRO_B, { method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body: { id, decision: 'REFUSE' } });
    expect(decideB.statusCode).toBe(404);
    const cancelB = await invoke((await import('../../api/_handlers/pro/appointments/cancel.js')).default, PRO_B, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id } });
    expect(cancelB.statusCode).toBe(404);
    const readC1 = await call('GET', `appointments/${id}`, { as: C[1] }); const readNone = await call('GET', `appointments/nope-${TS}`, { as: C[1] });
    expect([readC1.statusCode, readC1.body]).toEqual([readNone.statusCode, readNone.body]);
    const cancelC1 = await call('POST', `appointments/${id}/cancel`, { as: C[1], body: {} });
    expect([401, 403, 404]).toContain(cancelC1.statusCode);
    const mineC1 = await call('GET', 'appointments', { as: C[1] });
    expect((mineC1.body.appointments || []).some((x) => x.id === id)).toBe(false);
    const status = (await rows(sql`SELECT status FROM "ProAppointment" WHERE id = ${id}`))[0].status;
    expect(status).toBe('confirmed');
  });

  // ───────────────────────────── 5. channel status ─────────────────────────────
  it('channel status (rdv-settings GET): four channels, honest states, variable names only — a configured secret value never appears', async () => {
    const r0 = await invoke(proSettings, PRO_A, { url: '/api/pro/rdv-settings' });
    expect(r0.statusCode, show(r0)).toBe(200);
    expect(r0.body.channels.map((c) => [c.channel, c.state])).toEqual([['email', 'TEST'], ['sms', 'OFF'], ['video', 'OFF'], ['calendar', 'OFF']]);
    expect(r0.body.channels.every((c) => c.reachesPeople === false)).toBe(true);
    const SECRET = `s3cr3t-${TS}`;
    stub({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: `pub-${SECRET}:priv-${SECRET}`, MAILER_FROM: 'noreply@example.test', MAILER_MAILJET_SANDBOX: '1',
      TWILIO_SID: `AC${SECRET}`, TWILIO_AUTH_TOKEN: SECRET, TWILIO_FROM: '+33600000000',
      VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'meet.lab.invalid', VIDEO_JITSI_APP_ID: 'lab', VIDEO_JITSI_SECRET: `${SECRET}${'x'.repeat(32)}`, VIDEO_SANDBOX: 'true',
      OUTLOOK_ENABLED: 'true', OUTLOOK_CLIENT_ID: 'lab-client', OUTLOOK_CLIENT_SECRET: SECRET, OUTLOOK_REDIRECT_URI: 'https://lab.invalid/api/auth/callback/outlook', ADA_VAULT_KEY: 'k'.repeat(40),
      OUTLOOK_AUTHORITY_URL: 'http://127.0.0.1:9/oauth2/v2.0', OUTLOOK_GRAPH_BASE_URL: 'http://127.0.0.1:9/v1.0' });
    const r1 = await invoke(proSettings, PRO_A, { url: '/api/pro/rdv-settings' });
    expect(r1.body.channels.map((c) => [c.channel, c.state, c.reason])).toEqual([
      ['email', 'SANDBOX', 'PROVIDER_SANDBOX'], ['sms', 'BLOCKED', 'STOP_WEBHOOK_NOT_CONFIGURED'], ['video', 'SANDBOX', 'VIDEO_SANDBOX'], ['calendar', 'SANDBOX', 'OUTLOOK_SANDBOX']]);
    expect(JSON.stringify(r1.body)).not.toContain(SECRET);
    expect(r1.body.channels.every((c) => c.reachesPeople === false)).toBe(true);
  });
});
