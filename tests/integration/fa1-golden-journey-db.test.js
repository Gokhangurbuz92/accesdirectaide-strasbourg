/**
 * FA-D1 — the GOLDEN JOURNEY of the owner's master directive (§ E, 17/11/2026), LAB_SYNTHETIC: ONE synthetic case, ONE case id, through every approved
 * connected step, on REAL PostgreSQL and THROUGH THE REAL API ENTRY (api/index.js: CSRF, the restricted beta, the surface gate, the R45 capability gate):
 *
 *   a tenant loses their income, falls behind with the rent, needs disability-related help and speaks limited French
 *   → describes it in their own language (fr, en, tr, ar, de, uk): the same three needs, each with official Service-Public sheets (source-backed POSSIBLE
 *     rights — never « you are entitled »); a stale official record is not shown
 *   → territory-correct services: the places that serve Strasbourg (INSEE 67482), never a Haut-Rhin place
 *   → a Mon Parcours plan (one step per need, who acts, next action, official links)
 *   → consented sharing with ONE organisation → an ADA Pro referral the person authorizes → a synthetic decline (LAB_SYNTHETIC) with a suggestion
 *   → a second, correctly scoped route (linked referral to the suggested organisation, which sees its own referral only) → accepted
 *   → the person withdraws consent (stop sharing): every access ends, the live referral closes as CITIZEN_WITHDREW, both organisations are told
 *   → the Observatoire reads aggregates only: no identifier, masked small cells, and the withdrawal changes nothing published
 *   → a named administrator finds the identifiers-only trail and still cannot open the dossier.
 * Every stage is recorded in TRACE under the same case id (CASE) with the API route, the database rows and the audit actions it produced; the last test
 * checks the trace is complete. Negative and cross-tenant adversarial attempts (another person, another organisation, a former receiver, an institution
 * of another territory, forged / missing credentials) are made at the stage where they matter.
 *
 * What this is NOT: a real user, a real partner's decision, a legal entitlement, a delivered e-mail (in-memory « test » mailer), real HDS hosting (the
 * attestation is a SYNTHETIC LAB token, format check only). The browser layer of the same journey is e2e-fa1/golden.pw.mjs. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quotas: infrastructure, not under test
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
/** the ONE synthetic case id: every row this journey writes carries it (ids, names, e-mail) so it can be traced — and searched for in what must not show it */
const CASE = `fa1-golden-${TS}`;
const S = { X: `${CASE}-X`, Y: `${CASE}-Y`, Z: `${CASE}-Z`, M: `${CASE}-M` };
const NAME = { X: `FA1 Accueil social ${TS}`, Y: `FA1 Bailleur social ${TS}`, Z: `FA1 Prévention expulsions ${TS}`, M: `FA1 Haut-Rhin ${TS}` };
// X, Y, Z: Strasbourg / Eurométropole (Z sits in Schiltigheim and declares Strasbourg in its reviewed service area); M: Mulhouse (Haut-Rhin), another tenant
const PLACE = { X: ['Strasbourg', '67000', '{67482}'], Y: ['Strasbourg', '67100', '{67482}'], Z: ['Schiltigheim', '67300', '{67447,67482}'], M: ['Mulhouse', '68100', '{68224}'] };
const P = { xa: { id: `${CASE}-xa`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `${CASE}-x1`, st: S.X, role: 'PRO' },
  y1: { id: `${CASE}-y1`, st: S.Y, role: 'STRUCTURE_ADMIN' }, z1: { id: `${CASE}-z1`, st: S.Z, role: 'STRUCTURE_ADMIN' }, m1: { id: `${CASE}-m1`, st: S.M, role: 'STRUCTURE_ADMIN' } };
