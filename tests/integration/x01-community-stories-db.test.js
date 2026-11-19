/**
 * X01 (expansion) — community stories on REAL PostgreSQL (migration 0055), through the real API entry (api/index.js: CSRF, routing, beta and capability
 * gates) with signed sessions:
 *   - CLOSED in the current Production configuration (restricted beta, surfaces admin + accounts) and in Production without the beta: every route of the
 *     « stories » surface answers 503 before its handler, whoever asks; opening needs the « stories » surface AND « community.stories »;
 *   - the pseudonymous principal: adult accounts only, a chosen pseudonym (not the e-mail, unique without regard to case, immutable), one per account;
 *   - posting: anonymous 401, pseudonym first, adult accounts only, explicit consent with the current wording version, images / markup / links / contacts /
 *     phones REFUSED, at most 3 pending and 3 a day; the consent is a ConsentLog row written with it; nothing public before moderation;
 *   - moderation: no session 401, no MFA 403 (reading the queue too), approve (problems refused 422), reject (text erased, reason kept), takedown, dismiss the
 *     reports; every read and decision audited; the moderator never sees the account, its e-mail, the member id or who reported;
 *   - publication: only the pseudonym, the title, the text, its language and the date;
 *   - report: account needed, closed list, once per account and story, never one's own, a daily limit; never hides by itself;
 *   - withdrawal at any time and leaving the community: gone from the public answer at once, text erased, withdrawal in ConsentLog, reports deleted;
 *   - cross-account isolation; the database's own CHECKs;
 *   - DSR: export sections, erasure (approved DSR) and purge step 6c delete the pseudonym, the stories and the reports.
 * FIXTURES: every account and every text below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » texts); they are deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const TAG = TS.toString(36).slice(-5).replace(/\d/g, (c) => 'abcdefghij'[Number(c)]);   // letters only: a pseudonym may not hold 5 digits in a row
const u = (k) => ({ id: `x01-${k}-${TS}`, email: `x01-${k}-${TS}@example.test` });
const A = u('a'); const B = u('b'); const D = u('d'); const E = u('e'); const NODECL = u('nodecl'); const MINOR = u('minor');
const F = [1, 2, 3, 4, 5, 6].map((i) => u(`f${i}`));
const ALL = [A, B, D, E, NODECL, MINOR, ...F];
const ADMIN = `x01-admin-${TS}@example.test`;
const DAY = 86400e3;
const TITLE = `FIXTURE ${TS} titre`;
const TEXT_A = `FIXTURE SYNTHÉTIQUE ${TS} — une permanence près de chez moi m’a aidé à préparer mon dossier et à comprendre les étapes.`;
const TEXT_B = `FIXTURE SYNTHÉTIQUE ${TS} — un deuxième texte de test, qui sera refusé par la modération pour ce test.`;
const VERSION = 'x01-2026-11-19-lab-proposal';
const PS = { A: `FxA${TAG}`, B: `FxB${TAG}`, D: `FxD${TAG}`, E: `FxE${TAG}` };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('X01 community stories (real DB, real API entry)', () => {
  let db; let api; let userAuth; let auth;
  const CSRF = 'x01csrftoken0123456789abcdef';
  const sessionOf = (x) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: x.id, email: x.email })).split(';')[0];
  const adminBearer = (mfa = true) => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa });
  const call = async (method, url, { as, body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:5184', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mine = (as) => call('GET', '/api/citizen/stories', { as });
  const act = (as, body) => call('POST', '/api/citizen/stories', { as, body });
  const join = (as, pseudonym) => act(as, { action: 'join', pseudonym });
  const submit = (as, over = {}) => act(as, { action: 'submit', title: TITLE, body: TEXT_A, lang: 'fr', consent: true, consentVersion: VERSION, ...over });
  const queue = (q, opts = {}) => call('GET', `/api/admin/stories?queue=${q}`, { bearer: opts.bearer ?? adminBearer() });
  const moderate = (body) => call('POST', '/api/admin/stories', { bearer: adminBearer(), body });
  const publicList = async () => (await call('GET', '/api/stories')).body.items;
  const one = async (q) => (await db.execute(q)).rows[0];
  const ids = () => sql.join(ALL.map((x) => sql`${x.id}`), sql`, `);
  const storiesOf = (x) => sql`SELECT s.* FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE m."citizenUserId" = ${x.id}`;
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  /** SYNTHETIC FIXTURE: a member and a published story written directly (moderation is tested through the API above) */
  const publishedFixture = async (x, n) => {
    const memberId = crypto.randomUUID(); const id = crypto.randomUUID();
    await db.execute(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${memberId}, ${x.id}, ${`Fx${n}${TAG}`})`);
    await db.execute(sql`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "moderatedBy", "moderatedAt", "publishedAt", "updatedAt")
      VALUES (${id}, ${memberId}, 'published', ${TITLE}, ${`${TEXT_A} (fixture ${n})`}, 'fr', ${VERSION}, ${ADMIN}, NOW(), NOW(), NOW())`);
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    userAuth = await import('../../api/_utils/user-auth.js');
    auth = await import('../../api/_utils/auth.js');
    const { recordAgeDeclaration } = await import('../../api/_utils/age-policy.js');
    for (const x of ALL) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${x.id}, ${x.email}, 'x', NOW(), NOW())`);
    for (const x of ALL.filter((y) => y !== NODECL)) await recordAgeDeclaration(x.id, { adult: true, channel: 'signup' }, db);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${MINOR.id}, 'moins-de-18', NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${ids()})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${ids()})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${ids()})`);
  });

  describe('closed by default (fail-closed)', () => {
    const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '' };
    const Z = '00000000-0000-4000-8000-000000000000';
    const probes = async () => [await call('GET', '/api/stories'), await mine(A), await join(A, PS.A), await submit(A),
      await act(A, { action: 'report', id: Z, reason: 'OFFENSIVE' }), await queue('pending'), await moderate({ action: 'approve', id: Z })];
    it('the current Production configuration (beta, admin + accounts open) refuses every stories route 503 — admin and citizen sessions included', async () => {
      await withEnv(PROD_NOW, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body.error).toBe('PUBLIC_BETA_RESTRICTED'); } });
    });
    it('Production without the beta, or with the surface opened but the capability not listed: 503 CAPABILITY_NOT_OPEN, nothing written', async () => {
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: 'community.testimonials,community.events' },
        { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: 'community.stories' }); } });
      }
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityMember" WHERE "citizenUserId" IN (${ids()})`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'COMMUNITY_STORY_PUBLICATION' AND subject_id IN (${ids()})`)).n).toBe(0);
    });
    it('the deliberate opening (surface « stories » AND « community.stories » listed) serves the routes, never cached', async () => {
      await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories', ADA_CAPABILITIES_OPEN: 'community.stories' }, async () => {
        const r = await call('GET', '/api/stories'); expect(r.statusCode).toBe(200); expect(Array.isArray(r.body.items)).toBe(true);
        expect(r.headers['cache-control']).toBe('no-store');
      });
    });
  });

  describe('the pseudonymous principal', () => {
    it('anonymous 401; no adult declaration or the minor band 403; the e-mail local part, a space, a reserved word 400 — nothing stored', async () => {
      expect((await act(null, { action: 'join', pseudonym: 'Lune' })).statusCode).toBe(401);
      for (const x of [NODECL, MINOR]) { const r = await join(x, `Fx${x === MINOR ? 'M' : 'N'}${TAG}`); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('ADULT_ACCOUNT_REQUIRED'); }
      expect((await join(A, A.email.split('@')[0])).body.error).toBe('PSEUDONYM_FROM_EMAIL');
      expect((await join(A, 'Marie Dupont')).body.error).toBe('PSEUDONYM_INVALID');
      expect((await join(A, A.email)).body.error).toBe('PSEUDONYM_INVALID');
      expect((await join(A, 'Moderateur67')).body.error).toBe('PSEUDONYM_RESERVED');
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityMember" WHERE "citizenUserId" IN (${ids()})`)).n).toBe(0);
      // posting before choosing a pseudonym
      expect((await submit(A)).body.error).toBe('PSEUDONYM_REQUIRED');
    });
    it('A, B, D, E join; the pseudonym is unique without regard to case; one per account; it cannot be changed', async () => {
      for (const [x, p] of [[A, PS.A], [B, PS.B], [D, PS.D], [E, PS.E]]) { const r = await join(x, p); expect(r.statusCode, p).toBe(201); expect(r.body.member).toEqual({ pseudonym: p }); }
      expect((await join(NODECL, PS.A.toUpperCase())).statusCode).toBe(403);   // the age rule is checked before the name is looked up
      const taken = await join(F[0], PS.A.toLowerCase()); expect(taken.statusCode).toBe(409); expect(taken.body.error).toBe('PSEUDONYM_TAKEN');
      const again = await join(A, `Other${TAG}`); expect(again.statusCode).toBe(409); expect(again.body.error).toBe('ALREADY_MEMBER');
      expect((await mine(A)).body.member.pseudonym).toBe(PS.A);
      // the member id is a new random id, never the account id
      const m = await one(sql`SELECT id FROM "CommunityMember" WHERE "citizenUserId" = ${A.id}`);
      expect(m.id).not.toBe(A.id); expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify((await mine(A)).body)).not.toContain(m.id);
    });
  });

  describe('posting with consent', () => {
    it('no consent, an old wording version, an image, markup, a link, an e-mail, a handle or a phone number 400 — nothing stored', async () => {
      expect((await submit(A, { consent: 'true' })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { consent: undefined })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { consentVersion: 'old' })).body.error).toBe('CONSENT_REQUIRED');
      expect((await submit(A, { body: `${TEXT_A} <img src="x">` })).body.error).toBe('IMAGE_OR_MARKUP');
      expect((await submit(A, { body: `${TEXT_A} ![photo](https://exemple.test/p.png)` })).body.error).toBe('IMAGE_OR_MARKUP');
      expect((await submit(A, { title: '<b>titre</b> en gras' })).body.error).toBe('IMAGE_OR_MARKUP');
      expect((await submit(A, { body: `${TEXT_A} https://exemple.test` })).body.error).toBe('CONTACT_OR_LINK_IN_TEXT');
      expect((await submit(A, { body: `${TEXT_A} ecrivez a lune@example.test` })).body.error).toBe('CONTACT_OR_LINK_IN_TEXT');
      expect((await submit(A, { body: `${TEXT_A} suivez @lune_67` })).body.error).toBe('CONTACT_OR_LINK_IN_TEXT');
      expect((await submit(A, { body: `${TEXT_A} Appelez-moi au 06 12 34 56 78.` })).body.error).toBe('PHONE_IN_TEXT');
      expect((await submit(A, { lang: 'xx' })).body.error).toBe('LANG_REQUIRED');
      expect((await submit(A, { body: 'trop court' })).body.error).toBe('BODY_TOO_SHORT');
      expect((await one(sql`SELECT count(*)::int n FROM (${storiesOf(A)}) x`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'COMMUNITY_STORY_PUBLICATION' AND subject_id IN (${ids()})`)).n).toBe(0);
    });
    it('A posts: pending, ONE consent row (purpose, version, story id, explicit box); not public before moderation; B posts too', async () => {
      const r = await submit(A);
      expect(r.statusCode).toBe(201); expect(r.body.storyStatus).toBe('pending');
      const c = (await db.execute(sql`SELECT decision, policy_version, policy_hash, proof_level, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${A.id} AND purpose = 'COMMUNITY_STORY_PUBLICATION'`)).rows;
      expect(c).toEqual([{ decision: true, policy_version: VERSION, policy_hash: `${VERSION}:COMMUNITY_STORY_PUBLICATION:${r.body.id}`, proof_level: 'EXPLICIT_CHECKBOX', withdrawn_at: null }]);
      expect((await publicList()).map((x) => x.id)).not.toContain(r.body.id);
      const m = (await mine(A)).body;
      expect(m).toMatchObject({ available: true, canSubmit: true, consentVersion: VERSION, member: { pseudonym: PS.A } });
      expect(m.stories[0]).toMatchObject({ id: r.body.id, status: 'pending', title: TITLE, body: TEXT_A, lang: 'fr' });
      expect((await submit(B, { body: TEXT_B })).statusCode).toBe(201);
    });
    it('limits: at most 3 stories waiting for review (409), at most 3 submissions in 24 h (429)', async () => {
      expect((await submit(E, { body: `${TEXT_A} (1)` })).statusCode).toBe(201);
      expect((await submit(E, { body: `${TEXT_A} (2)` })).statusCode).toBe(201);
      expect((await submit(E, { body: `${TEXT_A} (3)` })).statusCode).toBe(201);
      const r = await submit(E, { body: `${TEXT_A} (4)` }); expect(r.statusCode).toBe(409); expect(r.body.error).toBe('TOO_MANY_PENDING');
      expect((await mine(E)).body.canSubmit).toBe(false);
      // one withdrawn: no longer pending, but three submissions within 24 h already
      const first = (await mine(E)).body.stories[0].id;
      expect((await act(E, { action: 'withdraw', id: first })).statusCode).toBe(200);
      const daily = await submit(E, { body: `${TEXT_A} (5)` }); expect(daily.statusCode).toBe(429); expect(daily.body.error).toBe('SUBMIT_LIMIT');
    });
  });

  describe('moderation and publication', () => {
    let idA; let idB;
    beforeAll(async () => { idA = (await mine(A)).body.stories[0].id; idB = (await mine(B)).body.stories[0].id; });
    it('no session 401; a citizen session is not a moderator; reading the queue without MFA 403', async () => {
      expect((await call('GET', '/api/admin/stories?queue=pending')).statusCode).toBe(401);
      expect((await call('GET', '/api/admin/stories?queue=pending', { as: A })).statusCode).toBe(401);
      const r = await queue('pending', { bearer: adminBearer(false) });
      expect(r.statusCode).toBe(403); expect(r.body.error).toBe('HUMAN_MFA_SESSION_REQUIRED');
      expect((await call('POST', '/api/admin/stories', { bearer: adminBearer(false), body: { action: 'approve', id: idA } })).statusCode).toBe(403);
    });
    it('the pending queue shows title, text, pseudonym and language — never the account, its e-mail or the member id; the read is audited', async () => {
      const r = await queue('pending');
      expect(r.statusCode).toBe(200);
      expect(r.body.items.find((x) => x.id === idA)).toMatchObject({ pseudonym: PS.A, title: TITLE, body: TEXT_A, lang: 'fr', problems: [], reports: { total: 0, reasons: {} } });
      const raw = JSON.stringify(r.body);
      const memberIds = (await db.execute(sql`SELECT id FROM "CommunityMember" WHERE "citizenUserId" IN (${ids()})`)).rows.map((x) => x.id);
      for (const x of [A, B, E]) { expect(raw).not.toContain(x.id); expect(raw).not.toContain(x.email); }
      for (const m of memberIds) expect(raw).not.toContain(m);
      expect(raw).not.toMatch(/citizenUserId|memberId/);
      expect((await one(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'STORY_QUEUE_READ' AND actor = ${ADMIN}`)).n).toBeGreaterThanOrEqual(1);
    });
    it('a reject needs a reason; it ERASES the title and the text; the person sees the state and the reason; approve refused afterwards', async () => {
      expect((await moderate({ action: 'reject', id: idB })).body.error).toBe('REASON_REQUIRED');
      expect((await moderate({ action: 'reject', id: idB, reason: 'OFF_TOPIC' })).statusCode).toBe(200);
      expect(await one(sql`SELECT status, title, body, "moderationReason" FROM "CommunityStory" WHERE id = ${idB}`)).toEqual({ status: 'rejected', title: null, body: null, moderationReason: 'OFF_TOPIC' });
      expect((await mine(B)).body.stories[0]).toMatchObject({ status: 'rejected', title: null, body: null, moderationReason: 'OFF_TOPIC' });
      expect((await moderate({ action: 'approve', id: idB })).body.error).toBe('NOT_PENDING');
    });
    it('approval of a story with entitlement wording is refused 422 with the problem; A’s is published: the public answer has pseudonym, title, text, language, date only', async () => {
      expect((await submit(B, { body: `${TEXT_B} Vous avez droit à cette aide.` })).statusCode).toBe(201);
      const bad = (await mine(B)).body.stories.find((x) => x.status === 'pending');
      const refused = await moderate({ action: 'approve', id: bad.id });
      expect(refused.statusCode).toBe(422); expect(refused.body.problems).toContain('ENTITLEMENT_WORDING');
      expect((await moderate({ action: 'approve', id: idA })).body).toEqual({ id: idA, status: 'published' });
      const item = (await publicList()).find((x) => x.id === idA);
      expect(Object.keys(item).sort()).toEqual(['body', 'id', 'lang', 'pseudonym', 'publishedAt', 'title']);
      expect(item).toMatchObject({ pseudonym: PS.A, title: TITLE, body: TEXT_A, lang: 'fr' });
      const raw = JSON.stringify(await publicList());
      const mA = (await one(sql`SELECT id FROM "CommunityMember" WHERE "citizenUserId" = ${A.id}`)).id;
      for (const s of [A.id, A.email, mA, ADMIN, 'moderatedBy', 'consentVersion', 'citizenUserId', 'memberId']) expect(raw).not.toContain(s);
      const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'CommunityStory' AND entity_id IN (${idA}, ${idB})`)).rows.map((x) => x.action);
      expect(audit).toEqual(expect.arrayContaining(['STORY_APPROVE', 'STORY_REJECT']));
      expect((await moderate({ action: 'reject', id: bad.id, reason: 'MISLEADING' })).statusCode).toBe(200);
    });
  });

  describe('reports of abuse and takedown', () => {
    let idA;
    beforeAll(async () => { idA = (await mine(A)).body.stories.find((x) => x.status === 'published').id; });
    it('account needed (401); a closed list (400); never one’s own (409); once per account (409); never hides by itself; counts per reason, never who', async () => {
      expect((await act(null, { action: 'report', id: idA, reason: 'OFFENSIVE' })).statusCode).toBe(401);
      expect((await act(D, { action: 'report', id: idA, reason: 'texte libre' })).body.error).toBe('UNKNOWN_REASON');
      expect((await act(A, { action: 'report', id: idA, reason: 'OFFENSIVE' })).body.error).toBe('OWN_STORY');
      expect((await act(D, { action: 'report', id: idA, reason: 'PERSONAL_DATA' })).statusCode).toBe(201);
      expect((await act(D, { action: 'report', id: idA, reason: 'OFFENSIVE' })).body.error).toBe('ALREADY_REPORTED');
      expect((await act(E, { action: 'report', id: idA, reason: 'PERSONAL_DATA' })).statusCode).toBe(201);
      // a non-member (no pseudonym) may report too: an account is what is needed
      expect((await act(F[5], { action: 'report', id: idA, reason: 'HEALTH_DETAIL' })).statusCode).toBe(201);
      expect((await publicList()).map((x) => x.id)).toContain(idA);
      const r = await queue('reported');
      expect(r.body.items.find((x) => x.id === idA).reports).toEqual({ total: 3, reasons: { PERSONAL_DATA: 2, HEALTH_DETAIL: 1 } });
      const raw = JSON.stringify(r.body);
      for (const x of [D, E, F[5], A]) { expect(raw).not.toContain(x.id); expect(raw).not.toContain(x.email); }
    });
    it('dismissing the reports keeps the story and deletes the reports; a takedown erases the text and deletes its reports', async () => {
      expect((await moderate({ action: 'dismiss_reports', id: idA })).body).toMatchObject({ dismissed: 3, status: 'published' });
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStoryReport" WHERE "storyId" = ${idA}`)).n).toBe(0);
      expect((await queue('reported')).body.items.map((x) => x.id)).not.toContain(idA);
      const fx = await publishedFixture(F[0], 'T');
      expect((await act(D, { action: 'report', id: fx, reason: 'ADVERTISING' })).statusCode).toBe(201);
      expect((await moderate({ action: 'takedown', id: fx })).body.error).toBe('REASON_REQUIRED');
      expect((await moderate({ action: 'takedown', id: fx, reason: 'ADVERTISING' })).statusCode).toBe(200);
      expect(await one(sql`SELECT status, title, body FROM "CommunityStory" WHERE id = ${fx}`)).toEqual({ status: 'taken_down', title: null, body: null });
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStoryReport" WHERE "storyId" = ${fx}`)).n).toBe(0);
      expect((await publicList()).map((x) => x.id)).not.toContain(fx);
      expect((await moderate({ action: 'takedown', id: fx, reason: 'ADVERTISING' })).body.error).toBe('NOT_PUBLISHED');
    });
    it('a daily limit per account: the sixth report within 24 h is refused 429', async () => {
      const fx = [];
      for (const [i, f] of F.slice(1, 5).entries()) fx.push(await publishedFixture(f, `L${i}`));
      // B has made no report yet: four pass here, plus A's story = five, the sixth (another fixture) is refused
      for (const id of [...fx, idA]) expect((await act(B, { action: 'report', id, reason: 'OFF_TOPIC' })).statusCode).toBe(201);
      const sixth = await publishedFixture(F[5], 'L6');
      const r = await act(B, { action: 'report', id: sixth, reason: 'OFF_TOPIC' });
      expect(r.statusCode).toBe(429); expect(r.body.error).toBe('REPORT_LIMIT');
    });
  });

  describe('withdrawal, leaving, isolation, database checks', () => {
    let idA;
    beforeAll(async () => { idA = (await mine(A)).body.stories.find((x) => x.status === 'published').id; });
    it('another account cannot see or withdraw it (404, same as unknown)', async () => {
      expect(JSON.stringify((await mine(D)).body)).not.toContain(idA);
      const r = await act(D, { action: 'withdraw', id: idA });
      expect(r.statusCode).toBe(404); expect(r.body.error).toBe('STORY_NOT_FOUND');
      expect((await act(NODECL, { action: 'withdraw', id: idA })).statusCode).toBe(404);
      expect((await act(D, { action: 'withdraw', id: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
      expect((await one(sql`SELECT status FROM "CommunityStory" WHERE id = ${idA}`)).status).toBe('published');
    });
    it('A withdraws the published story: gone from the next public answer, text erased, withdrawal in ConsentLog, reports deleted, no republication', async () => {
      expect((await publicList()).map((x) => x.id)).toContain(idA);
      const r = await act(A, { action: 'withdraw', id: idA });
      expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ storyStatus: 'withdrawn', erased: true });
      expect((await publicList()).map((x) => x.id)).not.toContain(idA);
      const row = await one(sql`SELECT status, title, body, "withdrawnAt" FROM "CommunityStory" WHERE id = ${idA}`);
      expect(row).toMatchObject({ status: 'withdrawn', title: null, body: null }); expect(row.withdrawnAt).toBeTruthy();
      const c = (await db.execute(sql`SELECT decision, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${A.id} AND policy_hash = ${`${VERSION}:COMMUNITY_STORY_PUBLICATION:${idA}`} ORDER BY created_at`)).rows;
      expect(c.map((x) => x.decision)).toEqual([true, false]); expect(c[1].withdrawn_at).toBeTruthy();
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStoryReport" WHERE "storyId" = ${idA}`)).n).toBe(0);
      expect((await act(A, { action: 'withdraw', id: idA })).statusCode).toBe(404);
      expect((await moderate({ action: 'approve', id: idA })).body.error).toBe('NOT_PENDING');
    });
    it('the database itself refuses text on an erased story, a free-text reason, a pseudonym with a space or an « @ », a second pseudonym for one account', async () => {
      const bad = (q) => db.execute(q).then(() => 'ACCEPTED', (e) => `${e?.message} ${e?.cause?.message || ''}`);
      expect(await bad(sql`UPDATE "CommunityStory" SET title = ${TITLE}, body = ${TEXT_A} WHERE id = ${idA}`)).toMatch(/CommunityStory_text_state_check/);
      expect(await bad(sql`INSERT INTO "CommunityStoryReport" (id, "storyId", "reporterUserId", reason) VALUES (${crypto.randomUUID()}, ${idA}, ${D.id}, 'texte libre')`)).toMatch(/CommunityStoryReport_reason_check/);
      expect(await bad(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${crypto.randomUUID()}, ${NODECL.id}, 'Marie Dupont')`)).toMatch(/CommunityMember_pseudonym_check/);
      expect(await bad(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${crypto.randomUUID()}, ${NODECL.id}, 'a@b')`)).toMatch(/CommunityMember_pseudonym_check/);
      expect(await bad(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${crypto.randomUUID()}, ${A.id}, ${`Second${TAG}`})`)).toMatch(/CommunityMember_user_key/);
    });
    it('E leaves the community: every active story withdrawn (text erased, consent withdrawal recorded), then the pseudonym and its stories deleted; E may join again', async () => {
      const before = (await db.execute(storiesOf(E))).rows;
      const active = before.filter((s) => ['pending', 'published'].includes(s.status)).map((s) => s.id);
      expect(active.length).toBeGreaterThanOrEqual(1);
      const r = await act(E, { action: 'leave' });
      expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ left: true, withdrawn: active.length });
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityMember" WHERE "citizenUserId" = ${E.id}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStory" WHERE id IN (${sql.join(before.map((s) => sql`${s.id}`), sql`, `)})`)).n).toBe(0);
      for (const id of active) {
        const c = (await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${E.id} AND policy_hash = ${`${VERSION}:COMMUNITY_STORY_PUBLICATION:${id}`} ORDER BY created_at`)).rows;
        expect(c.map((x) => x.decision)).toEqual([true, false]);
      }
      // the reports E made stay E's (keyed on the account), until the account goes
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStoryReport" WHERE "reporterUserId" = ${E.id}`)).n).toBeGreaterThanOrEqual(0);
      expect((await mine(E)).body).toMatchObject({ member: null, stories: [] });
      expect((await act(E, { action: 'leave' })).statusCode).toBe(404);
      expect((await join(E, `FxE2${TAG}`)).statusCode).toBe(201);
    });
  });

  describe('DSR export, erasure and purge step 6c', () => {
    const exp = async (x) => { const r = await call('GET', '/api/auth/export-data', { as: x }); expect(r.statusCode).toBe(200); return typeof r.body === 'string' ? JSON.parse(r.body) : r.body; };
    it('the export of A lists A’s pseudonym and stories (no text once erased); D’s lists D’s reports; neither shows the other or a member id', async () => {
      expect((await submit(A, { body: `${TEXT_A} (après retrait)` })).statusCode).toBe(201);
      const a = await exp(A);
      expect(a.communityMember).toEqual([expect.objectContaining({ pseudonym: PS.A })]);
      expect(Object.keys(a.communityMember[0]).sort()).toEqual(['createdAt', 'pseudonym']);
      expect(a.communityStories.map((x) => x.status)).toEqual(expect.arrayContaining(['withdrawn', 'pending']));
      expect(a.communityStories.find((x) => x.status === 'withdrawn').body).toBeNull();
      expect(a.communityStoryReports).toEqual([]);
      // D's earlier reports went with the dismissal and the takedown: D reports a published fixture story now
      const [fx] = (await db.execute(sql`SELECT s.id FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE s.status = 'published' AND m."citizenUserId" = ${F[1].id}`)).rows;
      expect((await act(D, { action: 'report', id: fx.id, reason: 'MISLEADING' })).statusCode).toBe(201);
      const d = await exp(D);
      expect(d.communityStories).toEqual([]);
      expect(d.communityStoryReports.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(d.communityStoryReports[0]).sort()).toEqual(['createdAt', 'reason', 'storyId']);
      const mA = (await one(sql`SELECT id FROM "CommunityMember" WHERE "citizenUserId" = ${A.id}`)).id;
      expect(JSON.stringify(d)).not.toContain(A.id); expect(JSON.stringify(a)).not.toContain(mA);
    });
    it('an approved erasure deletes the person’s pseudonym, stories and reports (cascade); other accounts keep theirs', async () => {
      const others = (await one(sql`SELECT count(*)::int n FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE m."citizenUserId" NOT IN (${A.id}, ${D.id})`)).n;
      const privacy = await import('../../api/_services/privacy.js');
      const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
      for (const x of [A, D]) {
        const req = await svc.requestDeletion(x.id);
        await svc.updateDsrRequestStatus(req.id, 'APPROVED');
        await svc.executeApprovedDeletion(req.id);
      }
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityMember" WHERE "citizenUserId" IN (${A.id}, ${D.id})`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStory" WHERE body LIKE ${`%${TS}%(après retrait)`}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStoryReport" WHERE "reporterUserId" = ${D.id}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE m."citizenUserId" NOT IN (${A.id}, ${D.id})`)).n).toBe(others);
    });
    it('purge step 6c (unverified accounts after 7 days) takes the pseudonym and any story of such an account with it', async () => {
      const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const step = PURGE_STEPS.find((s) => s.id === 'unverifiedAccountsDeleted');
      const U = u('unverified'); ALL.push(U);
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW() - interval '9 days', NOW())`);
      const memberId = crypto.randomUUID(); const id = crypto.randomUUID();
      await db.execute(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${memberId}, ${U.id}, ${`FxU${TAG}`})`);
      await db.execute(sql`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "updatedAt") VALUES (${id}, ${memberId}, 'pending', ${TITLE}, ${TEXT_A}, 'fr', ${VERSION}, NOW())`);
      const out = await step.run(db, { cutoff: () => new Date(Date.now() - 7 * DAY) }, { failures: [] });
      expect(out.count).toBeGreaterThanOrEqual(1);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityMember" WHERE id = ${memberId}`)).n).toBe(0);
      expect((await one(sql`SELECT count(*)::int n FROM "CommunityStory" WHERE id = ${id}`)).n).toBe(0);
    });
  });
});
