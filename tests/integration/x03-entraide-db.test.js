/**
 * X03 (expansion) — Entraide on REAL PostgreSQL (migration 0057), through the real API entry (api/index.js: CSRF, routing, beta and capability gates) with
 * signed sessions:
 *   - CLOSED in the current Production configuration (restricted beta, surfaces admin + accounts — « full » accounts scope included) and in Production without
 *     the beta: every route of the « entraide » surface answers 503 before its handler, whoever asks; nothing is written;
 *   - joining: anonymous 401, adult accounts only, the charter (explicit box, current « projet » version, ConsentLog row in the same transaction), a chosen
 *     pseudonym (not the e-mail, not the X01 story pseudonym, unique without regard to case);
 *   - offers: closed category and area lists, note rules (contacts / phones / money refused), limits, pause / reopen / close; browsing shows anonymous offers
 *     (category, area, note, day) — never a pseudonym, an id of a member or an account; no score;
 *   - the DOUBLE OPT-IN: request → (no pseudonym on either side) → the volunteer accepts → both pseudonyms appear; an e-mail can be shared ONLY then, with an
 *     explicit box (ConsentLog), seen by the other side only, revocable; ending the request deletes the shared e-mails; decline and withdraw erase the note;
 *   - report and block (both ways: offers hidden, requests refused, active requests ended), unblock;
 *   - moderation: no session 401, no MFA 403 (reading too), queues by pseudonym with counts per reason — never the account, its e-mail, a member id, who
 *     reported, a request note or a shared e-mail; suspend (offers closed, requests ended), reinstate, dismiss, close an offer; every read and decision audited;
 *   - cross-account isolation; the database's own CHECKs;
 *   - DSR: export sections, leaving Entraide, erasure (approved DSR) and purge step 6c delete everything of the person.
 * FIXTURES: every account and every text below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » notes); they are deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const TAG = TS.toString(36).slice(-5).replace(/\d/g, (c) => 'abcdefghij'[Number(c)]);   // letters only: a pseudonym may not hold 5 digits in a row
const u = (k) => ({ id: `x03-${k}-${TS}`, email: `x03-${k}-${TS}@example.test` });
const A = u('a'); const B = u('b'); const C = u('c'); const D = u('d'); const ST = u('st'); const NODECL = u('nodecl'); const MINOR = u('minor');
const ALL = [A, B, C, D, ST, NODECL, MINOR];
const ADMIN = `x03-admin-${TS}@example.test`;
const DAY = 86400e3;
const CHARTER = 'x03-2026-11-19-projet';
const CONTACT = 'x03-contact-2026-11-19-projet';
const PS = { A: `EnA${TAG}`, B: `EnB${TAG}`, C: `EnC${TAG}`, D: `EnD${TAG}`, ST: `EnS${TAG}` };
const NOTE_B = `FIXTURE ${TAG} — plutôt le mardi matin, je parle aussi turc.`;
const MAIL_B = `x03-shared-b-${TS}@example.test`;
const MAIL_A = `x03-shared-a-${TS}@example.test`;

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('X03 Entraide (real DB, real API entry)', () => {
  let db; let api; let userAuth; let auth;
  const CSRF = 'x03csrftoken0123456789abcdef';
  const sessionOf = (x) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: x.id, email: x.email })).split(';')[0];
  const adminBearer = (mfa = true) => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa });
  const call = async (method, url, { as, body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:5203', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mine = async (as) => (await call('GET', '/api/citizen/entraide', { as })).body;
  const browse = (as, q = '') => call('GET', `/api/citizen/entraide?view=browse${q}`, { as });
  const act = (as, body) => call('POST', '/api/citizen/entraide', { as, body });
  const join = (as, pseudonym, over = {}) => act(as, { action: 'join', pseudonym, charter: true, charterVersion: CHARTER, ...over });
  const offer = (as, over = {}) => act(as, { action: 'offer_create', category: 'SHOPPING', area: 'STRASBOURG_NEUDORF_PORT_DU_RHIN', ...over });
  const queue = (q, opts = {}) => call('GET', `/api/admin/entraide?queue=${q}`, { bearer: opts.bearer ?? adminBearer() });
  const moderate = (body) => call('POST', '/api/admin/entraide', { bearer: adminBearer(), body: { facts: 'FIXTURE : faits de test pour l’exposé des motifs.', ...body } });
  const one = async (q) => (await db.execute(q)).rows[0];
  const n = async (q) => Number((await one(q)).n);
  const ids = () => sql.join(ALL.map((x) => sql`${x.id}`), sql`, `);
  const memberId = async (x) => (await one(sql`SELECT id FROM "EntraideMember" WHERE "citizenUserId" = ${x.id}`))?.id;
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const S = {};   // ids shared between the steps

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

  describe('closed by default (fail-closed) — a dedicated AIPD comes first', () => {
    const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '' };
    const Z = '00000000-0000-4000-8000-000000000000';
    const probes = async () => [(await call('GET', '/api/citizen/entraide', { as: A })), await browse(A), await join(A, PS.A), await offer(A),
      await act(A, { action: 'request_create', offerId: Z }), await act(A, { action: 'contact_share', requestId: Z, email: MAIL_A, consent: true, consentVersion: CONTACT }),
      await act(A, { action: 'report', offerId: Z, reason: 'SPAM' }), await queue('reported'), await moderate({ action: 'suspend', pseudonym: PS.A, reason: 'SPAM' })];
    it('the current Production configuration (beta, admin + accounts open, narrow or full accounts scope) refuses every Entraide route 503', async () => {
      for (const env of [PROD_NOW, { ...PROD_NOW, ADA_BETA_ACCOUNTS_SCOPE: 'full' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body.error).toBe('PUBLIC_BETA_RESTRICTED'); } });
      }
    });
    it('Production without the beta, or with the surface opened but the capability not listed (other community ones listed): 503 CAPABILITY_NOT_OPEN, nothing written', async () => {
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: 'community.stories,community.testimonials,community.events,community.employment' },
        { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,entraide' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: 'community.entraide' }); } });
      }
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideMember" WHERE "citizenUserId" IN (${ids()})`)).toBe(0);
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose LIKE 'ENTRAIDE_%' AND subject_id IN (${ids()})`)).toBe(0);
    });
    it('the deliberate opening (surface « entraide » AND « community.entraide ») serves the member side, never cached', async () => {
      await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,entraide', ADA_CAPABILITIES_OPEN: 'community.entraide' }, async () => {
        const r = await call('GET', '/api/citizen/entraide', { as: A });
        expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ available: true, member: null, charterVersion: CHARTER });
        expect(r.headers['cache-control']).toBe('no-store');
      });
    });
  });

  describe('joining: adults, the charter, the pseudonymous principal', () => {
    it('anonymous 401; no adult declaration or the minor band 403; no charter / an old version 400; e-mail local part 400 — nothing stored', async () => {
      expect((await act(null, { action: 'join', pseudonym: 'Lune', charter: true, charterVersion: CHARTER })).statusCode).toBe(401);
      for (const x of [NODECL, MINOR]) { const r = await join(x, `EnX${x === MINOR ? 'm' : 'n'}${TAG}`); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('ADULT_ACCOUNT_REQUIRED'); }
      expect((await join(A, PS.A, { charter: undefined })).body.error).toBe('CHARTER_REQUIRED');
      expect((await join(A, PS.A, { charter: 'true' })).body.error).toBe('CHARTER_REQUIRED');
      expect((await join(A, PS.A, { charterVersion: 'old' })).body.error).toBe('CHARTER_REQUIRED');
      expect((await join(A, A.email.split('@')[0])).body.error).toBe('PSEUDONYM_FROM_EMAIL');
      expect((await join(A, 'Marie Dupont')).body.error).toBe('PSEUDONYM_INVALID');
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideMember" WHERE "citizenUserId" IN (${ids()})`)).toBe(0);
      // browsing or offering before joining
      expect((await browse(A)).body.error).toBe('MEMBER_REQUIRED');
      expect((await offer(A)).body.error).toBe('MEMBER_REQUIRED');
    });
    it('never the X01 story pseudonym: the two activities are not linkable', async () => {
      expect((await call('POST', '/api/citizen/stories', { as: ST, body: { action: 'join', pseudonym: PS.ST } })).statusCode).toBe(201);
      const r = await join(ST, PS.ST.toLowerCase());
      expect(r.statusCode).toBe(400); expect(r.body.error).toBe('PSEUDONYM_SAME_AS_COMMUNITY');
    });
    it('A, B, C, D join; one charter ConsentLog row each; unique without regard to case; one per account; the member id is never returned', async () => {
      for (const [x, p] of [[A, PS.A], [B, PS.B], [C, PS.C], [D, PS.D]]) { const r = await join(x, p); expect(r.statusCode, p).toBe(201); expect(r.body.member).toEqual({ pseudonym: p }); }
      const mA = await memberId(A);
      expect(mA).not.toBe(A.id); expect(mA).toMatch(/^[0-9a-f-]{36}$/);
      const c = (await db.execute(sql`SELECT decision, policy_version, policy_hash, proof_level FROM "ConsentLog" WHERE subject_id = ${A.id} AND purpose = 'ENTRAIDE_VOLUNTEER_CHARTER'`)).rows;
      expect(c).toEqual([{ decision: true, policy_version: CHARTER, policy_hash: `${CHARTER}:ENTRAIDE_VOLUNTEER_CHARTER:${mA}`, proof_level: 'EXPLICIT_CHECKBOX' }]);
      const taken = await join(ST, PS.A.toUpperCase()); expect(taken.statusCode).toBe(409); expect(taken.body.error).toBe('PSEUDONYM_TAKEN');
      const again = await join(A, `Other${TAG}`); expect(again.statusCode).toBe(409); expect(again.body.error).toBe('ALREADY_MEMBER');
      const m = await mine(A);
      expect(m.member).toMatchObject({ pseudonym: PS.A, status: 'active', charterCurrent: true });
      expect(JSON.stringify(m)).not.toContain(mA); expect(JSON.stringify(m)).not.toContain(A.id);
    });
    it('a new charter version blocks every write until it is accepted again (ConsentLog row appended)', async () => {
      await db.execute(sql`UPDATE "EntraideMember" SET "charterVersion" = 'x03-old' WHERE "citizenUserId" = ${D.id}`);
      expect((await offer(D)).body.error).toBe('CHARTER_UPDATE_REQUIRED');
      expect((await browse(D)).body.error).toBe('CHARTER_UPDATE_REQUIRED');
      expect((await mine(D)).member.charterCurrent).toBe(false);
      expect((await act(D, { action: 'accept_charter', charter: true, charterVersion: CHARTER })).statusCode).toBe(200);
      expect((await mine(D)).member.charterCurrent).toBe(true);
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${D.id} AND purpose = 'ENTRAIDE_VOLUNTEER_CHARTER' AND decision`)).toBe(2);
    });
  });

  describe('offers and anonymous browsing', () => {
    it('closed lists and note rules: an unknown or sensitive category, an area outside the list, a phone, a link or money in the note 400 — nothing stored', async () => {
      expect((await offer(A, { category: 'HEALTH_SUPPORT' })).body.error).toBe('UNKNOWN_CATEGORY');
      expect((await offer(A, { area: '12 rue du Jeu-des-Enfants' })).body.error).toBe('UNKNOWN_AREA');
      expect((await offer(A, { note: 'Appelez-moi au 06 12 34 56 78' })).body.error).toBe('PHONE_IN_TEXT');
      expect((await offer(A, { note: 'Voir https://exemple.test' })).body.error).toBe('CONTACT_OR_LINK_IN_TEXT');
      expect((await offer(A, { note: '10 € de l’heure' })).body.error).toBe('MONEY_IN_NOTE');
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${A.id}`)).toBe(0);
    });
    it('A offers three times (the fourth open one 409); pause hides an offer from browsing, reopen shows it again', async () => {
      const r1 = await offer(A, { note: `FIXTURE ${TAG} — le samedi matin, près du tram.` });
      expect(r1.statusCode).toBe(201); S.o1 = r1.body.id;
      S.o2 = (await offer(A, { category: 'DIGITAL_HELP', area: 'SCHILTIGHEIM' })).body.id;
      S.o3 = (await offer(A, { category: 'FRENCH_CONVERSATION', area: 'STRASBOURG_CENTRE' })).body.id;
      const fourth = await offer(A, { category: 'PET_CARE' }); expect(fourth.statusCode).toBe(409); expect(fourth.body.error).toBe('TOO_MANY_OFFERS');
      expect((await act(A, { action: 'offer_pause', id: S.o3 })).body.offerStatus).toBe('paused');
      expect((await browse(B)).body.items.map((x) => x.id)).not.toContain(S.o3);
      expect((await act(A, { action: 'offer_reopen', id: S.o3 })).body.offerStatus).toBe('open');
      expect((await browse(B)).body.items.map((x) => x.id)).toContain(S.o3);
      S.c1 = (await offer(C, { category: 'MOVING_HELP', area: 'STRASBOURG_MEINAU' })).body.id;
      S.c2 = (await offer(C, { category: 'SHOPPING', area: 'STRASBOURG_MEINAU' })).body.id;
    });
    it('B browses: anonymous items (id, category, area, note, day) — no pseudonym, member id, account or e-mail; filters by category and area; never one’s own', async () => {
      const r = await browse(B);
      expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      const item = r.body.items.find((x) => x.id === S.o1);
      expect(Object.keys(item).sort()).toEqual(['area', 'category', 'createdOn', 'id', 'note', 'requested']);
      expect(item.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const raw = JSON.stringify(r.body);
      for (const s of [PS.A, PS.C, A.id, A.email, C.id, await memberId(A), await memberId(C), 'memberId', 'pseudonym', 'score']) expect(raw).not.toContain(s);
      const f = await browse(B, '&category=DIGITAL_HELP&area=SCHILTIGHEIM');
      expect(f.body.items.map((x) => x.id)).toEqual(expect.arrayContaining([S.o2]));
      expect(f.body.items.every((x) => x.category === 'DIGITAL_HELP' && x.area === 'SCHILTIGHEIM')).toBe(true);
      expect((await browse(B, '&area=GPS_48.58_7.75')).body.error).toBe('UNKNOWN_AREA');
      expect((await browse(A)).body.items.map((x) => x.id)).not.toEqual(expect.arrayContaining([S.o1]));
    });
  });

  describe('the double opt-in and the contact reveal', () => {
    it('B asks on A’s offer: pending; neither side sees the other’s pseudonym; duplicate 409; A cannot ask on its own offer', async () => {
      const r = await act(B, { action: 'request_create', offerId: S.o1, note: NOTE_B });
      expect(r.statusCode).toBe(201); S.r1 = r.body.id;
      expect((await act(B, { action: 'request_create', offerId: S.o1 })).body.error).toBe('ALREADY_REQUESTED');
      expect((await act(A, { action: 'request_create', offerId: S.o1 })).body.error).toBe('OWN_OFFER');
      const a = await mine(A); const b = await mine(B);
      expect(a.received.find((x) => x.id === S.r1)).toMatchObject({ status: 'pending', note: NOTE_B, partner: null, contacts: null, category: 'SHOPPING' });
      expect(b.sent.find((x) => x.id === S.r1)).toMatchObject({ status: 'pending', partner: null, contacts: null });
      expect(JSON.stringify(a)).not.toContain(PS.B); expect(JSON.stringify(b)).not.toContain(PS.A);
      for (const s of [B.id, B.email, await memberId(B), 'requesterId', 'volunteerId']) expect(JSON.stringify(a)).not.toContain(s);
      expect((await browse(B)).body.items.find((x) => x.id === S.o1).requested).toBe(true);
    });
    it('no e-mail before the mutual acceptance (409); only the volunteer accepts (others 404)', async () => {
      const early = await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B, consent: true, consentVersion: CONTACT });
      expect(early.statusCode).toBe(409); expect(early.body.error).toBe('NOT_ACCEPTED');
      expect((await act(B, { action: 'request_accept', id: S.r1 })).statusCode).toBe(404);
      expect((await act(C, { action: 'request_accept', id: S.r1 })).statusCode).toBe(404);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideContactShare" WHERE "requestId" = ${S.r1}`)).toBe(0);
    });
    it('A accepts: both pseudonyms appear, no e-mail yet', async () => {
      expect((await act(A, { action: 'request_accept', id: S.r1 })).body.requestStatus).toBe('accepted');
      expect((await act(A, { action: 'request_accept', id: S.r1 })).body.error).toBe('NOT_PENDING');
      expect((await mine(A)).received.find((x) => x.id === S.r1)).toMatchObject({ status: 'accepted', partner: PS.B, contacts: { mine: null, theirs: null } });
      expect((await mine(B)).sent.find((x) => x.id === S.r1)).toMatchObject({ status: 'accepted', partner: PS.A, contacts: { mine: null, theirs: null } });
    });
    it('B shares an e-mail: explicit box (400 without), valid address only, ConsentLog row; A sees it, nobody else; once (409); revocable at once', async () => {
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B })).body.error).toBe('CONTACT_CONSENT_REQUIRED');
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: 'pas-une-adresse', consent: true, consentVersion: CONTACT })).body.error).toBe('EMAIL_INVALID');
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B, consent: true, consentVersion: CONTACT })).statusCode).toBe(201);
      expect((await mine(A)).received.find((x) => x.id === S.r1).contacts).toEqual({ mine: null, theirs: MAIL_B });
      expect((await mine(B)).sent.find((x) => x.id === S.r1).contacts).toEqual({ mine: MAIL_B, theirs: null });
      for (const x of [C, D]) { expect(JSON.stringify(await mine(x))).not.toContain(MAIL_B); expect(JSON.stringify((await browse(x)).body)).not.toContain(MAIL_B); }
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B, consent: true, consentVersion: CONTACT })).body.error).toBe('ALREADY_SHARED');
      expect((await act(B, { action: 'contact_revoke', requestId: S.r1 })).body).toMatchObject({ revoked: true });
      expect((await mine(A)).received.find((x) => x.id === S.r1).contacts.theirs).toBeNull();
      const c = (await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${B.id} AND policy_hash = ${`${CONTACT}:ENTRAIDE_CONTACT_SHARE:${S.r1}`} ORDER BY created_at`)).rows;
      expect(c.map((x) => x.decision)).toEqual([true, false]);
    });
    it('both share again; A ends the request: note erased, both e-mails deleted (withdrawals recorded), no reveal afterwards', async () => {
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B, consent: true, consentVersion: CONTACT })).statusCode).toBe(201);
      expect((await act(A, { action: 'contact_share', requestId: S.r1, email: MAIL_A, consent: true, consentVersion: CONTACT })).statusCode).toBe(201);
      expect((await mine(B)).sent.find((x) => x.id === S.r1).contacts).toEqual({ mine: MAIL_B, theirs: MAIL_A });
      expect((await act(A, { action: 'request_end', id: S.r1 })).body.requestStatus).toBe('ended');
      expect(await one(sql`SELECT status, note FROM "EntraideRequest" WHERE id = ${S.r1}`)).toEqual({ status: 'ended', note: null });
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideContactShare" WHERE "requestId" = ${S.r1}`)).toBe(0);
      const bSent = (await mine(B)).sent.find((x) => x.id === S.r1);
      expect(bSent).toMatchObject({ status: 'ended', partner: null, contacts: null });
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id}) AND policy_hash = ${`${CONTACT}:ENTRAIDE_CONTACT_SHARE:${S.r1}`} AND decision = false`)).toBe(3);
      expect((await act(B, { action: 'contact_share', requestId: S.r1, email: MAIL_B, consent: true, consentVersion: CONTACT })).body.error).toBe('NOT_ACCEPTED');
    });
    it('decline (volunteer) and withdraw (requester) erase the note; limits: 3 pending requests at most (409)', async () => {
      const c = await act(C, { action: 'request_create', offerId: S.o2, note: `FIXTURE ${TAG} note C` });
      expect((await act(A, { action: 'request_decline', id: c.body.id })).body.requestStatus).toBe('declined');
      expect(await one(sql`SELECT status, note FROM "EntraideRequest" WHERE id = ${c.body.id}`)).toEqual({ status: 'declined', note: null });
      const d = await act(D, { action: 'request_create', offerId: S.o2, note: `FIXTURE ${TAG} note D` });
      expect((await act(D, { action: 'request_end', id: d.body.id })).body.requestStatus).toBe('withdrawn');
      expect(await one(sql`SELECT status, note FROM "EntraideRequest" WHERE id = ${d.body.id}`)).toEqual({ status: 'withdrawn', note: null });
      for (const o of [S.o1, S.o2, S.c1]) expect((await act(D, { action: 'request_create', offerId: o })).statusCode, o).toBe(201);
      const r = await act(D, { action: 'request_create', offerId: S.c2 }); expect(r.statusCode).toBe(409); expect(r.body.error).toBe('TOO_MANY_PENDING');
    });
  });

  describe('report, block, moderation', () => {
    it('report: closed list (400), never oneself (409), once per pair (409); the reported person never learns who', async () => {
      expect((await act(B, { action: 'report', offerId: S.o1, reason: 'texte libre' })).body.error).toBe('UNKNOWN_REASON');
      expect((await act(A, { action: 'report', offerId: S.o1, reason: 'SPAM' })).body.error).toBe('OWN_OFFER');
      expect((await act(B, { action: 'report', offerId: S.o1, reason: 'MONEY_REQUEST' })).statusCode).toBe(201);
      expect((await act(B, { action: 'report', requestId: S.r1, reason: 'HARASSMENT' })).body.error).toBe('ALREADY_REPORTED');
      expect((await act(D, { action: 'report', offerId: S.o2, reason: 'MONEY_REQUEST' })).statusCode).toBe(201);
      expect(JSON.stringify(await mine(A))).not.toMatch(/MONEY_REQUEST|report/i);
    });
    it('C blocks A (from A’s offer): both ways hidden, requests refused 404, the active request between them ended; unblock restores', async () => {
      const cr = await act(C, { action: 'request_create', offerId: S.o3 }); expect(cr.statusCode).toBe(201);
      const r = await act(C, { action: 'block', offerId: S.o3 });
      expect(r.body).toMatchObject({ blocked: true, endedRequests: 1 });
      expect((await one(sql`SELECT status FROM "EntraideRequest" WHERE id = ${cr.body.id}`)).status).toBe('ended');
      const cIds = (await browse(C)).body.items.map((x) => x.id); for (const o of [S.o1, S.o2, S.o3]) expect(cIds).not.toContain(o);
      const aIds = (await browse(A)).body.items.map((x) => x.id); for (const o of [S.c1, S.c2]) expect(aIds).not.toContain(o);
      expect((await act(C, { action: 'request_create', offerId: S.o1 })).body.error).toBe('OFFER_NOT_FOUND');
      expect((await act(A, { action: 'request_create', offerId: S.c2 })).body.error).toBe('OFFER_NOT_FOUND');
      // D's pending request on C's offer is untouched
      const blocks = (await mine(C)).blocks; expect(blocks).toHaveLength(1); expect(Object.keys(blocks[0]).sort()).toEqual(['createdAt', 'id']);
      expect(JSON.stringify(blocks)).not.toContain(PS.A);
      expect((await act(D, { action: 'unblock', id: blocks[0].id })).statusCode).toBe(404);
      expect((await act(C, { action: 'unblock', id: blocks[0].id })).body).toMatchObject({ unblocked: true });
      expect((await browse(C)).body.items.map((x) => x.id)).toContain(S.o1);
    });
    it('moderation: no session 401, a citizen session is not a moderator, no MFA 403 (reading too)', async () => {
      expect((await call('GET', '/api/admin/entraide?queue=reported')).statusCode).toBe(401);
      expect((await call('GET', '/api/admin/entraide?queue=reported', { as: A })).statusCode).toBe(401);
      const r = await queue('reported', { bearer: adminBearer(false) }); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('HUMAN_MFA_SESSION_REQUIRED');
      expect((await call('POST', '/api/admin/entraide', { bearer: adminBearer(false), body: { action: 'suspend', pseudonym: PS.A, reason: 'SPAM' } })).statusCode).toBe(403);
    });
    it('the reported queue names the pseudonym, the counts per reason and the open offers — never the account, e-mails, member ids, who reported or request notes; audited', async () => {
      const r = await queue('reported');
      expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      const item = r.body.items.find((x) => x.pseudonym === PS.A);
      expect(item).toMatchObject({ status: 'active', reports: { total: 2, reasons: { MONEY_REQUEST: 2 } } });
      expect(item.offers.map((o) => o.id).sort()).toEqual([S.o1, S.o2, S.o3].sort());
      const raw = JSON.stringify(r.body);
      for (const s of [A.id, A.email, B.id, B.email, D.id, PS.B, PS.D, MAIL_A, MAIL_B, NOTE_B, await memberId(A), await memberId(B), 'citizenUserId', 'reporterId', 'memberId']) expect(raw).not.toContain(s);
      expect(await n(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'ENTRAIDE_QUEUE_READ' AND actor = ${ADMIN}`)).toBeGreaterThanOrEqual(1);
    });
    it('suspend needs a reason; it closes the offers (notes erased) and ends the active requests; the member is refused 403 and shown the reason; reinstate', async () => {
      expect((await moderate({ action: 'suspend', pseudonym: PS.A })).body.error).toBe('REASON_REQUIRED');
      const s = await moderate({ action: 'suspend', pseudonym: PS.A.toLowerCase(), reason: 'MONEY_REQUEST' });
      expect(s.statusCode).toBe(200); expect(s.body).toMatchObject({ pseudonym: PS.A, status: 'suspended' }); expect(s.body.endedRequests).toBeGreaterThanOrEqual(2);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideOffer" WHERE id IN (${S.o1}, ${S.o2}, ${S.o3}) AND status = 'closed' AND note IS NULL`)).toBe(3);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideRequest" WHERE "offerId" IN (${S.o1}, ${S.o2}, ${S.o3}) AND status IN ('pending', 'accepted')`)).toBe(0);
      for (const r of [await browse(A), await offer(A, { category: 'PET_CARE' }), await act(A, { action: 'request_create', offerId: S.c1 })]) { expect(r.statusCode).toBe(403); expect(r.body.error).toBe('MEMBER_SUSPENDED'); }
      expect((await mine(A)).member).toMatchObject({ status: 'suspended', suspensionReason: 'MONEY_REQUEST' });
      expect((await queue('suspended')).body.items.map((x) => x.pseudonym)).toContain(PS.A);
      expect((await moderate({ action: 'suspend', pseudonym: PS.A, reason: 'SPAM' })).body.error).toBe('ALREADY_SUSPENDED');
      expect((await moderate({ action: 'reinstate', pseudonym: PS.A })).body.status).toBe('active');
      expect((await browse(A)).statusCode).toBe(200);
      expect((await moderate({ action: 'dismiss_reports', pseudonym: PS.A })).body.dismissed).toBe(2);
      expect((await moderate({ action: 'close_offer', offerId: S.c2, reason: 'SPAM' })).body.status).toBe('closed');
      const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE actor = ${ADMIN} AND entity = 'EntraideMember'`)).rows.map((x) => x.action);
      expect(audit).toEqual(expect.arrayContaining(['ENTRAIDE_SUSPEND', 'ENTRAIDE_REINSTATE', 'ENTRAIDE_DISMISS_REPORTS', 'ENTRAIDE_OFFER_CLOSE', 'ENTRAIDE_QUEUE_READ']));
    });
  });

  describe('isolation and database checks', () => {
    it('another member cannot pause, close, accept, end, revoke or unblock what is not theirs (404)', async () => {
      const o = (await offer(C, { category: 'PET_CARE', area: 'OSTWALD' })).body.id; S.c3 = o;
      const r = (await act(B, { action: 'request_create', offerId: o })).body.id;
      expect((await act(C, { action: 'request_accept', id: r })).statusCode).toBe(200);
      expect((await act(B, { action: 'contact_share', requestId: r, email: MAIL_B, consent: true, consentVersion: CONTACT })).statusCode).toBe(201);
      for (const [body, code] of [[{ action: 'offer_pause', id: o }, 'OFFER_NOT_FOUND'], [{ action: 'offer_close', id: o }, 'OFFER_NOT_FOUND'], [{ action: 'request_end', id: r }, 'REQUEST_NOT_FOUND'],
        [{ action: 'contact_revoke', requestId: r }, 'NOT_SHARED'], [{ action: 'request_decline', id: r }, 'REQUEST_NOT_FOUND']]) {
        const x = await act(D, body); expect(x.statusCode, JSON.stringify(body)).toBe(404); expect(x.body.error).toBe(code);
      }
      const d = JSON.stringify(await mine(D));
      for (const s of [r, MAIL_B, PS.B, PS.C]) expect(d).not.toContain(s);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideContactShare" WHERE "requestId" = ${r}`)).toBe(1);
      S.r2 = r;
    });
    it('the database itself refuses a sensitive category, an address as area, a note on a closed offer or a declined request, a suspension without reason, self-reports, a bad e-mail', async () => {
      const bad = (q) => db.execute(q).then(() => 'ACCEPTED', (e) => `${e?.message} ${e?.cause?.message || ''}`);
      const mC = await memberId(C);
      expect(await bad(sql`INSERT INTO "EntraideOffer" (id, "memberId", category, area, "updatedAt") VALUES (${crypto.randomUUID()}, ${mC}, 'HEALTH_SUPPORT', 'OSTWALD', NOW())`)).toMatch(/EntraideOffer_category_check/);
      expect(await bad(sql`INSERT INTO "EntraideOffer" (id, "memberId", category, area, "updatedAt") VALUES (${crypto.randomUUID()}, ${mC}, 'SHOPPING', '3 rue X', NOW())`)).toMatch(/EntraideOffer_area_check/);
      expect(await bad(sql`UPDATE "EntraideOffer" SET note = 'x' WHERE id = ${S.c2}`)).toMatch(/EntraideOffer_note_check/);
      expect(await bad(sql`UPDATE "EntraideMember" SET status = 'suspended', "suspendedAt" = NOW() WHERE id = ${mC}`)).toMatch(/EntraideMember_status_check/);
      expect(await bad(sql`INSERT INTO "EntraideReport" (id, "reporterId", "targetId", reason) VALUES (${crypto.randomUUID()}, ${mC}, ${mC}, 'SPAM')`)).toMatch(/EntraideReport_self_check/);
      expect(await bad(sql`INSERT INTO "EntraideContactShare" (id, "requestId", "memberId", email) VALUES (${crypto.randomUUID()}, ${S.r2}, ${mC}, '06 12 34 56 78')`)).toMatch(/EntraideContactShare_email_check/);
      expect(await bad(sql`UPDATE "EntraideRequest" SET note = 'x' WHERE status = 'declined' AND "requesterId" = ${mC}`)).toMatch(/EntraideRequest_note_check/);
    });
  });

  describe('DSR export, leaving, erasure and purge step 6c', () => {
    const exp = async (x) => { const r = await call('GET', '/api/auth/export-data', { as: x }); expect(r.statusCode).toBe(200); return typeof r.body === 'string' ? JSON.parse(r.body) : r.body; };
    it('B’s export: pseudonym and charter, the requests B sent (own note), the e-mail B shares, B’s reports (reason only); C’s export: received requests without the note', async () => {
      // B's earlier report went with the dismissal: B reports C (the other side of an accepted request) now
      expect((await act(B, { action: 'report', requestId: S.r2, reason: 'SPAM' })).statusCode).toBe(201);
      const b = await exp(B);
      expect(b.entraideMember).toEqual([expect.objectContaining({ pseudonym: PS.B, status: 'active', charterVersion: CHARTER })]);
      expect(b.entraideRequests.map((x) => x.id)).toEqual(expect.arrayContaining([S.r1, S.r2]));
      expect(b.entraideContactShares).toEqual([expect.objectContaining({ requestId: S.r2, email: MAIL_B })]);
      expect(b.entraideReports.map((x) => Object.keys(x).sort())).toEqual([['createdAt', 'reason']]);
      expect(b.entraideOffers).toEqual([]);
      const c = await exp(C);
      expect(c.entraideOffers.map((x) => x.id)).toEqual(expect.arrayContaining([S.c1, S.c2, S.c3]));
      expect(Object.keys(c.entraideRequestsReceived[0]).sort()).toEqual(['closedAt', 'createdAt', 'decidedAt', 'id', 'offerId', 'status']);
      for (const s of [PS.B, B.id, MAIL_B, await memberId(B)]) expect(JSON.stringify(c)).not.toContain(s);
      expect(c.entraideBlocks.length).toBe(0);
    });
    it('B leaves Entraide: the pseudonym, requests, shared e-mails, reports and blocks are deleted; withdrawals recorded; C’s received request from B is gone; B may join again', async () => {
      const mB = await memberId(B);
      const r = await act(B, { action: 'leave' }); expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ left: true });
      for (const [t, col] of [['EntraideMember', 'id'], ['EntraideRequest', 'requesterId'], ['EntraideContactShare', 'memberId'], ['EntraideReport', 'reporterId'], ['EntraideBlock', 'blockerId']]) {
        expect(await n(sql.raw(`SELECT count(*)::int n FROM "${t}" WHERE "${col}" = '${mB}'`)), t).toBe(0);
      }
      expect((await mine(C)).received.map((x) => x.id)).not.toContain(S.r2);
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${B.id} AND purpose = 'ENTRAIDE_VOLUNTEER_CHARTER' AND decision = false AND withdrawn_at IS NOT NULL`)).toBe(1);
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${B.id} AND policy_hash = ${`${CONTACT}:ENTRAIDE_CONTACT_SHARE:${S.r2}`} AND decision = false`)).toBe(1);
      expect((await mine(B)).member).toBeNull();
      expect((await act(B, { action: 'leave' })).statusCode).toBe(404);
      expect((await join(B, `EnB2${TAG}`)).statusCode).toBe(201);
    });
    it('an approved erasure of C deletes C’s member and everything under it; A and D keep theirs', async () => {
      const keepA = await n(sql`SELECT count(*)::int n FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${A.id}`);
      const mC = await memberId(C);
      const privacy = await import('../../api/_services/privacy.js');
      const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
      const req = await svc.requestDeletion(C.id);
      await svc.updateDsrRequestStatus(req.id, 'APPROVED');
      await svc.executeApprovedDeletion(req.id);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideMember" WHERE id = ${mC}`)).toBe(0);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideOffer" WHERE "memberId" = ${mC}`)).toBe(0);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${A.id}`)).toBe(keepA);
      expect(await memberId(D)).toBeTruthy();
    });
    it('purge step 6c (unverified accounts after 7 days) takes the Entraide member and its offers with the account', async () => {
      const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const step = PURGE_STEPS.find((s) => s.id === 'unverifiedAccountsDeleted');
      const U = u('unverified'); ALL.push(U);
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW() - interval '9 days', NOW())`);
      const m = crypto.randomUUID(); const o = crypto.randomUUID();
      await db.execute(sql`INSERT INTO "EntraideMember" (id, "citizenUserId", pseudonym, "charterVersion", "charterAcceptedAt", "updatedAt") VALUES (${m}, ${U.id}, ${`EnU${TAG}`}, ${CHARTER}, NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "EntraideOffer" (id, "memberId", category, area, "updatedAt") VALUES (${o}, ${m}, 'SHOPPING', 'OSTWALD', NOW())`);
      const out = await step.run(db, { cutoff: () => new Date(Date.now() - 7 * DAY) }, { failures: [] });
      expect(out.count).toBeGreaterThanOrEqual(1);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideMember" WHERE id = ${m}`)).toBe(0);
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideOffer" WHERE id = ${o}`)).toBe(0);
    });
  });
});