const X_MEMBERS = 2;
const CIT = { id: `${CASE}-cit`, email: `${CASE}-cit@example.test` };
const OTHER = { id: `${CASE}-other`, email: `${CASE}-other@example.test` };
const INST = { id: `${CASE}-inst`, email: `${CASE}-inst@example.test`, passwordHash: `synthetic-not-a-hash-${TS}` };
const INST68 = { id: `${CASE}-inst68`, email: `${CASE}-inst68@example.test`, passwordHash: `synthetic-not-a-hash-68-${TS}` };
const ADMIN = `${CASE}-admin@example.test`;
// published LAB guides for the official sheets of the three needs (the orientation resolves a published sheet to its page on the site)
const GUIDE = { expulsion: { id: `${CASE}-g1`, slug: `${CASE}-f31272` }, handicap: { id: `${CASE}-g2`, slug: `${CASE}-f24610` } };
const AIDE = { fresh: { id: `${CASE}-a1`, slug: `${CASE}-aide-fresh` }, aging: { id: `${CASE}-a2`, slug: `${CASE}-aide-aging` }, stale: { id: `${CASE}-a3`, slug: `${CASE}-aide-stale` } };
const SECRET = `note-interne-du-bailleur-${CASE}`;
const NEEDS = ['expulsion-impayes', 'minima-sociaux', 'mdph-droits'];
const WORD = `fa1golden${TS}`;   // a service word only this case's organisations declare: the territory query cannot be crowded out by other suites' places
/** the same situation, said by a person with limited French in each of the six interface languages */
const SAID = {
  fr: 'je n\'arrive plus à payer mon loyer, j\'ai perdu mes revenus et je dois faire un dossier MDPH pour mon handicap',
  en: 'I can\'t pay my rent, I lost my income and I need help with my disability application',
  tr: 'kiramı ödeyemiyorum, gelirim yok, engelli raporu başvurusu yapmam lazım',
  ar: 'لا أستطيع دفع الإيجار، ليس لدي دخل، وأحتاج ملف الإعاقة',
  de: 'Ich kann die Miete nicht mehr zahlen, ich habe kein Einkommen und brauche einen Antrag wegen Behinderung',
  uk: 'Я не можу платити за оренду, у мене немає доходу, потрібна заява на інвалідність',
};
const CSRF = `fa1csrf${TS}`;
const LAB_HDS = `HDS1:lab-synthetic:FA1-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'MAILER_PROVIDER', 'MAILER_FROM'];
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)(`FA-D1 golden journey — one synthetic case (${'fa1-golden-*'}) through every connected step (real DB, real API entry, LAB_SYNTHETIC)`, () => {
  let db, api, auth, userAuth, instAuth, mailer, schema;
  const saved = {};
  const J = {};          // ids produced by one stage and used by the next
  const TRACE = [];      // [stage, api route, db rows, audit actions] — the same case id at every junction
  const trace = (stage, route, rows, audit = []) => TRACE.push({ case: CASE, stage, route, rows, audit });
  /** as: { cit } | { other } | { pro: P.x } | { inst } | { inst68 } | { admin } | { anon } | { forged } ; noCsrf: drop the double-submit pair */
  const call = async (method, url, { as = {}, body, headers = {}, noCsrf = false } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http' };
    const csrf = noCsrf ? {} : { 'x-csrf-token': CSRF };
    const citizenCookie = (who) => `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: who.id, email: who.email })).split(';')[0]}${noCsrf ? '' : `; __csrf=${CSRF}`}`;
    if (as.cit) Object.assign(h, { cookie: citizenCookie(CIT) }, csrf);
    if (as.other) Object.assign(h, { cookie: citizenCookie(OTHER) }, csrf);
    if (as.anon) Object.assign(h, { cookie: `__csrf=${CSRF}` }, csrf);
    if (as.forged) {   // the golden person's session, signed with ANOTHER secret
      const real = process.env.JWT_SECRET; process.env.JWT_SECRET = `forged-${TS}-0123456789abcdef0123456789abcdef`;
      const ck = (() => { try { return userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]; } finally { process.env.JWT_SECRET = real; } })();
      Object.assign(h, { cookie: `${ck}; __csrf=${CSRF}` }, csrf);
    }
    if (as.pro) h.authorization = `Bearer ${auth.signProToken({ id: as.pro.id, email: `${as.pro.id}@example.test`, structureId: as.pro.st, role: as.pro.role })}`;
    if (as.inst) h.authorization = `Bearer ${instAuth.signInstitutionToken(INST)}`;
    if (as.inst68) h.authorization = `Bearer ${instAuth.signInstitutionToken(INST68)}`;
    if (as.admin) h.authorization = `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true })}`;
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: { ...h, ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const ok = (r, code = 200) => { expect(r.statusCode, JSON.stringify(r.body)).toBe(code); return r.body; };
  const refused = (r) => expect([400, 401, 403, 404, 409], JSON.stringify(r.body)).toContain(r.statusCode);
  const owner = (action, extra = {}, as = { cit: true }) => call('POST', '/api/public/dossier-grants', { as, body: { shareId: J.shareId, action, ...extra } });
  const refPost = (p, body) => call('POST', '/api/pro/referrals', { as: { pro: p }, body });
  const refOne = (p, id) => call('GET', `/api/pro/referrals?id=${encodeURIComponent(id)}`, { as: { pro: p } });
  const dossier = (p) => call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: p } });
  const mine = async (id) => ok(await call('GET', '/api/citizen/referrals', { as: { cit: true } })).referrals.find((r) => r.id === id);
  const grantActive = async (st) => (await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${st} AND "revokedAt" IS NULL`)).rows[0].n;
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const notices = async (st, type, id) => (await db.execute(sql`SELECT type, metadata FROM "ProNotification" WHERE "structureId" = ${st} AND type = ${type}`)).rows.filter((n) => !id || n.metadata?.referralId === id);
  // logProAudit writes the platform AuditLog (entity ProUser, the organisation in details.structureId)
  const proAudit = async (action) => (await db.execute(sql`SELECT action, details->>'structureId' AS "structureId", details FROM "AuditLog" WHERE action = ${action} AND details->>'shareId' = ${J.shareId}`)).rows;
  const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // nothing open (the Production default), then exactly the surfaces and capabilities of this journey; HDS-bound ones with a SYNTHETIC LAB attestation
    setEnv({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts,pro,documents,diagnostic,institution,admin', ADA_BETA_ACCOUNTS_SCOPE: 'full',
      ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.orientation_records,citizen.shared_dossier,citizen.saved_diagnostic,pro.case_management,pro.referrals,institution.portal',
      ADA_HDS_CERTIFIED_HOSTING: LAB_HDS, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' });
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    instAuth = await import('../../api/_utils/institution-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    for (const k of ['X', 'Y', 'Z', 'M']) {
      const [ville, cp, insee] = PLACE[k];
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, departement, insee_codes, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, data_origin, "updatedAt", "createdAt")
        VALUES (${S[k]}, ${NAME[k]}, ${S[k]}, 'association', '1 rue fictive', ${ville}, ${cp}, ${cp.slice(0, 2)}, ${insee}::text[], ${k === 'Z'}, ${`{accompagnement logement,${WORD}}`}::text[], '{tout_public}'::text[], '{social}'::text[], 'actif', 'VERIFIED', 'synthetic_fixture', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    for (const c of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await db.insert(schema.Guide).values({ id: GUIDE.expulsion.id, slug: GUIDE.expulsion.slug, titre: `Fiche synthétique impayés de loyer ${CASE}`, statut: 'publie', publics: [], contexte: [], mots_cles: [], sources_urls: [] });
    await db.insert(schema.Guide).values({ id: GUIDE.handicap.id, slug: GUIDE.handicap.slug, titre: `Fiche synthétique enfant ou adulte handicapé ${CASE}`, statut: 'publie', publics: [], contexte: [], mots_cles: [], sources_urls: [] });
    // three OFFICIAL records of the same right, verified 3, 120 and 200 days ago: current, « update needed », and beyond the 180-day limit (stale)
    for (const [k, days] of [['fresh', 3], ['aging', 120], ['stale', 200]]) {
      await db.insert(schema.Aide).values({ id: AIDE[k].id, slug: AIDE[k].slug, titre: `Aide synthétique ${k} ${CASE}`, statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev@example.test',
        territory_verified: true, data_origin: 'official', date_verification: new Date(Date.now() - days * 86400000), source_url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', ou_demander: 'Auprès de la Caf' });
    }
    await db.execute(sql`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, "recordedBy", "signedAt", "documentRef", "signedByPartner") VALUES (${`${CASE}-ag`}, 'Partenaire synthétique FA1', 'CONVENTION', 'SIGNED', ${ADMIN}, CURRENT_DATE - 1, 'SYNTHETIC-TEST-ONLY-FA1', 'Signataire synthétique')`);
    for (const [i, terr] of [[INST, 'Bas-Rhin'], [INST68, 'Haut-Rhin']]) {
      await db.execute(sql`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES (${i.id}, ${i.email}, ${i.passwordHash}, ${`Institution synthétique ${terr}`}, ${terr}, 'ACTIVE', ${`${CASE}-ag`}, ${ADMIN})`);
    }
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${`${CASE}-adm`}, ${ADMIN}, 'x', 'admin', NOW(), NOW(), 0, true)`);
    mailer.__clearTestOutbox();
  }, 90000);

  afterAll(async () => {
    setEnv(saved);
    if (!db) return;
    const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
    const refIds = sql`SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId || ''}`;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (${refIds})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${J.shareId || ''} OR actor_id IN (${INST.id}, ${INST68.id}, ${ADMIN}) OR actor = ${ADMIN}`).catch(() => {});
    if (J.shareId) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${J.shareId}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts}) OR details->>'shareId' = ${J.shareId || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`).catch(() => {});
    for (const c of [CIT, OTHER]) {
      await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM "Guide" WHERE id IN (${GUIDE.expulsion.id}, ${GUIDE.handicap.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Aide" WHERE id IN (${AIDE.fresh.id}, ${AIDE.aging.id}, ${AIDE.stale.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE id IN (${INST.id}, ${INST68.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE id = ${`${CASE}-ag`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${ADMIN}`).catch(() => {});
  });

  // ─────────────── G1. limited French: the same situation in six languages → the same needs, with official sources ───────────────
  it('G1 · limited French: said in fr, en, tr, ar, de or uk, the situation gives the SAME three needs, each with official Service-Public sheets; the published sheets resolve to their page', async () => {
    for (const [lang, query] of Object.entries(SAID)) {
      const out = ok(await call('POST', '/api/search', { as: { anon: true }, body: { query, lang } }));
      const ids = out.orientation?.needs?.map((n) => n.id) || [];
      expect(ids, `${lang}: ${query}`).toEqual(expect.arrayContaining(NEEDS));
      expect(out.orientation.multi).toBe(true);
      if (lang !== 'fr') expect(out.crossLanguage?.understood, lang).toBe(true);
      // every cited sheet is an official Service-Public URL; nothing in the orientation claims a right
      for (const [id, src] of Object.entries(out.orientation.sources)) expect(src.url, id).toMatch(/^https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/F\d+$/);
      expect(JSON.stringify(out.orientation)).not.toMatch(/vous (avez|êtes) (droit|éligible)|you are (entitled|eligible)/i);
      if (lang === 'ar') J.orientation = out.orientation;   // the person's own language in the rest of the journey
    }
  }, 180000);
  it('G1a · the orientation of the person\'s own language (ar) resolves the published sheets to their page on the site', async () => {
    const o = J.orientation;
    // a published sheet resolves to its page on the site (this case's LAB guide, or another published guide of the same sheet on a shared database)
    expect(o.sources.F31272.slug).toMatch(/-f31272$/);
    expect(o.sources.F24610.slug).toMatch(/-f24610$/);
    expect(o.sources.F19778.url).toBe('https://www.service-public.gouv.fr/particuliers/vosdroits/F19778');
    trace('G1a need → possible rights (six languages)', 'POST /api/search', { guides: [GUIDE.expulsion.id, GUIDE.handicap.id] });
  });

  it('G1b · source freshness: the official record verified 3 days ago is current, 120 days ago says « update needed », 200 days ago (beyond the 180-day rule) is not shown at all', async () => {
    expect(ok(await call('GET', `/api/aides/${AIDE.fresh.slug}`)).provenance).toMatchObject({ contentStatus: 'VERIFIED', freshness: 'current' });
    expect(ok(await call('GET', `/api/aides/${AIDE.aging.slug}`)).provenance).toMatchObject({ contentStatus: 'VERIFIED', freshness: 'update_needed' });
    expect((await call('GET', `/api/aides/${AIDE.stale.slug}`)).statusCode).toBe(404);
    trace('G1b stale source withheld', 'GET /api/aides/:slug', { aides: [AIDE.fresh.id, AIDE.aging.id, AIDE.stale.id] });
  });

  // ─────────────── G2. territory-correct services ───────────────
  it('G2 · territory-correct services: the places serving Strasbourg (INSEE 67482) are the three Bas-Rhin ones, never the Haut-Rhin one; the Haut-Rhin place serves Mulhouse only', async () => {
    const ids = (r) => ok(r).items.map((i) => i.id);
    const strasbourg = ids(await call('GET', `/api/structures?serves=67482&q=${WORD}&pageSize=50`));
    expect(strasbourg).toEqual(expect.arrayContaining([S.X, S.Y, S.Z]));
    expect(strasbourg).not.toContain(S.M);
    const mulhouse = ids(await call('GET', `/api/structures?serves=68224&q=${WORD}&pageSize=50`));
    expect(mulhouse).toContain(S.M);
    for (const k of ['X', 'Y', 'Z']) expect(mulhouse).not.toContain(S[k]);
    // by département too
    const dep67 = ids(await call('GET', `/api/structures?departement=67&q=${WORD}&pageSize=50`));
    expect(dep67).toEqual(expect.arrayContaining([S.X, S.Y, S.Z]));
    expect(dep67).not.toContain(S.M);
    trace('G2 territory-correct services', 'GET /api/structures?serves=67482', { structures: [S.X, S.Y, S.Z], excluded: [S.M] });
  });

  // ─────────────── G3. Mon Parcours plan ───────────────
  it('G3 · Mon Parcours: an anonymous visitor cannot keep anything; signed in, each need becomes ONE step (need, official links, next action), the housing step names a professional and « share the dossier »', async () => {
    expect((await call('POST', '/api/citizen/parcours', { as: { anon: true }, body: { action: 'add', title: 'x' } })).statusCode).toBe(401);
    const o = J.orientation; J.steps = {};
    for (const id of NEEDS) {
      const n = o.needs.find((x) => x.id === id);
      const published = n.sheets.filter((s) => o.sources[s]?.slug);
      const links = n.sheets.map((s) => o.sources[s]).filter((s) => s.url.startsWith('https://www.service-public.gouv.fr/')).slice(0, 5).map((s) => ({ url: s.url, label: s.title }));
      const add = await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'add', title: n.label, ...(published.length ? { records: published.map((s) => ({ type: 'guide', id: o.sources[s].slug })) } : {}),
        planStep: { need: id, links, nextActionKey: 'read_record' } } });
      J.steps[id] = ok(add, 201).item.id;
    }
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'plan', id: J.steps['expulsion-impayes'], planStep: { actor: { kind: 'professional' }, nextActionKey: 'share_dossier' } } }));
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'status', id: J.steps['expulsion-impayes'], status: 'IN_PROGRESS' } }));
    const items = ok(await call('GET', '/api/citizen/parcours', { as: { cit: true } })).items;
    expect(items.filter((i) => Object.values(J.steps).includes(i.id))).toHaveLength(3);
    const housing = items.find((i) => i.id === J.steps['expulsion-impayes']);
    expect(housing).toMatchObject({ status: 'IN_PROGRESS', step: { need: { id: 'expulsion-impayes' }, actor: { kind: 'professional' }, nextActionKey: 'share_dossier' } });
    expect(housing.records[0]).toMatchObject({ type: 'guide', available: true, href: `/bonnes-pratiques/${J.orientation.sources.F31272.slug}` });
    expect(items.find((i) => i.id === J.steps['minima-sociaux']).step.links[0].url).toBe('https://www.service-public.gouv.fr/particuliers/vosdroits/F19778');
    // adversarial: another person sees none of it and cannot change it
    const theirs = ok(await call('GET', '/api/citizen/parcours', { as: { other: true } })).items;
    expect(theirs.map((i) => i.id)).not.toEqual(expect.arrayContaining([J.steps['expulsion-impayes']]));
    refused(await call('POST', '/api/citizen/parcours', { as: { other: true }, body: { action: 'status', id: J.steps['expulsion-impayes'], status: 'CLOSED' } }));
    expect((await call('GET', '/api/citizen/parcours', { as: { forged: true } })).statusCode).toBe(401);
    expect((await call('POST', '/api/citizen/parcours', { as: { cit: true }, noCsrf: true, body: { action: 'add', title: 'sans jeton' } })).statusCode).toBe(403);
    const rows = (await db.execute(sql`SELECT id FROM "ParcoursItem" WHERE "userId" = ${CIT.id}`)).rows.map((r) => r.id);
    expect(rows).toHaveLength(3);
    trace('G3 Mon Parcours plan', 'POST /api/citizen/parcours', { ParcoursItem: rows });
  });

  // ─────────────── G4. consented sharing with ONE organisation ───────────────
  it('G4 · consent to share: the person saves a dossier and invites ONE organisation (X, territory-correct); nothing is readable before X redeems; no other organisation has access', async () => {
    const created = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000', needs: NEEDS }, results: { rights: [] } } }));
    Object.assign(J, { shareId: created.shareId, ownerSecret: created.ownerSecret });
    expect((await dossier(P.x1)).statusCode).toBe(404);
    // adversarial: another person, or the right person without the owner's session or secret, cannot invite
    expect((await owner('invite', { structureId: S.M }, { other: true })).statusCode).toBe(404);
    expect((await owner('invite', { structureId: S.M }, { anon: true })).statusCode).toBe(404);
    const inv = ok(await owner('invite', { structureId: S.X }), 201);
    // adversarial: the invitation is bound to X — M cannot redeem it
    refused(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.m1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    ok(await dossier(P.x1));
    for (const st of [S.Y, S.Z, S.M]) expect(await grantActive(st)).toBe(0);
    // a used invitation stays bound to X: redeeming it again is idempotent for X and still refused to M
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    expect(await grantActive(S.X)).toBe(1);
    refused(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.m1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    expect(await grantActive(S.M)).toBe(0);
    expect((await proAudit('DOSSIER_INVITE_CREATED')).map((a) => a.structureId)).toEqual([S.X]);
    trace('G4 consented sharing', 'POST /api/public/dossier-grants {invite} · POST /api/pro/dossier/redeem', { SharedDiagnostic: J.shareId, SharedDossierGrant: [S.X] }, ['DOSSIER_INVITE_CREATED']);
  });

  // ─────────────── G5. ADA Pro referral, authorized by the person ───────────────
  it('G5 · ADA Pro: X\'s administrator assigns the case (a plain member cannot); the member proposes a referral to Y; nothing reaches Y until the person accepts', async () => {
    const queue = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases;
    J.caseId = queue.find((c) => c.dossierId === J.shareId).id;
    refused(await call('POST', '/api/pro/cases', { as: { pro: P.m1 }, body: { action: 'assign', id: J.caseId, userId: P.m1.id } }));   // another tenant
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.xa }, body: { action: 'assign', id: J.caseId, userId: P.x1.id } }));
    refused(await refPost(P.m1, { action: 'propose', caseId: J.caseId, toStructureId: S.Y, reasonCode: 'HOUSING' }));   // another tenant cannot refer this case
    const p = ok(await refPost(P.x1, { action: 'propose', caseId: J.caseId, toStructureId: S.Y, reasonCode: 'HOUSING', message: `logement-${CASE}` }), 201);
    J.a = p.referral.id;
    expect(await grantActive(S.Y)).toBe(0);
    expect((await refOne(P.y1, J.a)).statusCode).toBe(404);
    expect(await mine(J.a)).toMatchObject({ status: 'PENDING_CITIZEN', to: NAME.Y, nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' } });
    // adversarial: another person cannot decide it
    refused(await call('POST', '/api/citizen/referrals', { as: { other: true }, body: { id: J.a, decision: 'accept' } }));
    expect(await grantActive(S.Y)).toBe(0);
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.a, decision: 'accept' } }));
    expect(await grantActive(S.Y)).toBe(1);
    trace('G5 consented ADA Pro referral', 'POST /api/pro/referrals {propose} · POST /api/citizen/referrals {accept}', { ProCase: J.caseId, Referral: J.a, SharedDossierGrant: [S.Y] });
  });

  // ─────────────── G6. synthetic decline ───────────────
  it('G6 · synthetic decline (LAB_SYNTHETIC): Y reads through its grant and declines with a suggestion (Z); Y\'s access ends; Z learns nothing; the person gets the motive, never Y\'s internal note', async () => {
    ok(await dossier(P.y1));
    ok(await refPost(P.y1, { action: 'decline', id: J.a, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId: S.Z, message: SECRET }));
    expect(await grantActive(S.Y)).toBe(0);
    expect((await dossier(P.y1)).statusCode).toBe(404);   // the former receiver cannot read any more
    refused(await refPost(P.y1, { action: 'accept', id: J.a }));   // nor change its mind on a closed answer
    expect((await refOne(P.z1, J.a)).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" = ${S.Z}`)).rows[0].n).toBe(0);
    const person = await mine(J.a);
    expect(person).toMatchObject({ status: 'DECLINED', responseCode: 'REDIRECT_SUGGESTED', suggested: NAME.Z, nextAction: { code: 'SENDER_PROPOSE_SUGGESTED' } });
    expect(JSON.stringify(person)).not.toContain(SECRET);
    expect((await notices(S.X, 'referral_declined', J.a)).length).toBe(X_MEMBERS);
    trace('G6 synthetic decline', 'POST /api/pro/referrals {decline}', { Referral: J.a, ReferralEvent: 'DECLINED' }, ['REFERRAL_REDIRECT_SUGGESTED']);
  });

  // ─────────────── G7. second, correctly scoped route ───────────────
  it('G7 · second route: X follows the suggestion with a LINKED referral to Z; the person authorizes it; Z sees its own referral and the dossier only — not Y, not Y\'s note, not the first referral; Z accepts', async () => {
    const b = ok(await refPost(P.x1, { action: 'propose', caseId: J.caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: J.a, message: `suite-${CASE}` }), 201);
    J.b = b.referral.id;
    expect(await row(J.b)).toMatchObject({ status: 'PENDING_CITIZEN', previousReferralId: J.a, toStructureId: S.Z });
    expect(await mine(J.b)).toMatchObject({ previousId: J.a, nextAction: { code: 'CITIZEN_DECIDE' } });
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.b, decision: 'accept' } }));
    expect(await grantActive(S.Z)).toBe(1);
    const z = ok(await refOne(P.z1, J.b));
    expect(z.referral.previous).toBeNull();
    for (const hidden of [J.a, SECRET, NAME.Y, `logement-${CASE}`]) expect(JSON.stringify(z)).not.toContain(hidden);
    ok(await dossier(P.z1));
    // adversarial: the Haut-Rhin tenant still has nothing; Y cannot see the new referral
    expect((await dossier(P.m1)).statusCode).toBe(404);
    expect((await refOne(P.m1, J.b)).statusCode).toBe(404);
    expect((await refOne(P.y1, J.b)).statusCode).toBe(404);
    ok(await refPost(P.z1, { action: 'acknowledge', id: J.b }));
    ok(await refPost(P.z1, { action: 'accept', id: J.b }));
    expect(await mine(J.b)).toMatchObject({ status: 'ACCEPTED', nextAction: { code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' } });
    expect((await notices(S.X, 'referral_accepted', J.b)).length).toBe(X_MEMBERS);
    trace('G7 second route', 'POST /api/pro/referrals {propose previousReferralId, acknowledge, accept}', { Referral: J.b, previousReferralId: J.a, SharedDossierGrant: [S.Z] }, ['REFERRAL_REDIRECT_PROPOSED']);
  });

  // ─────────────── G8. consent withdrawal ───────────────
  it('G8 · consent withdrawal: the person stops sharing; every access ends, the live referral closes as CITIZEN_WITHDREW (event by the CITIZEN), X and Z are told, and nobody can act on the dossier any more', async () => {
    const before = (await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId}`)).rows[0].n;
    // adversarial first: another person, or the session of nobody, cannot stop it (uniform 404, nothing changes)
    expect((await owner('stop_sharing', {}, { other: true })).statusCode).toBe(404);
    expect(await grantActive(S.Z)).toBe(1);
    const out = ok(await owner('stop_sharing'));
    expect(out).toMatchObject({ ok: true, grants: 2, referralsClosed: 1 });   // X and Z
    for (const st of [S.X, S.Y, S.Z, S.M]) expect(await grantActive(st)).toBe(0);
    expect(await row(J.b)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    const last = (await db.execute(sql`SELECT "actorType" a, "toStatus" s FROM "ReferralEvent" WHERE "referralId" = ${J.b} ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
    expect(last).toEqual({ a: 'CITIZEN', s: 'CANCELLED' });
    expect((await notices(S.Z, 'referral_cancelled', J.b)).length).toBe(1);
    expect((await notices(S.X, 'referral_cancelled', J.b)).length).toBe(X_MEMBERS);
    expect((await proAudit('DOSSIER_SHARING_STOPPED_BY_OWNER')).length).toBe(1);
    // nobody can read or act any more
    for (const p of [P.x1, P.z1, P.y1]) expect((await dossier(p)).statusCode, p.id).toBe(404);
    refused(await refPost(P.z1, { action: 'start', id: J.b }));
    refused(await refPost(P.x1, { action: 'propose', caseId: J.caseId, toStructureId: S.Z, reasonCode: 'HOUSING' }));
    expect((await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId}`)).rows[0].n).toBe(before);
    // the person still sees their own history, honestly
    expect(await mine(J.b)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    // the dossier stays the person's: erasure is a separate, explicit act (not done here)
    expect((await db.execute(sql`SELECT count(*)::int n FROM "SharedDiagnostic" WHERE id = ${J.shareId}`)).rows[0].n).toBe(1);
    trace('G8 consent withdrawal', 'POST /api/public/dossier-grants {stop_sharing}', { Referral: J.b, outcome: 'CITIZEN_WITHDREW', SharedDossierGrant: 'all revoked' }, ['DOSSIER_SHARING_STOPPED_BY_OWNER']);
  });

  // ─────────────── G9. Observatoire: aggregates only, no inference ───────────────
  it('G9 · Observatoire: dated in the last complete quarter, the case appears in no published cell (masked), no identifier is published, the withdrawal changes nothing published, and another territory is refused', async () => {
    const { periodWindow } = await import('../../api/_services/stat-periods.js');
    const q = periodWindow('quarter', new Date());   // the last COMPLETE calendar quarter
    const inQuarter = new Date(q.start.getTime() + 10 * 86400000);
    await db.execute(sql`UPDATE "Referral" SET "createdAt" = ${inQuarter}, "sentAt" = ${inQuarter}, "respondedAt" = ${inQuarter} WHERE "sharedDiagnosticId" = ${J.shareId}`);
    const read = async (as = { inst: true }) => ok(await call('GET', '/api/institution/observatoire', { as }));
    const first = await read();
    const body = JSON.stringify(first);
    for (const hidden of [CASE, J.shareId, J.a, J.b, J.caseId, S.X, S.Y, S.Z, NAME.X, NAME.Y, NAME.Z, CIT.email, SECRET]) expect(body, String(hidden)).not.toContain(hidden);
    // every published count is either masked (null) or at least the k-anonymity minimum: the case's 2 referrals can never be a published cell
    const kMin = first.kAnonymityMin;
    expect(kMin).toBeGreaterThanOrEqual(5);
    const counts = [];
    const walk = (v, k = '') => { if (Array.isArray(v)) v.forEach((x) => walk(x, k)); else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, x]) => walk(x, kk)); else if (typeof v === 'number' && /^(sent|unmet|outOfScope)$|orient|referral|count/i.test(k)) counts.push([k, v]); };
    walk({ byNeed: first.byNeed, byCommune: first.byCommune, totals: first.totals, trend: first.trend });
    expect(counts.filter(([, v]) => v > 0 && v < kMin), JSON.stringify(counts)).toEqual([]);
    // the case's two referrals ARE in that quarter's base: the quarter's published count is masked, not a 2
    expect(first.trend.find((t) => t.quarter === q.label), q.label).toMatchObject({ sent: null });
    console.log(`[FA1 G9 observatoire LAB_SYNTHETIC] quarter=${q.label} trend=${JSON.stringify(first.trend)} numericCells=${counts.length}`);
    // the person's withdrawal: nothing published moves (a closed quarter is frozen; a masked cell's change is invisible)
    const again = await read();
    expect(JSON.stringify({ ...again, generatedAt: null })).toBe(JSON.stringify({ ...first, generatedAt: null }));
    // the institution's territory is decided by the server: a parameter is refused, the Haut-Rhin account never reads Bas-Rhin
    expect((await call('GET', '/api/institution/observatoire?territory=Bas-Rhin', { as: { inst68: true } })).statusCode).toBe(400);
    const other = await read({ inst68: true });
    for (const hidden of [CASE, S.X, S.Y, S.Z, NAME.Z]) expect(JSON.stringify(other)).not.toContain(hidden);
    // no institution reads a person-level route
    for (const url of ['/api/pro/referrals?box=inbox', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, '/api/citizen/referrals', '/api/citizen/parcours']) {
      expect([401, 403, 404], url).toContain((await call('GET', url, { as: { inst: true } })).statusCode);
    }
    trace('G9 Observatoire (aggregate-only)', 'GET /api/institution/observatoire', { masked: true, kAnonymityMin: kMin });
  });

  // ─────────────── G10. administration ───────────────
  it('G10 · Administration: a named MFA administrator finds the case\'s trail (identifiers only, never Y\'s note) and still cannot open the dossier, the case, the referrals or the plan', async () => {
    const a = ok(await call('GET', `/api/admin/audit-log?entity=Referral&entityId=${encodeURIComponent(J.a)}`, { as: { admin: true } })).items;
    expect(a.map((i) => i.action)).toEqual(expect.arrayContaining(['REFERRAL_REDIRECT_SUGGESTED']));
    const b = ok(await call('GET', `/api/admin/audit-log?entity=Referral&entityId=${encodeURIComponent(J.b)}`, { as: { admin: true } })).items;
    expect(b.find((i) => i.action === 'REFERRAL_REDIRECT_PROPOSED').details).toMatchObject({ previousReferralId: J.a, followsSuggestion: true });
    expect(JSON.stringify([...a, ...b])).not.toContain(SECRET);
    for (const url of [`/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, '/api/pro/cases?scope=unassigned', '/api/pro/referrals', '/api/citizen/referrals', '/api/citizen/parcours']) {
      expect([401, 403, 404], url).toContain((await call('GET', url, { as: { admin: true } })).statusCode);
    }
    trace('G10 administration trail', 'GET /api/admin/audit-log', { entity: 'Referral', ids: [J.a, J.b] }, ['REFERRAL_REDIRECT_SUGGESTED', 'REFERRAL_REDIRECT_PROPOSED']);
  });

  // ─────────────── G11. the person's side, in their language; the trace ───────────────
  it('G11 · the person\'s side: the plan step is closed honestly by the person (outcome unknown), the e-mails of the journey were recorded in the LAB outbox (not delivered), and the trace covers every stage under ONE case id', async () => {
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'status', id: J.steps['expulsion-impayes'], status: 'OUTCOME_UNKNOWN' } }));
    const item = ok(await call('GET', '/api/citizen/parcours', { as: { cit: true } })).items.find((i) => i.id === J.steps['expulsion-impayes']);
    expect(item).toMatchObject({ status: 'CLOSED', closure: 'OUTCOME_UNKNOWN' });
    // the in-app centre: the decisions asked of the person are gone, the answers are there, with no names and no ids
    const centre = ok(await call('GET', '/api/citizen/notifications', { as: { cit: true } }));
    expect(centre.notifications.filter((n) => n.kind === 'REFERRAL_DECISION_NEEDED')).toEqual([]);
    expect(centre.notifications.filter((n) => n.kind === 'REFERRAL_ANSWER').length).toBeGreaterThanOrEqual(3);
    for (const hidden of [NAME.Y, NAME.Z, J.a, J.b, SECRET]) expect(JSON.stringify(centre)).not.toContain(hidden);
    expect(toCit().length).toBeGreaterThanOrEqual(2);
    for (const m of toCit()) expect(m.text || '').not.toContain(SECRET);
    // the referral answers reach the interface as CODES (status, responseCode, nextAction.code): the six-language UI translates them, the server never sends French prose for them
    const a = await mine(J.a);
    expect(a.responseCode).toBe('REDIRECT_SUGGESTED'); expect(a.status).toBe('DECLINED');
    const stages = TRACE.map((t) => t.stage.split(' ')[0]);
    expect(stages).toEqual(['G1a', 'G1b', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10']);
    expect(TRACE.every((t) => t.case === CASE)).toBe(true);
    console.log(`[FA1 GOLDEN TRACE LAB_SYNTHETIC] ${JSON.stringify(TRACE)}`);
  });
});
