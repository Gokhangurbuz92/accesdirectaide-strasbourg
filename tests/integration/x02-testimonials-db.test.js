/**
 * X02 (expansion) — testimonials on REAL PostgreSQL (migration 0054), through the real API entry (api/index.js: CSRF, routing, beta and capability gates)
 * with signed sessions:
 *   - CLOSED in the current Production configuration (restricted beta, surfaces admin + accounts) and in Production without the beta: every route of the
 *     « testimonials » surface answers 503 before its handler, whoever asks; opening needs the « testimonials » surface AND « community.testimonials »;
 *   - submit: anonymous 401, adult accounts only, explicit consent with the current wording version, a chosen first name / pseudonym, one active testimonial
 *     per account; the consent is a ConsentLog row written with it; nothing public before moderation;
 *   - moderation: no session 401, no MFA 403 (reading the queue too), approve (problems refused), reject (text erased, reason kept), takedown, dismiss the
 *     reports; every read and decision audited; the moderator never sees the account, its e-mail or who reported;
 *   - publication: only the chosen name, the text, its language and the date;
 *   - report: account needed, closed list, once per account and testimonial, never one's own, a daily limit;
 *   - withdrawal at any time: gone from the public answer at once, text and name erased, the withdrawal in ConsentLog, the reports deleted;
 *   - cross-account isolation; the database's own CHECKs;
 *   - DSR: export sections, erasure (approved DSR) and purge step 6c delete the testimonials and reports.
 * FIXTURES: every account and every text below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » texts); they are deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const u = (k) => ({ id: `x02-${k}-${TS}`, email: `x02-${k}-${TS}@example.test` });
const A = u('a'); const B = u('b'); const D = u('d'); const E = u('e'); const NODECL = u('nodecl'); const MINOR = u('minor');
const F = [1, 2, 3, 4, 5, 6].map((i) => u(`f${i}`));
const ALL = [A, B, D, E, NODECL, MINOR, ...F];
const ADMIN = `x02-admin-${TS}@example.test`;
const DAY = 86400e3;
const TEXT_A = `FIXTURE SYNTHÉTIQUE ${TS} — le service m’a aidée à trouver une permanence près de chez moi.`;
const TEXT_B = `FIXTURE SYNTHÉTIQUE ${TS} — un deuxième texte de test, qui sera refusé par la modération.`;
const VERSION = 'x02-2026-11-19-lab-proposal';

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('X02 testimonials (real DB, real API entry)', () => {
  let db; let api; let userAuth; let auth;
  const CSRF = 'x02csrftoken0123456789abcdef';
  const sessionOf = (x) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: x.id, email: x.email })).split(';')[0];
  const adminBearer = (mfa = true) => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa });
  const call = async (method, url, { as, body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:5184', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mine = (as) => call('GET', '/api/citizen/testimonials', { as });
  const act = (as, body) => call('POST', '/api/citizen/testimonials', { as, body });
  const submit = (as, over = {}) => act(as, { action: 'submit', displayName: 'Fixture', body: TEXT_A, lang: 'fr', consent: true, consentVersion: VERSION, ...over });
  const queue = (q, opts = {}) => call('GET', `/api/admin/testimonials?queue=${q}`, { bearer: opts.bearer ?? adminBearer() });
  const moderate = (body) => call('POST', '/api/admin/testimonials', { bearer: adminBearer(), body: { facts: 'FIXTURE : faits de test pour l’exposé des motifs.', ...body } });
  const publicList = async () => (await call('GET', '/api/testimonials')).body.items;
  const one = async (q) => (await db.execute(q)).rows[0];
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const ids = () => sql.join(ALL.map((x) => sql`${x.id}`), sql`, `);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    userAuth = await import('../../api/_utils/user-auth.js');
    auth = await import('../../api/_utils/auth.js');
    // G14: the moderation functions need NAMED persons (fail closed) — synthetic MFA administrator accounts hold the roles for this test
    await (await import('../helpers/g14-moderation-staff.js')).seedModerationStaff(db, ADMIN);
    const { recordAgeDeclaration } = await import('../../api/_utils/age-policy.js');
    for (const x of ALL) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${x.id}, ${x.email}, 'x', NOW(), NOW())`);
    for (const x of ALL.filter((y) => y !== NODECL)) await recordAgeDeclaration(x.id, { adult: true, channel: 'signup' }, db);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${MINOR.id}, 'moins-de-18', NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await (await import('../helpers/g14-moderation-staff.js')).clearModerationStaff(db, ADMIN);
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${ids()})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${ids()})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${ids()})`);
  });

  describe('closed by default (fail-closed)', () => {
    const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '' };
    const probes = async () => [await call('GET', '/api/testimonials'), await mine(A), await submit(A),
      await act(A, { action: 'report', id: '00000000-0000-4000-8000-000000000000', reason: 'OFFENSIVE' }),
      await queue('pending'), await moderate({ action: 'approve', id: '00000000-0000-4000-8000-000000000000' })];
    it('the current Production configuration (beta, admin + accounts open) refuses every testimonials route 503 — admin and citizen sessions included', async () => {
      await withEnv(PROD_NOW, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body.error).toBe('PUBLIC_BETA_RESTRICTED'); } });
    });
    it('Production without the beta, or with the surface opened but the capability not listed: 503 CAPABILITY_NOT_OPEN, nothing written', async () => {
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: 'community.events' },
        { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: 'community.testimonials' }); } });
      }
      expect((await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" IN (${ids()})`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'TESTIMONIAL_PUBLICATION' AND subject_id IN (${ids()})`)).n).toBe(0);
    });
    it('the deliberate opening (surface « testimonials » AND « community.testimonials » listed) serves the routes', async () => {
      await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials', ADA_CAPABILITIES_OPEN: 'community.testimonials' }, async () => {
        const r = await call('GET', '/api/testimonials'); expect(r.statusCode).toBe(200); expect(Array.isArray(r.body.items)).toBe(true);
        expect(r.headers['cache-control']).toBe('no-store');
      });
    });
  });

  describe('submission with consent', () => {
    it('anonymous 401; no adult declaration or the minor band 403; no consent, an old wording version, a full name or a phone number 400 — nothing stored', async () => {
      expect((await act(null, { action: 'submit' })).statusCode).toBe(401);
      for (const x of [NODECL, MINOR]) { const r = await submit(x); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('ADULT_ACCOUNT_REQUIRED'); }
      expect((await submit(A, { consent: 'true' })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { consent: undefined })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { consentVersion: 'old' })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { displayName: 'Marie Dupont' })).body.error).toBe('DISPLAY_NAME_INVALID');
      expect((await submit(A, { displayName: A.email })).body.error).toBe('DISPLAY_NAME_INVALID');
      expect((await submit(A, { body: `${TEXT_A} Appelez-moi au 06 12 34 56 78.` })).body.error).toBe('PHONE_IN_TEXT');
      expect((await submit(A, { lang: 'xx' })).body.error).toBe('LANG_REQUIRED');
      expect((await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" IN (${ids()})`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'TESTIMONIAL_PUBLICATION' AND subject_id IN (${ids()})`)).n).toBe(0);
    });
    it('A submits: pending, with ONE consent row (purpose, version, the testimonial id, explicit box); a second one 409; not public before moderation', async () => {
      const r = await submit(A, { displayName: 'Fixture' });
      expect(r.statusCode).toBe(201); expect(r.body.testimonialStatus).toBe('pending');
      const c = (await db.execute(sql`SELECT decision, policy_version, policy_hash, proof_level, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${A.id} AND purpose = 'TESTIMONIAL_PUBLICATION'`)).rows;
      expect(c).toEqual([{ decision: true, policy_version: VERSION, policy_hash: `${VERSION}:TESTIMONIAL_PUBLICATION:${r.body.id}`, proof_level: 'EXPLICIT_CHECKBOX', withdrawn_at: null }]);
      expect((await submit(A)).body.error).toBe('ALREADY_SUBMITTED');
      expect((await publicList()).map((x) => x.id)).not.toContain(r.body.id);
      const m = (await mine(A)).body;
      expect(m).toMatchObject({ available: true, canSubmit: false, consentVersion: VERSION });
      expect(m.testimonials[0]).toMatchObject({ id: r.body.id, status: 'pending', displayName: 'Fixture', body: TEXT_A, lang: 'fr' });
      expect((await submit(B, { displayName: 'Fixture-B', body: TEXT_B })).statusCode).toBe(201);
    });
  });

  describe('moderation and publication', () => {
    let idA; let idB;
    beforeAll(async () => {
      idA = (await mine(A)).body.testimonials[0].id; idB = (await mine(B)).body.testimonials[0].id;
    });
    it('no session 401; a citizen session is not a moderator; reading the queue without MFA 403', async () => {
      expect((await call('GET', '/api/admin/testimonials?queue=pending')).statusCode).toBe(401);
      expect((await call('GET', '/api/admin/testimonials?queue=pending', { as: A })).statusCode).toBe(401);
      const r = await queue('pending', { bearer: adminBearer(false) });
      expect(r.statusCode).toBe(403); expect(r.body.error).toBe('HUMAN_MFA_SESSION_REQUIRED');
    });
    it('the pending queue shows the text, the chosen name and the language — never the account or its e-mail; the read is audited', async () => {
      const r = await queue('pending');
      expect(r.statusCode).toBe(200);
      const item = r.body.items.find((x) => x.id === idA);
      expect(item).toMatchObject({ displayName: 'Fixture', body: TEXT_A, lang: 'fr', problems: [], reports: { total: 0, reasons: {} } });
      const raw = JSON.stringify(r.body);
      for (const x of [A, B]) { expect(raw).not.toContain(x.id); expect(raw).not.toContain(x.email); }
      expect(raw).not.toContain('citizenUserId');
      expect((await one(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'TESTIMONIAL_QUEUE_READ' AND actor = ${ADMIN}`)).n).toBeGreaterThanOrEqual(1);
    });
    it('a reject needs a reason; it ERASES the text and the name; the person sees the state and the reason; approve refused afterwards', async () => {
      expect((await moderate({ action: 'reject', id: idB })).body.error).toBe('REASON_REQUIRED');
      expect((await moderate({ action: 'reject', id: idB, reason: 'OFF_TOPIC' })).statusCode).toBe(200);
      expect(await one(sql`SELECT status, body, "displayName", "moderationReason" FROM "Testimonial" WHERE id = ${idB}`)).toEqual({ status: 'rejected', body: null, displayName: null, moderationReason: 'OFF_TOPIC' });
      expect((await mine(B)).body.testimonials[0]).toMatchObject({ status: 'rejected', body: null, moderationReason: 'OFF_TOPIC' });
      expect((await moderate({ action: 'approve', id: idB })).body.error).toBe('NOT_PENDING');
      expect((await mine(B)).body.canSubmit).toBe(true);
    });
    it('approval of a text with entitlement wording is refused with the problem; A’s is published: the public answer has the name, text, language, date only', async () => {
      expect((await submit(B, { displayName: 'Fixture-B', body: `${TEXT_B} Vous avez droit à cette aide.` })).statusCode).toBe(201);
      const bad = (await mine(B)).body.testimonials.find((x) => x.status === 'pending');
      const refused = await moderate({ action: 'approve', id: bad.id });
      expect(refused.statusCode).toBe(422); expect(refused.body.problems).toContain('ENTITLEMENT_WORDING');
      expect((await moderate({ action: 'approve', id: idA })).body).toEqual({ id: idA, status: 'published' });
      const item = (await publicList()).find((x) => x.id === idA);
      expect(Object.keys(item).sort()).toEqual(['body', 'displayName', 'id', 'lang', 'publishedAt']);
      expect(item).toMatchObject({ displayName: 'Fixture', body: TEXT_A, lang: 'fr' });
      const raw = JSON.stringify(await publicList());
      for (const s of [A.id, A.email, ADMIN, 'moderatedBy', 'consentVersion', 'citizenUserId']) expect(raw).not.toContain(s);
      const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'Testimonial' AND entity_id IN (${idA}, ${idB})`)).rows.map((x) => x.action);
      expect(audit).toEqual(expect.arrayContaining(['TESTIMONIAL_APPROVE', 'TESTIMONIAL_REJECT']));
      expect((await moderate({ action: 'reject', id: bad.id, reason: 'MISLEADING' })).statusCode).toBe(200);
    });
  });

  describe('reports of abuse', () => {
    let idA;
    beforeAll(async () => { idA = (await mine(A)).body.testimonials.find((x) => x.status === 'published').id; });
    it('account needed (401); a closed list (400); never one’s own (409); once per account (409); the moderator sees counts per reason, never who', async () => {
      expect((await act(null, { action: 'report', id: idA, reason: 'OFFENSIVE' })).statusCode).toBe(401);
      expect((await act(D, { action: 'report', id: idA, reason: 'texte libre' })).body.error).toBe('UNKNOWN_REASON');
      expect((await act(A, { action: 'report', id: idA, reason: 'OFFENSIVE' })).body.error).toBe('OWN_TESTIMONIAL');
      expect((await act(D, { action: 'report', id: idA, reason: 'HEALTH_DETAIL' })).statusCode).toBe(201);
      expect((await act(D, { action: 'report', id: idA, reason: 'OFFENSIVE' })).body.error).toBe('ALREADY_REPORTED');
      expect((await act(E, { action: 'report', id: idA, reason: 'HEALTH_DETAIL' })).statusCode).toBe(201);
      // a report never hides a testimonial by itself
      expect((await publicList()).map((x) => x.id)).toContain(idA);
      const r = await queue('reported');
      const item = r.body.items.find((x) => x.id === idA);
      expect(item.reports).toEqual({ total: 2, reasons: { HEALTH_DETAIL: 2 } });
      const raw = JSON.stringify(r.body);
      for (const x of [D, E, A]) { expect(raw).not.toContain(x.id); expect(raw).not.toContain(x.email); }
    });
    it('dismissing the reports keeps the testimonial and deletes the reports', async () => {
      expect((await moderate({ action: 'dismiss_reports', id: idA })).body).toMatchObject({ dismissed: 2, status: 'published' });
      expect((await one(sql`SELECT count(*)::int n FROM "TestimonialReport" WHERE "testimonialId" = ${idA}`)).n).toBe(0);
      expect((await queue('reported')).body.items.map((x) => x.id)).not.toContain(idA);
      expect((await act(D, { action: 'report', id: idA, reason: 'MISLEADING' })).statusCode).toBe(201);
    });
    it('a daily limit per account: the sixth report within 24 h is refused 429', async () => {
      // SYNTHETIC FIXTURES: six published testimonials of fixture accounts F1…F6, written directly (moderation tested above)
      const fx = [];
      for (const f of F) {
        const id = crypto.randomUUID(); fx.push(id);
        await db.execute(sql`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "moderatedBy", "moderatedAt", "publishedAt", "updatedAt")
          VALUES (${id}, ${f.id}, 'published', 'Fixture', ${`FIXTURE SYNTHÉTIQUE ${TS} — témoignage de test numéro ${f.id}.`}, 'fr', ${VERSION}, ${ADMIN}, NOW(), NOW(), NOW())`);
      }
      // E's earlier report was dismissed (deleted): five reports pass, the sixth within 24 h is refused
      for (const id of fx.slice(0, 5)) expect((await act(E, { action: 'report', id, reason: 'ADVERTISING' })).statusCode).toBe(201);
      const r = await act(E, { action: 'report', id: fx[5], reason: 'ADVERTISING' });
      expect(r.statusCode).toBe(429); expect(r.body.error).toBe('REPORT_LIMIT');
      // a takedown erases the text and deletes its reports
      expect((await moderate({ action: 'takedown', id: fx[0] })).body.error).toBe('REASON_REQUIRED');
      expect((await moderate({ action: 'takedown', id: fx[0], reason: 'ADVERTISING' })).statusCode).toBe(200);
      expect(await one(sql`SELECT status, body, "displayName" FROM "Testimonial" WHERE id = ${fx[0]}`)).toEqual({ status: 'taken_down', body: null, displayName: null });
      expect((await one(sql`SELECT count(*)::int n FROM "TestimonialReport" WHERE "testimonialId" = ${fx[0]}`)).n).toBe(0);
      expect((await publicList()).map((x) => x.id)).not.toContain(fx[0]);
    });
  });

  describe('withdrawal at any time, isolation, database checks', () => {
    let idA;
    beforeAll(async () => { idA = (await mine(A)).body.testimonials.find((x) => x.status === 'published').id; });
    it('another account cannot see or withdraw it (404, same as unknown)', async () => {
      expect(JSON.stringify((await mine(D)).body)).not.toContain(idA);
      const r = await act(D, { action: 'withdraw', id: idA });
      expect(r.statusCode).toBe(404); expect(r.body.error).toBe('TESTIMONIAL_NOT_FOUND');
      expect((await act(D, { action: 'withdraw', id: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
      expect((await one(sql`SELECT status FROM "Testimonial" WHERE id = ${idA}`)).status).toBe('published');
    });
    it('A withdraws the published testimonial: gone from the next public answer, text and name erased, withdrawal in ConsentLog, reports deleted', async () => {
      expect((await publicList()).map((x) => x.id)).toContain(idA);
      const r = await act(A, { action: 'withdraw', id: idA });
      expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ testimonialStatus: 'withdrawn', erased: true });
      expect((await publicList()).map((x) => x.id)).not.toContain(idA);
      const row = await one(sql`SELECT status, body, "displayName", "withdrawnAt" FROM "Testimonial" WHERE id = ${idA}`);
      expect(row).toMatchObject({ status: 'withdrawn', body: null, displayName: null }); expect(row.withdrawnAt).toBeTruthy();
      const c = (await db.execute(sql`SELECT decision, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${A.id} AND policy_hash = ${`${VERSION}:TESTIMONIAL_PUBLICATION:${idA}`} ORDER BY created_at`)).rows;
      expect(c.map((x) => x.decision)).toEqual([true, false]); expect(c[1].withdrawn_at).toBeTruthy();
      expect((await one(sql`SELECT count(*)::int n FROM "TestimonialReport" WHERE "testimonialId" = ${idA}`)).n).toBe(0);
      expect((await act(A, { action: 'withdraw', id: idA })).statusCode).toBe(404);
      // a moderator cannot publish it again
      expect((await moderate({ action: 'approve', id: idA })).body.error).toBe('NOT_PENDING');
      // a pending one can be withdrawn too, and a new one written afterwards
      const again = await submit(A, { displayName: 'Lune', body: `${TEXT_A} (deuxième)` });
      expect(again.statusCode).toBe(201);
      expect((await act(A, { action: 'withdraw', id: again.body.id })).statusCode).toBe(200);
      expect((await submit(A, { displayName: 'Lune' })).statusCode).toBe(201);
    });
    it('the database itself refuses text on an erased testimonial and a second active testimonial for one account', async () => {
      const bad = (q) => db.execute(q).then(() => 'ACCEPTED', (e) => `${e?.message} ${e?.cause?.message || ''}`);
      expect(await bad(sql`UPDATE "Testimonial" SET body = ${TEXT_A}, "displayName" = 'Xy' WHERE id = ${idA}`)).toMatch(/Testimonial_text_state_check/);
      expect(await bad(sql`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "updatedAt") VALUES (${crypto.randomUUID()}, ${A.id}, 'pending', 'Xy', ${TEXT_A}, 'fr', ${VERSION}, NOW())`)).toMatch(/Testimonial_active_user_key/);
      expect(await bad(sql`INSERT INTO "TestimonialReport" (id, "testimonialId", "reporterUserId", reason) VALUES (${crypto.randomUUID()}, ${idA}, ${D.id}, 'texte libre')`)).toMatch(/TestimonialReport_reason_check/);
    });
  });

  describe('DSR export, erasure and purge step 6c', () => {
    it('the export of A lists A’s testimonials (states, no text once erased); D’s export lists D’s reports; neither shows the other', async () => {
      const exp = async (x) => { const r = await call('GET', '/api/auth/export-data', { as: x }); expect(r.statusCode).toBe(200); return typeof r.body === 'string' ? JSON.parse(r.body) : r.body; };
      const a = await exp(A);
      expect(a.testimonials.map((x) => x.status)).toEqual(expect.arrayContaining(['withdrawn', 'pending']));
      expect(a.testimonials.find((x) => x.status === 'withdrawn').body).toBeNull();
      expect(a.testimonialReports).toEqual([]);
      // D's earlier report went with the withdrawn testimonial: D reports a published fixture testimonial now
      const [fx] = (await db.execute(sql`SELECT id FROM "Testimonial" WHERE status = 'published' AND "citizenUserId" IN (${sql.join(F.map((f) => sql`${f.id}`), sql`, `)}) LIMIT 1`)).rows;
      expect((await act(D, { action: 'report', id: fx.id, reason: 'OFF_TOPIC' })).statusCode).toBe(201);
      const d = await exp(D);
      expect(d.testimonials).toEqual([]);
      expect(d.testimonialReports.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(d.testimonialReports[0]).sort()).toEqual(['createdAt', 'reason', 'testimonialId']);
      expect(JSON.stringify(d)).not.toContain(A.id);
    });
    it('an approved erasure deletes the person’s testimonials and reports (cascade); other accounts keep theirs; the consent proofs stay in the ledger', async () => {
      const others = (await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" <> ${A.id}`)).n;
      const privacy = await import('../../api/_services/privacy.js');
      const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
      for (const x of [A, D]) {
        const req = await svc.requestDeletion(x.id);
        await svc.updateDsrRequestStatus(req.id, 'APPROVED');
        await svc.executeApprovedDeletion(req.id);
      }
      expect((await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" = ${A.id}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "TestimonialReport" WHERE "reporterUserId" = ${D.id}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" <> ${A.id}`)).n).toBe(others);
    });
    it('purge step 6c (unverified accounts after 7 days) takes any testimonial of such an account with it', async () => {
      const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const step = PURGE_STEPS.find((s) => s.id === 'unverifiedAccountsDeleted');
      const U = u('unverified'); ALL.push(U);
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW() - interval '9 days', NOW())`);
      const id = crypto.randomUUID();
      await db.execute(sql`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "updatedAt") VALUES (${id}, ${U.id}, 'pending', 'Fixture', ${TEXT_A}, 'fr', ${VERSION}, NOW())`);
      const out = await step.run(db, { cutoff: () => new Date(Date.now() - 7 * DAY) }, { failures: [] });
      expect(out.count).toBeGreaterThanOrEqual(1);
      expect((await one(sql`SELECT count(*)::int n FROM "Testimonial" WHERE id = ${id}`)).n).toBe(0);
    });
  });
});
