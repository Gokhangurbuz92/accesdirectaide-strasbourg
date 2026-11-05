/**
 * R45 — ENG-LR-1 (the booking message withdrawn at ANY time, GDPR art. 7(3)) and ENG-LR-2 (sensitive-service booking, art. 9, CLOSED by default),
 * on a REAL PostgreSQL. Synthetic data only; MAILER_PROVIDER=test (nothing sent).
 *
 * ENG-LR-1: withdrawal after the start and for a past / cancelled appointment succeeds; the appointment stays; another citizen and an unknown id get the
 * same 404; a professional of another structure neither sees nor affects it; the structure's own team can no longer read the message; the structure is
 * told in-app (no content, no e-mail); no message text in AuditLog, ConsentLog or ProNotification rows; a second withdrawal answers NO_MESSAGE.
 * ENG-LR-2: classification default unknown (LAB books, enforced → SERVICE_SENSITIVITY_UNREVIEWED, VERCEL_ENV=production refuses even with the variable at 0);
 * the administrator review (citizen / professional / administrator without MFA / without elevation refused; reason required; audited without personal data);
 * a verified ordinary service books under enforcement; a verified sensitive one is refused while the gate is closed; with the gate open (tests only) it
 * needs the separate explicit consent, recorded in ConsentLog, withdrawable (the upcoming appointment is cancelled); no sensitivity in any AuditLog row of the
 * citizen's actions nor in the structure's notices.
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
const S = (k) => ({ id: `r45c-${k}-${TS}`, slug: `r45c-${k}-slug-${TS}`, svc: `r45c-${k}-svc-${TS}`, svc2: `r45c-${k}-svc2-${TS}`, name: `Structure fictive R45 ${k}` });
const A = S('a'); const B = S('b'); const X = S('x');
const pro = (k, sid) => ({ id: `r45c-p${k}-${TS}`, email: `r45c-p${k}-${TS}@example.test`, sid, role: 'STRUCTURE_ADMIN' });
const PRO_A = pro('a', A.id); const PRO_B = pro('b', B.id); const PRO_X = pro('x', X.id);
const cit = (k) => ({ id: `r45c-c${k}-${TS}`, email: `test.citizen+r45c${k}-${TS}@example.test` });
const C = [cit('0'), cit('1'), cit('2')];
const ADMIN_EMAIL = `r45c-admin-${TS}@example.test`;
const OPEN = { ADA_SENSITIVE_BOOKING_APPROVED: 'art9-explicit-consent-v1', ADA_HDS_BOOKING_ASSESSED: '1' };

describe.skipIf(!hasDatabase)('R45 consent: message withdrawal at any time + sensitive-service booking (real DB)', () => {
  let db, rdv, auth, userAuth, proList, adminRoute, review;
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:5180', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const asPro = (who) => ({ host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` });
  const invoke = async (handler, headers, { method = 'GET', url, body, query = {} } = {}) => { const r = mk(); await handler({ method, url, query, body, headers }, r); return r; };
  const agenda = (who, id) => invoke(proList, asPro(who), { url: `/api/pro/appointments?id=${id}`, query: { id } });
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const slotsOf = async (s, as, svc = s.svc, { from = day(2), to = day(9) } = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: svc, from, to }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots;
  };
  const book = (s, as, startAt, extra = {}, svc = s.svc) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const rows = async (q) => (await db.execute(q)).rows;
  const setClassification = (s, svc, value) => db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
    jsonb_build_object('v', 1, 'services', coalesce(settings_json -> 'serviceSensitivity' -> 'services', '{}'::jsonb) || jsonb_build_object(${svc}::text, jsonb_build_object('value', ${value}::text, 'reviewedAt', '2026-11-05T10:00:00.000Z', 'reviewedBy', 'seed@example.test', 'reason', 'Classification fictive'))), true) WHERE id = ${s.id}`);
  const adminHeaders = (extra) => ({ host: 'x', authorization: `Bearer ${auth.signAdminSessionToken({ email: ADMIN_EMAIL, role: 'admin', ...extra })}` });
  const elevated = () => adminHeaders({ mfa_verified: true, elev_until: Math.floor(Date.now() / 1000) + 600, elev_kind: 'JIT', elev_id: `e-${TS}` });

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}`}, ${s.id}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Accueil social', 30, 0, 0, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc2}, ${s.id}, 'Consultation addictologie fictive', 30, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/service-sensitivity-review.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    adminRoute = (await import('../../api/_handlers/admin/service-sensitivity.js')).default;
    for (const s of [A, B, X]) await seedStructure(s);
    for (const p of [PRO_A, PRO_B, PRO_X]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id));
  }, 60000);

  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); });

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, B, X]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${s.id}`);
    }
    for (const p of [PRO_A, PRO_B, PRO_X]) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    for (const s of [A, B, X]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${ADMIN_EMAIL}`).catch(() => {});
    for (const c of C) { await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${c.id}`).catch(() => {}); await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {}); }
  });

  // ───────────────────────────── ENG-LR-1 ─────────────────────────────
  it('ENG-LR-1: after the start, for a past and for a cancelled appointment the message is withdrawn; the appointment stays; same 404 for others; no content anywhere; idempotent', async () => {
    const MSG = `Message fictif R45 ${TS} interprète`;
    const slots = await slotsOf(A, C[0]);
    const ok = await book(A, C[0], slots[0].startAt, { message: MSG, messageConsent: true });
    expect([ok.statusCode, ok.body.hasMessage, ok.body.canWithdrawMessage], show(ok)).toEqual([201, true, true]);
    const id = ok.body.id;
    const staffA = async () => (await agenda(PRO_A, id)).body.items.find((x) => x.id === id);
    expect((await staffA()).citizenMessage).toBe(MSG);
    // a professional of ANOTHER structure neither sees it nor can touch it
    const other = await agenda(PRO_B, id);
    expect(other.body.items?.some((x) => x.id === id) ?? false).toBe(false);
    expect(JSON.stringify(other.body)).not.toContain(MSG);
    const patch = await invoke(proList, asPro(PRO_B), { method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body: { notes: 'x' } });
    expect([400, 404]).toContain(patch.statusCode);
    expect((await staffA()).citizenMessage, 'unchanged by the other structure').toBe(MSG);
    // the appointment has STARTED (moved into the past): the withdrawal is still accepted (R43 refused it: MESSAGE_WITHDRAWAL_TOO_LATE — the defect)
    await db.execute(sql`UPDATE "ProAppointment" SET "startAt" = NOW() - interval '10 minutes', "endAt" = NOW() + interval '20 minutes' WHERE id = ${id}`);
    const mine = await call('GET', 'appointments', { as: C[0] });
    expect(mine.body.appointments.find((x) => x.id === id).canWithdrawMessage, 'offered after the start').toBe(true);
    const otherCitizen = await call('POST', `appointments/${id}/message/withdraw`, { as: C[1], body: {} });
    const unknown = await call('POST', `appointments/nope-${TS}/message/withdraw`, { as: C[1], body: {} });
    expect([otherCitizen.statusCode, otherCitizen.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(otherCitizen.statusCode).toBe(404);
    const w = await call('POST', `appointments/${id}/message/withdraw`, { as: C[0], body: {} });
    expect([w.statusCode, w.body.hasMessage, w.body.withdrawal?.platformCopy, w.body.withdrawal?.structureCopies], show(w)).toEqual([200, false, 'ERASED', 'STRUCTURE_RESPONSIBILITY']);
    expect(JSON.stringify(w.body)).not.toContain(MSG);
    const after = (await rows(sql`SELECT notes, status FROM "ProAppointment" WHERE id = ${id}`))[0];
    expect([after.notes, after.status], 'message erased, appointment kept').toEqual([null, 'confirmed']);
    expect((await staffA()).citizenMessage, 'the structure can no longer read it').toBeNull();
    // the structure is told, in-app only, without content
    const notes = await rows(sql`SELECT title, message, metadata FROM "ProNotification" WHERE "structureId" = ${A.id} AND type = 'rdv_message_withdrawn'`);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].title).toBe('Message retiré par la personne');
    expect(notes[0].metadata.delivery.email).toBe('NOT_EMAILABLE');
    expect(notes[0].metadata.appointmentId).toBe(id);
    expect((await rows(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" <> ${A.id} AND type = 'rdv_message_withdrawn' AND metadata ->> 'appointmentId' = ${id}`))[0].n).toBe(0);
    // idempotence
    expect((await call('POST', `appointments/${id}/message/withdraw`, { as: C[0], body: {} })).body.code).toBe('NO_MESSAGE');
    // a past and a cancelled appointment
    const past = `r45c-past-${TS}`; const cancelled = `r45c-cancelled-${TS}`;
    for (const [rid, status, offset] of [[past, 'done', '-48'], [cancelled, 'cancelled', '24']]) {
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", notes, "updatedAt")
        VALUES (${rid}, ${A.id}, ${A.svc}, NOW() + (${offset} || ' hours')::interval, NOW() + (${offset} || ' hours')::interval + interval '30 minutes', ${status}, 'Particulier', ${C[0].id}, ${'idem-' + rid}, 'v1:sealed', NOW())`);
      const r = await call('POST', `appointments/${rid}/message/withdraw`, { as: C[0], body: {} });
      expect([r.statusCode, r.body.hasMessage], `${status}: ${show(r)}`).toEqual([200, false]);
      expect((await rows(sql`SELECT notes, status FROM "ProAppointment" WHERE id = ${rid}`))[0]).toEqual({ notes: null, status });
    }
    // the evidence: decision rows only, never the text
    const consent = await rows(sql`SELECT decision, withdrawn_at, policy_version FROM "ConsentLog" WHERE subject_id = ${C[0].id} AND purpose = 'BOOKING_MESSAGE_TRANSMISSION' ORDER BY created_at`);
    expect(consent.map((c) => c.decision)).toEqual([true, false, false, false]);
    expect(consent.every((c) => c.policy_version === 'r45-d3v2-2026-11-05')).toBe(true);
    for (const [table, q] of [['ConsentLog', sql`SELECT row_to_json(c)::text t FROM "ConsentLog" c`], ['AuditLog', sql`SELECT row_to_json(a)::text t FROM "AuditLog" a`],
      ['ProNotification', sql`SELECT row_to_json(n)::text t FROM "ProNotification" n`], ['AppointmentNotice', sql`SELECT row_to_json(n)::text t FROM "AppointmentNotice" n`]]) {
      expect((await rows(q)).filter((r) => r.t.includes(MSG)).length, table).toBe(0);
    }
  });

  // ───────────────────────────── ENG-LR-2 ─────────────────────────────
  it('ENG-LR-2: classification defaults to unknown — LAB books; enforced → SERVICE_SENSITIVITY_UNREVIEWED (slots and booking); production refuses even with the variable at 0', async () => {
    expect(await review.readServiceSensitivity(B.id, B.svc)).toBe('unknown');
    const slots = await slotsOf(B, C[1]);
    const lab = await book(B, C[1], slots[0].startAt);
    expect(lab.statusCode, show(lab)).toBe(201);
    let services = await call('GET', `structures/${B.slug}/services`, { as: C[1] });
    expect(services.body.items.find((i) => i.id === B.svc)).toMatchObject({ onlineBooking: 'OPEN', explicitConsent: false, protectedPrivacy: true });
    vi.stubEnv('ADA_SENSITIVITY_REVIEW_ENFORCED', '1');
    const refused = await book(B, C[1], slots[1].startAt);
    expect([refused.statusCode, refused.body.code], show(refused)).toEqual([409, 'SERVICE_SENSITIVITY_UNREVIEWED']);
    expect(refused.body.message).not.toMatch(/santé|sensible|handicap|addict/i);
    const noSlots = await call('GET', `structures/${B.slug}/slots`, { query: { serviceId: B.svc, from: day(2), to: day(9) }, as: C[1] });
    expect([noSlots.statusCode, noSlots.body.code]).toEqual([409, 'SERVICE_SENSITIVITY_UNREVIEWED']);
    services = await call('GET', `structures/${B.slug}/services`, { as: C[1] });
    expect(services.body.items.find((i) => i.id === B.svc)).toMatchObject({ onlineBooking: 'CONTACT_STRUCTURE', explicitConsent: false });
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ADA_SENSITIVITY_REVIEW_ENFORCED', '0'); vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '0');
    const prod = await book(B, C[1], slots[2].startAt);
    expect([prod.statusCode, prod.body.code], show(prod)).toEqual([409, 'SERVICE_SENSITIVITY_UNREVIEWED']);
    expect((await rows(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${B.id} AND "startAt" IN (${slots[1].startAt}, ${slots[2].startAt})`))[0].n, 'nothing stored').toBe(0);
  });

  it('ENG-LR-2: the administrator review — citizen, professional, administrator without MFA / without elevation refused; reason required; audited without personal data', async () => {
    const BODY = { action: 'review', structureId: X.id, serviceId: X.svc, value: 'ordinary', reason: 'Accueil social généraliste (revue fictive R45)' };
    const tries = [
      [{ host: 'x', cookie: cookie(C[0]) }, 401], [asPro(PRO_X), 401],
      [adminHeaders({ mfa_verified: false }), 403], [adminHeaders({ mfa_verified: true }), 403],
    ];
    for (const [headers, code] of tries) {
      const r = await invoke(adminRoute, headers, { method: 'POST', url: '/api/admin/service-sensitivity', body: BODY });
      expect(r.statusCode, show(r)).toBe(code);
    }
    expect(await review.readServiceSensitivity(X.id, X.svc), 'nothing changed by a refused call').toBe('unknown');
    const noReason = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: { ...BODY, reason: 'court' } });
    expect([noReason.statusCode, noReason.body.error]).toEqual([400, 'reason_required']);
    const foreign = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: { ...BODY, serviceId: A.svc } });
    expect(foreign.statusCode, 'a service of another structure').toBe(404);
    const bad = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: { ...BODY, value: 'SAFE' } });
    expect(bad.body.error).toBe('invalid_value');
    const ok = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: BODY });
    expect([ok.statusCode, ok.body.previous, ok.body.value], show(ok)).toEqual([200, 'unknown', 'ordinary']);
    const sens = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: { ...BODY, serviceId: X.svc2, value: 'sensitive', reason: 'Service d’addictologie (revue fictive R45)' } });
    expect(sens.statusCode).toBe(200);
    const list = await invoke(adminRoute, elevated(), { method: 'POST', url: '/api/admin/service-sensitivity', body: { action: 'list', structureId: X.id } });
    expect(list.statusCode).toBe(200);
    expect(list.body.reviewComplete).toBe(true);
    const item = (sid) => list.body.items.find((i) => i.id === sid);
    expect([item(X.svc).value, item(X.svc).reviewedBy, item(X.svc2).value, item(X.svc2).suggestion]).toEqual(['ordinary', ADMIN_EMAIL, 'sensitive', 'sensitive']);
    expect(item(X.svc).suggestion, 'the heuristic never sets: a suggestion only').toBe('no_signal');
    const audit = await rows(sql`SELECT action, entity, entity_id, details FROM "AuditLog" WHERE action = 'service.sensitivity_reviewed' AND actor_id = ${ADMIN_EMAIL} ORDER BY timestamp`);
    expect(audit.map((a) => [a.entity_id, a.details.previous, a.details.value])).toEqual([[X.svc, 'unknown', 'ordinary'], [X.svc2, 'unknown', 'sensitive']]);
    expect(JSON.stringify(audit)).not.toMatch(/revue fictive|example\.test.*citizen|test\.citizen/);
    // the structure's own team cannot set it: its settings route writes rdvBooking only (and no professional reaches the administrator route: 401 above)
    const proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    await invoke(proSettings, asPro(PRO_X), { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'DIRECT', serviceSensitivity: { services: { [X.svc2]: { value: 'ordinary' } } } } });
    expect(await review.readServiceSensitivity(X.id, X.svc2)).toBe('sensitive');
  });

  it('ENG-LR-2: verified ordinary books under enforcement; verified sensitive is refused while the gate is closed (LAB and production)', async () => {
    await setClassification(A, A.svc, 'ordinary');
    vi.stubEnv('ADA_SENSITIVITY_REVIEW_ENFORCED', '1');
    const slots = await slotsOf(A, C[1], A.svc, { from: day(3), to: day(9) });
    const ok = await book(A, C[1], slots[2].startAt);
    expect(ok.statusCode, show(ok)).toBe(201);
    vi.unstubAllEnvs();
    await setClassification(A, A.svc2, 'sensitive');
    for (const env of [{}, { VERCEL_ENV: 'production' }, { ADA_SENSITIVE_BOOKING_APPROVED: 'art9-explicit-consent-v1' }, { ADA_HDS_BOOKING_ASSESSED: '1' }]) {
      vi.unstubAllEnvs(); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const r = await book(A, C[1], slots[3].startAt, { sensitiveConsent: true }, A.svc2);
      expect([r.statusCode, r.body.code], JSON.stringify(env)).toEqual([409, 'SENSITIVE_BOOKING_NOT_OPEN']);
    }
    vi.unstubAllEnvs();
    const services = await call('GET', `structures/${A.slug}/services`, { as: C[1] });
    expect(services.body.items.find((i) => i.id === A.svc2)).toMatchObject({ onlineBooking: 'CONTACT_STRUCTURE', explicitConsent: false, protectedPrivacy: true });
    expect(services.body.items.find((i) => i.id === A.svc)).toMatchObject({ onlineBooking: 'OPEN', protectedPrivacy: false });
    expect(JSON.stringify(services.body)).not.toMatch(/sensitiv/i);
  });

  it('ENG-LR-2 (gate OPEN, tests only): the separate explicit consent is required, recorded, withdrawable (the upcoming appointment is cancelled); no sensitivity in audit or notices', async () => {
    await setClassification(A, A.svc2, 'sensitive');
    for (const [k, v] of Object.entries(OPEN)) vi.stubEnv(k, v);
    const services = await call('GET', `structures/${A.slug}/services`, { as: C[2] });
    expect(services.body.items.find((i) => i.id === A.svc2)).toMatchObject({ onlineBooking: 'OPEN', explicitConsent: true, protectedPrivacy: true });
    const slots = await slotsOf(A, C[2], A.svc2, { from: day(4), to: day(9) });
    for (const v of [undefined, 'true', 1, false]) {
      const r = await book(A, C[2], slots[0].startAt, v === undefined ? {} : { sensitiveConsent: v }, A.svc2);
      expect([r.statusCode, r.body.code], String(v)).toEqual([400, 'SENSITIVE_CONSENT_REQUIRED']);
    }
    const ok = await book(A, C[2], slots[0].startAt, { sensitiveConsent: true }, A.svc2);
    expect(ok.statusCode, show(ok)).toBe(201);
    const id = ok.body.id;
    const proof = await rows(sql`SELECT decision, proof_level, policy_version, policy_hash, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${C[2].id} AND purpose = 'SENSITIVE_SERVICE_BOOKING_ART9' ORDER BY created_at`);
    expect(proof.map((p) => [p.decision, p.proof_level, p.policy_version, p.policy_hash.endsWith(`:${id}`), p.withdrawn_at])).toEqual([[true, 'EXPLICIT_CHECKBOX', 'r45-p5s-draft-2026-11-05', true, null]]);
    const mine = await call('GET', 'appointments', { as: C[2] });
    expect(mine.body.appointments.find((x) => x.id === id).sensitiveConsent).toBe(true);
    // someone else / unknown: the same 404; the withdrawal is never gated (the gate closes again: still withdrawable)
    const other = await call('POST', `appointments/${id}/sensitive-consent/withdraw`, { as: C[1], body: {} });
    const unknown = await call('POST', `appointments/nope-${TS}/sensitive-consent/withdraw`, { as: C[1], body: {} });
    expect([other.statusCode, other.body]).toEqual([404, unknown.body]);
    vi.unstubAllEnvs();
    const w = await call('POST', `appointments/${id}/sensitive-consent/withdraw`, { as: C[2], body: {} });
    expect([w.statusCode, w.body.status], show(w)).toEqual([200, 'CANCELLED']);
    expect((await rows(sql`SELECT status, "cancelledBy" FROM "ProAppointment" WHERE id = ${id}`))[0]).toEqual({ status: 'cancelled', cancelledBy: 'USER' });
    const after = await rows(sql`SELECT decision, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${C[2].id} AND purpose = 'SENSITIVE_SERVICE_BOOKING_ART9' ORDER BY created_at`);
    expect([after.length, after[1].decision, after[1].withdrawn_at !== null]).toEqual([2, false, true]);
    expect((await call('POST', `appointments/${id}/sensitive-consent/withdraw`, { as: C[2], body: {} })).body.code).toBe('NO_CONSENT');
    expect((await call('GET', 'appointments', { as: C[2] })).body.appointments.find((x) => x.id === id).sensitiveConsent).toBeUndefined();
    // no sensitivity / service category in any AuditLog row of the citizen's actions, nor in the structure's notices of this appointment
    const audit = await rows(sql`SELECT row_to_json(a)::text t FROM "AuditLog" a WHERE actor_id = ${C[2].id} OR entity_id = ${id} OR details::text LIKE ${'%' + id + '%'} OR details::text LIKE ${'%' + C[2].id + '%'}`);
    expect(audit.filter((r) => /sensitiv|addicto|art9|SENSITIVE/i.test(r.t))).toEqual([]);
    const notices = await rows(sql`SELECT row_to_json(n)::text t FROM "ProNotification" n WHERE metadata ->> 'appointmentId' = ${id}`);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.filter((r) => /sensitiv|addicto|art9|accord/i.test(r.t))).toEqual([]);
  });
});
