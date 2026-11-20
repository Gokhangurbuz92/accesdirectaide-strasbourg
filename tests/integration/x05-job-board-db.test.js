/**
 * X05 (expansion) — the inclusive job board on REAL PostgreSQL (migration 0056), through the real API entry (api/index.js: CSRF, routing, beta and capability
 * gates) with signed professional and administrator sessions:
 *   - CLOSED in the current Production configuration (restricted beta, surfaces admin + accounts), with « pro » opened, and in Production without the beta:
 *     every route of the « employment » surface answers 503 before its handler; opening needs the « employment » surface AND « community.employment »;
 *   - employer verification = E01: only a STRUCTURE_ADMIN manages listings, only an ACTIVE and VERIFIED organization sends one to moderation, and a listing of
 *     an organization that loses its verification leaves the public board at once (approval refused too);
 *   - listings: required fields, closed lists, the employer's own application channel, refusal of any discriminatory criterion field (Code du travail L1132-1)
 *     and of any unknown field, entitlement wording and contacts in the text refused;
 *   - lifecycle: draft → pending (not public) → published → expired by its own date; rejected → corrected → resubmitted; withdrawn; taken down;
 *   - moderation: no session 401, no MFA 403 (reading too), approve (problems 422), reject / takedown with a reason from the closed list, audited;
 *   - public reading: only what an applicant needs, no-store; NO applicant data anywhere (no route, no table);
 *   - cross-organization isolation; the professional MFA rule; the organization closure withdraws the open listings.
 * FIXTURES: every organization, account and text below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » texts); they are deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const EMP = `x05-emp-${TS}`, OTHER = `x05-oth-${TS}`, UNVER = `x05-unv-${TS}`;
const pu = (k, st, role) => ({ id: `x05-${k}-${TS}`, email: `x05-${k}-${TS}@example.test`, st, role });
const EA = pu('ea', EMP, 'STRUCTURE_ADMIN'); const EP = pu('ep', EMP, 'PRO'); const OA = pu('oa', OTHER, 'STRUCTURE_ADMIN'); const UA = pu('ua', UNVER, 'STRUCTURE_ADMIN');
const ADMIN = `x05-admin-${TS}@example.test`;
const CSRF = 'x05csrftoken0123456789abcdef';
const Z = '00000000-0000-4000-8000-000000000000';
const DESC = `FIXTURE SYNTHÉTIQUE ${TS} — poste d’agent d’accueil, horaires de journée, accompagnement à la prise de poste, équipe bienveillante.`;
const parisDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const plus = (n) => { const [y, m, d] = parisDay(new Date()).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const LISTING = { title: `FIXTURE ${TS} agent d’accueil`, contractType: 'CDI', city: 'Strasbourg', postalCode: '67000', description: DESC,
  accommodations: ['STEP_FREE_ACCESS', 'FLEXIBLE_HOURS'], applyMethod: 'url', applyTarget: 'https://employeur.example.test/candidature', expiresOn: plus(30) };
const PUBLIC_KEYS = ['accommodations', 'applyMethod', 'applyTarget', 'city', 'contractType', 'description', 'employerName', 'expiresOn', 'id', 'postalCode', 'publishedAt', 'title'];

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('X05 inclusive job board (real DB, real API entry)', () => {
  let db; let api; let auth;
  const sign = (u, mfa = true) => auth.signProToken({ id: u.id, email: u.email, structureId: u.st, role: u.role }, { mfa });
  const adminBearer = (mfa = true) => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa });
  const call = async (method, url, { bearer, body } = {}) => {
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {}, socket: {},
      headers: { host: 'localhost:5206', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const pro = (u, body, mfa = true) => call(body ? 'POST' : 'GET', '/api/pro/employment', { bearer: sign(u, mfa), body });
  const create = async (u, over = {}) => pro(u, { action: 'create', ...LISTING, ...over });
  const queue = (q, bearer = adminBearer()) => call('GET', `/api/admin/employment?queue=${q}`, { bearer });
  const moderate = (body, bearer = adminBearer()) => call('POST', '/api/admin/employment', { bearer, body });
  const publicIds = async () => { const r = await call('GET', '/api/employment'); expect(r.statusCode).toBe(200); return r.body.items.map((x) => x.id); };
  const statusOf = async (id) => (await db.execute(sql`SELECT status FROM "JobListing" WHERE id = ${id}`)).rows[0]?.status;
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const published = async (u = EA, over = {}) => {
    const c = await create(u, over); expect(c.statusCode, JSON.stringify(c.body)).toBe(201);
    expect((await pro(u, { action: 'submit', id: c.body.id })).statusCode).toBe(200);
    const a = await moderate({ action: 'approve', id: c.body.id }); expect(a.statusCode, JSON.stringify(a.body)).toBe(200);
    return c.body.id;
  };
  const all = [EMP, OTHER, UNVER];
  const inList = (xs) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    for (const [sid, statut, ver] of [[EMP, 'actif', 'VERIFIED'], [OTHER, 'actif', 'VERIFIED'], [UNVER, 'actif', 'UNVERIFIED']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${sid}, ${'FIXTURE employeur ' + sid}, ${sid + '-slug'}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${ver}, NOW(), NOW())`);
    }
    for (const u of [EA, EP, OA, UA]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "notificationEmailEnabled", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', ${u.role}, 'active', ${u.st}, true, false, NOW())`);
    }
  }, 90000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN} OR details->>'structureId' IN (${inList(all)})`).catch(() => {});
    await db.execute(sql`DELETE FROM "JobListing" WHERE "structureId" IN (${inList(all)})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${inList(all)})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${inList(all)})`);
  });

  describe('closed by default (fail-closed)', () => {
    const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '' };
    const probes = async () => [await call('GET', '/api/employment'), await pro(EA), await create(EA), await pro(EA, { action: 'submit', id: Z }),
      await queue('pending'), await moderate({ action: 'approve', id: Z })];
    it('the current Production configuration — and with « pro » opened too — refuses every employment route 503 PUBLIC_BETA_RESTRICTED', async () => {
      for (const surfaces of ['admin,accounts', 'admin,accounts,pro']) {
        await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: surfaces }, async () => {
          for (const r of await probes()) { expect(r.statusCode, surfaces).toBe(503); expect(r.body.error).toBe('PUBLIC_BETA_RESTRICTED'); }
        });
      }
    });
    it('Production without the beta, or the surface opened without the capability: 503 CAPABILITY_NOT_OPEN, nothing written', async () => {
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: 'community.stories,community.testimonials,community.events' },
        { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,employment' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: 'community.employment' }); } });
      }
      expect((await db.execute(sql`SELECT count(*)::int n FROM "JobListing" WHERE "structureId" IN (${inList(all)})`)).rows[0].n).toBe(0);
    });
    it('the deliberate opening (surface « employment » AND « community.employment ») serves the routes, never cached', async () => {
      await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,employment', ADA_CAPABILITIES_OPEN: 'community.employment', PRO_MFA_REQUIRED: 'true' }, async () => {
        const r = await call('GET', '/api/employment'); expect(r.statusCode).toBe(200); expect(Array.isArray(r.body.items)).toBe(true); expect(r.headers['cache-control']).toBe('no-store');
        const m = await pro(EA); expect(m.statusCode, JSON.stringify(m.body)).toBe(200); expect(m.body).toMatchObject({ available: true, canManage: true, employerVerified: true });
      });
    });
  });

  describe('employer verification (E01) and the professional session', () => {
    it('no session 401; the MFA rule of the console (403 PRO_MFA_REQUIRED); a PRO member 403 — only a STRUCTURE_ADMIN manages listings', async () => {
      expect((await call('GET', '/api/pro/employment')).statusCode).toBe(401);
      await withEnv({ PRO_MFA_REQUIRED: 'true' }, async () => { const r = await pro(EA, null, false); expect(r.statusCode).toBe(403); expect(r.body.code).toBe('PRO_MFA_REQUIRED'); });
      const r = await create(EP); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('STRUCTURE_ADMIN_REQUIRED');
      const m = await pro(EP); expect(m.statusCode).toBe(200); expect(m.body).toMatchObject({ canManage: false, listings: [] });
    });
    it('an organization ADA did not verify keeps a draft but cannot send it to moderation (403 EMPLOYER_NOT_VERIFIED)', async () => {
      const c = await create(UA); expect(c.statusCode).toBe(201);
      expect((await pro(UA)).body.employerVerified).toBe(false);
      const s = await pro(UA, { action: 'submit', id: c.body.id }); expect(s.statusCode).toBe(403); expect(s.body.error).toBe('EMPLOYER_NOT_VERIFIED');
      expect(await statusOf(c.body.id)).toBe('draft');
    });
    it('an organization that loses its verification leaves the public board at once; its pending listing cannot be approved (422)', async () => {
      const id = await published();
      const c = await create(EA); await pro(EA, { action: 'submit', id: c.body.id });
      expect(await publicIds()).toContain(id);
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'UNVERIFIED' WHERE id = ${EMP}`);
      try {
        expect(await publicIds()).not.toContain(id);
        const a = await moderate({ action: 'approve', id: c.body.id }); expect(a.statusCode).toBe(422); expect(a.body.problems).toContain('EMPLOYER_NOT_VERIFIED');
        const q = await queue('pending'); expect(q.body.items.find((x) => x.id === c.body.id)).toMatchObject({ employerVerified: false });
      } finally { await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${EMP}`); }
      expect(await publicIds()).toContain(id);
      await pro(EA, { action: 'withdraw', id }); await pro(EA, { action: 'withdraw', id: c.body.id });
    });
  });

  describe('listing rules', () => {
    it('a field naming a criterion of Code du travail L1132-1 is refused (400 FORBIDDEN_CRITERION, with the legal reference); an unknown field 400', async () => {
      for (const field of ['age', 'ageMax', 'sexe', 'Nationalité', 'handicap', 'health_status', 'situation_familiale', 'religion', 'pregnancy']) {
        const r = await create(EA, { [field]: 'x' });
        expect(r.statusCode, field).toBe(400); expect(r.body).toMatchObject({ error: 'FORBIDDEN_CRITERION', fields: [field], legalBasis: 'Code du travail, article L1132-1' });
      }
      const u = await create(EA, { salaryBonus: 'x' }); expect(u.statusCode).toBe(400); expect(u.body).toMatchObject({ error: 'UNKNOWN_FIELD', fields: ['salaryBonus'] });
      expect((await db.execute(sql`SELECT count(*)::int n FROM "JobListing" WHERE "structureId" = ${EMP} AND status = 'draft'`)).rows[0].n).toBe(0);
    });
    it('required fields, closed lists, the application channel, the end date, contacts in the text and entitlement wording', async () => {
      const cases = [
        [{ title: '' }, 'TITLE_TOO_SHORT'], [{ contractType: 'FREELANCE' }, 'CONTRACT_TYPE_REQUIRED'], [{ postalCode: '6700' }, 'POSTAL_CODE_INVALID'],
        [{ accommodations: [] }, 'ACCOMMODATION_REQUIRED'], [{ accommodations: ['MASSAGE'] }, 'ACCOMMODATION_UNKNOWN'],
        [{ applyTarget: 'http://employeur.example.test/x' }, 'APPLY_TARGET_INVALID'], [{ applyMethod: 'email', applyTarget: 'pas-une-adresse' }, 'APPLY_TARGET_INVALID'],
        [{ applyMethod: 'form' }, 'APPLY_METHOD_REQUIRED'], [{ expiresOn: plus(0) }, 'EXPIRY_IN_PAST'], [{ expiresOn: plus(91) }, 'EXPIRY_TOO_FAR'], [{ expiresOn: '2026-02-30' }, 'EXPIRY_INVALID'],
        [{ description: `${DESC} Appelez le 06 12 34 56 78.` }, 'CONTACT_IN_TEXT'], [{ description: `${DESC} <img src=x>` }, 'IMAGE_OR_MARKUP'],
        [{ description: `${DESC} Vous avez droit à une prime.` }, 'ENTITLEMENT_WORDING'],
      ];
      for (const [over, code] of cases) { const r = await create(EA, over); expect(r.statusCode, code).toBe(400); expect(r.body.problems, code).toContain(code); }
      const ok = await create(EA, { applyMethod: 'email', applyTarget: 'recrutement@employeur.example.test', expiresOn: plus(90) }); expect(ok.statusCode).toBe(201);
      await pro(EA, { action: 'delete', id: ok.body.id });
    });
  });

  describe('lifecycle and moderation', () => {
    it('draft → pending (not public) → published (only what an applicant needs) → expired on its own date; every step audited', async () => {
      const c = await create(EA); expect(c.statusCode).toBe(201); const id = c.body.id;
      expect(await publicIds()).not.toContain(id);
      expect((await pro(EA, { action: 'submit', id })).body.listingStatus).toBe('pending');
      expect(await publicIds()).not.toContain(id);
      expect((await pro(EA, { action: 'update', id, ...LISTING })).statusCode, 'a pending listing is not editable').toBe(409);
      // the moderation: no session 401, no MFA 403 — reading too
      expect((await call('GET', '/api/admin/employment?queue=pending')).statusCode).toBe(401);
      expect((await queue('pending', adminBearer(false))).statusCode).toBe(403);
      expect((await moderate({ action: 'approve', id }, adminBearer(false))).statusCode).toBe(403);
      const q = await queue('pending'); const item = q.body.items.find((x) => x.id === id);
      expect(item).toMatchObject({ employerName: `FIXTURE employeur ${EMP}`, employerVerified: true, problems: [] });
      expect(JSON.stringify(q.body)).not.toContain(EA.email); expect(JSON.stringify(q.body)).not.toContain(EA.id);
      expect((await moderate({ action: 'approve', id })).body).toEqual({ id, status: 'published' });
      const pub = (await call('GET', '/api/employment')).body.items.find((x) => x.id === id);
      expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
      expect(pub).toMatchObject({ title: LISTING.title, applyMethod: 'url', applyTarget: LISTING.applyTarget, employerName: `FIXTURE employeur ${EMP}`, accommodations: LISTING.accommodations });
      // its end date passes: never served, marked « expired »
      await db.execute(sql`UPDATE "JobListing" SET "expiresOn" = ${plus(-1)} WHERE id = ${id}`);
      expect(await publicIds()).not.toContain(id); expect(await statusOf(id)).toBe('expired');
      expect((await pro(EA, { action: 'submit', id })).statusCode).toBe(409);
      const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE (entity_id = ${id} OR details->>'listingId' = ${id}) ORDER BY "timestamp"`)).rows.map((r) => r.action);
      expect(audit).toEqual(expect.arrayContaining(['JOB_LISTING_CREATED', 'JOB_LISTING_SUBMITTED', 'JOB_LISTING_APPROVE']));
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE actor = ${ADMIN} AND action = 'JOB_QUEUE_READ'`)).rows[0].n).toBeGreaterThan(0);
    });
    it('reject with a reason from the closed list → the employer sees it, corrects (back to draft) and resubmits; a reason is required', async () => {
      const c = await create(EA); const id = c.body.id; await pro(EA, { action: 'submit', id });
      expect((await moderate({ action: 'reject', id })).statusCode).toBe(400);
      expect((await moderate({ action: 'reject', id, reason: 'FREE TEXT' })).body.error).toBe('REASON_REQUIRED');
      expect((await moderate({ action: 'reject', id, reason: 'HEALTH_DATA_REQUESTED' })).body).toEqual({ id, status: 'rejected' });
      const mine = (await pro(EA)).body.listings.find((x) => x.id === id);
      expect(mine).toMatchObject({ status: 'rejected', moderationReason: 'HEALTH_DATA_REQUESTED' }); expect(mine.moderatedBy).toBeUndefined();
      const u = await pro(EA, { action: 'update', id, ...LISTING, description: `${DESC} Corrigée.` }); expect(u.body.listingStatus).toBe('draft');
      expect((await pro(EA, { action: 'submit', id })).statusCode).toBe(200);
      await pro(EA, { action: 'withdraw', id });
    });
    it('takedown of a published listing (reason) and withdrawal by the employer: gone from the next public answer', async () => {
      const a = await published(); const b = await published();
      expect(await publicIds()).toEqual(expect.arrayContaining([a, b]));
      expect((await moderate({ action: 'takedown', id: a, reason: 'DISCRIMINATORY_CRITERION' })).body).toEqual({ id: a, status: 'taken_down' });
      expect((await pro(EA, { action: 'withdraw', id: b })).body.listingStatus).toBe('withdrawn');
      const ids = await publicIds(); expect(ids).not.toContain(a); expect(ids).not.toContain(b);
      expect((await moderate({ action: 'approve', id: a })).statusCode).toBe(409);
      expect((await pro(EA, { action: 'withdraw', id: a })).statusCode, 'a taken-down listing is final').toBe(404);
    });
  });

  describe('isolation, applicants, closure', () => {
    it('another organization never reads, edits, sends, withdraws or deletes a listing it does not own (404, as an unknown id)', async () => {
      const draft = (await create(EA)).body.id; const live = await published();
      expect((await pro(OA)).body.listings.map((x) => x.id)).not.toEqual(expect.arrayContaining([draft]));
      for (const body of [{ action: 'update', id: draft, ...LISTING }, { action: 'submit', id: draft }, { action: 'withdraw', id: live }, { action: 'delete', id: draft }]) {
        const r = await pro(OA, body); expect(r.statusCode, body.action).toBe(404); expect(r.body.error).toBe('LISTING_NOT_FOUND');
      }
      expect(await statusOf(draft)).toBe('draft'); expect(await statusOf(live)).toBe('published');
      expect((await pro(EA, { action: 'delete', id: draft })).body.deleted).toBe(true);
      await pro(EA, { action: 'withdraw', id: live });
    });
    it('no applicant data: no application route exists, the board answers a POST 405, the schema holds no applicant table', async () => {
      expect((await call('POST', '/api/employment', { body: { message: 'x' } })).statusCode).toBe(405);
      for (const p of ['/api/employment/apply', '/api/pro/employment/applications']) expect((await call('POST', p, { bearer: sign(EA), body: {} })).statusCode, p).toBe(404);
      const t = (await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name ILIKE '%application%' OR table_name ILIKE '%applicant%' OR table_name ILIKE '%candidat%' OR table_name ILIKE 'Job%') AND table_name <> 'JobListing'`)).rows;
      expect(t).toEqual([]);
    });
    it('the organization closure (E08) withdraws its open listings', async () => {
      const live = await published(OA); const draft = (await create(OA)).body.id;
      const { withdrawForClosedOrganization } = await import('../../api/_services/job-board.js');
      const n = await db.transaction((tx) => withdrawForClosedOrganization(tx, OTHER));
      expect(n).toBe(2); expect(await statusOf(live)).toBe('withdrawn'); expect(await statusOf(draft)).toBe('withdrawn');
      expect(await publicIds()).not.toContain(live);
      // G13: every application channel of the closed organisation is erased (it can be a named recruiter's e-mail); other organisations keep theirs
      const left = (await db.execute(sql`SELECT count(*)::int AS n FROM "JobListing" WHERE "structureId" = ${OTHER} AND "applyTarget" IS NOT NULL`)).rows[0].n;
      expect(left).toBe(0);
      const others = (await db.execute(sql`SELECT count(*)::int AS n FROM "JobListing" WHERE "structureId" <> ${OTHER} AND "applyTarget" IS NOT NULL`)).rows[0].n;
      expect(others).toBeGreaterThan(0);
    });
  });
});
