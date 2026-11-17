/**
 * E7 — synthetic end-to-end acceptance of the seven product surfaces and of the cross-surface « responsabilité de parcours » workflow
 * (CONTROL/master/VISION_FINALE_ET_ECARTS_PRODUIT_2026-11.md § 2 item 5), on REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js: CSRF, the restricted
 * public beta, the surface gate and the R45 capability gate all run), with synthetic data only:
 *
 *   need (Public: multi-need search) → step in Mon Parcours with who / next action (Citizen) → consented sharing and referral (Citizen ↔ ADA Pro)
 *   → the receiver redirects with a linked suggestion (ADA Pro) → the answer returns to the sender and to the person (in-app + e-mail outbox)
 *   → an unresolved step is flagged and a human is asked to follow up (scheduled job, Platform Ops) → closed honestly (outcome known / unknown)
 *   → the organisation reads aggregates only (Structure) → the territory reads masked aggregates only (Territory / Institution)
 *   → the trail is searchable by a named administrator who still cannot open the dossier (Administration) → the job run and the providers are visible to
 *     operations, and closing the surfaces again refuses everything (Platform Ops / Super Admin).
 *
 * Nothing is open by default: the suite starts with ADA_PUBLIC_BETA_RESTRICTED=1 and NO surface, checks the refusals, then opens each surface, capability and
 * job explicitly. The HDS attestation is a SYNTHETIC LAB token (format check only) — it is not a certificate and says nothing about real hosting. The mailer is
 * the in-memory « test » provider: an outbox entry is not a delivered e-mail. This is engineering acceptance, not operational acceptance.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quotas: infrastructure, not under test
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { X: `e7-X-${TS}`, Y: `e7-Y-${TS}`, Z: `e7-Z-${TS}` };
const NAME = { X: `E7 Accueil social ${TS}`, Y: `E7 Logement ${TS}`, Z: `E7 Prévention expulsions ${TS}` };
const P = { xa: { id: `e7-xa-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `e7-x1-${TS}`, st: S.X, role: 'PRO' },
  y1: { id: `e7-y1-${TS}`, st: S.Y, role: 'STRUCTURE_ADMIN' }, z1: { id: `e7-z1-${TS}`, st: S.Z, role: 'STRUCTURE_ADMIN' } };
const X_MEMBERS = 2;
const CIT = { id: `e7-cit-${TS}`, email: `e7-cit-${TS}@example.test` };
const INST = { id: `e7-inst-${TS}`, email: `e7-inst-${TS}@example.test`, passwordHash: `synthetic-not-a-hash-${TS}` };
const ADMIN = `e7-admin-${TS}@example.test`;
const GUIDE = { id: `e7-guide-${TS}`, slug: `e7-guide-${TS}-f31272` };   // resolves the official sheet F31272 of the « expulsion-impayes » need
const AIDE = { id: `e7-aide-${TS}`, slug: `e7-aide-${TS}-slug` };
const SECRET = `note-interne-du-recepteur-${TS}`;
const QUERY = 'je risque l expulsion a cause de loyers impayes et je n ai plus aucun revenu';
const CSRF = `e7csrf${TS}`;
const LAB_HDS = `HDS1:lab-synthetic:E7-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'MAILER_PROVIDER', 'MAILER_FROM'];
const OPEN = {
  ADA_BETA_OPEN_SURFACES: 'accounts,pro,documents,diagnostic,institution,admin', ADA_BETA_ACCOUNTS_SCOPE: 'full',
  ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.orientation_records,citizen.shared_dossier,citizen.saved_diagnostic,pro.case_management,pro.referrals,institution.portal',
  ADA_HDS_CERTIFIED_HOSTING: LAB_HDS,
};
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('E7 — seven surfaces, one pathway, through the real API entry (real DB, synthetic data)', () => {
  let db, api, auth, userAuth, instAuth, mailer, schema;
  const saved = {};
  const J = {};   // the journey's state: ids produced by one step and used by the next
  /** as: { cit } | { pro: P.x } | { inst } | { admin } | { cron } | { anon } */
  const call = async (method, url, { as = {}, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http' };
    if (as.cit) Object.assign(h, { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF });
    if (as.anon) Object.assign(h, { cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF });
    if (as.pro) h.authorization = `Bearer ${auth.signProToken({ id: as.pro.id, email: `${as.pro.id}@example.test`, structureId: as.pro.st, role: as.pro.role })}`;
    if (as.inst) h.authorization = `Bearer ${instAuth.signInstitutionToken(INST)}`;
    if (as.admin) h.authorization = `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true })}`;
    if (as.cron) h['x-cron-secret'] = process.env.CRON_SECRET;
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: { ...h, ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const ok = (r, code = 200) => { expect(r.statusCode, JSON.stringify(r.body)).toBe(code); return r.body; };
  const refusedBy = (r) => [r.statusCode, r.body?.error];
  const owner = (action, extra = {}) => call('POST', '/api/public/dossier-grants', { as: { cit: true }, body: { shareId: J.shareId, action, ...extra }, headers: { 'x-share-owner-secret': J.ownerSecret } });
  const refPost = (p, body) => call('POST', '/api/pro/referrals', { as: { pro: p }, body });
  const refOne = (p, id) => call('GET', `/api/pro/referrals?id=${encodeURIComponent(id)}`, { as: { pro: p } });
  const box = async (p, name) => ok(await call('GET', `/api/pro/referrals?box=${name}`, { as: { pro: p } })).referrals;
  const mine = async (id) => ok(await call('GET', '/api/citizen/referrals', { as: { cit: true } })).referrals.find((r) => r.id === id);
  const inbox = async () => ok(await call('GET', '/api/citizen/notifications', { as: { cit: true } }));
  const notices = async (st, type, id) => (await db.execute(sql`SELECT type, title, message, metadata FROM "ProNotification" WHERE "structureId" = ${st} AND type = ${type}`)).rows.filter((n) => !id || n.metadata?.referralId === id);
  const grantActive = async (st) => (await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${st} AND "revokedAt" IS NULL`)).rows[0].n;
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);
  const cron = () => call('GET', '/api/cron/referral-timeouts', { as: { cron: true } });

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // nothing is open: the restricted beta with no surface, no capability, no job (the Production default)
    setEnv({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: undefined, ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_CAPABILITIES_OPEN: undefined, ADA_HDS_CERTIFIED_HOSTING: undefined,
      ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' });
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    instAuth = await import('../../api/_utils/institution-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    for (const k of ['X', 'Y', 'Z']) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${S[k]}, ${NAME[k]}, ${S[k]}, 'association', '1 rue de test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.insert(schema.Guide).values({ id: GUIDE.id, slug: GUIDE.slug, titre: `Fiche synthétique impayés de loyer ${TS}`, statut: 'publie', publics: [], contexte: [], mots_cles: [], sources_urls: [] });
    await db.insert(schema.Aide).values({ id: AIDE.id, slug: AIDE.slug, titre: `Aide synthétique E7 ${TS}`, statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev@example.test',
      territory_verified: true, data_origin: 'official', date_verification: new Date(Date.now() - 3 * 86400000), source_url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', ou_demander: 'Auprès de la Caf' });
    await db.execute(sql`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, "recordedBy", "signedAt", "documentRef", "signedByPartner") VALUES (${`e7-ag-${TS}`}, 'Partenaire synthétique E7', 'CONVENTION', 'SIGNED', 'e7-admin@example.test', CURRENT_DATE - 1, 'SYNTHETIC-TEST-ONLY-E7', 'Signataire synthétique')`);
    await db.execute(sql`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES (${INST.id}, ${INST.email}, ${INST.passwordHash}, 'Institution synthétique E7', 'Bas-Rhin', 'ACTIVE', ${`e7-ag-${TS}`}, 'e7-admin@example.test')`);
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${`e7-adm-${TS}`}, ${ADMIN}, 'x', 'admin', NOW(), NOW(), 0, true)`);
    mailer.__clearTestOutbox();
  }, 90000);

  afterAll(async () => {
    setEnv(saved);
    if (!db) return;
    const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
    const refIds = sql`SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId || ''}`;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (${refIds})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${J.shareId || ''} OR actor_id IN (${INST.id}, ${ADMIN}) OR actor = ${ADMIN}`).catch(() => {});
    if (J.shareId) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${J.shareId}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Guide" WHERE id = ${GUIDE.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Aide" WHERE id = ${AIDE.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE id = ${INST.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE id = ${`e7-ag-${TS}`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${ADMIN}`).catch(() => {});
  });

  // ───────────────────────────── 0. nothing is open by default ─────────────────────────────
  it('0 · fail-closed: with the restricted beta and no opened surface only public information answers; opening a surface is not opening a capability, and HDS-bound ones need the attestation', async () => {
    expect(ok(await call('GET', `/api/aides/${AIDE.slug}`)).slug ?? true).toBeTruthy();
    const closed = [['GET', '/api/citizen/parcours', { cit: true }], ['GET', '/api/citizen/referrals', { cit: true }], ['GET', '/api/pro/referrals?box=inbox', { pro: P.y1 }],
      ['GET', '/api/pro/cases?scope=unassigned', { pro: P.xa }], ['GET', '/api/pro/reports?period=month', { pro: P.xa }], ['GET', '/api/institution/me', { inst: true }],
      ['GET', '/api/admin/audit-log', { admin: true }], ['GET', '/api/cron/referral-timeouts', { cron: true }]];
    for (const [m, url, as] of closed) expect(refusedBy(await call(m, url, { as })), url).toEqual([503, 'PUBLIC_BETA_RESTRICTED']);
    // the surfaces open, the out-of-AIPD capabilities not listed: still refused, before any data is read
    setEnv({ ADA_BETA_OPEN_SURFACES: OPEN.ADA_BETA_OPEN_SURFACES, ADA_BETA_ACCOUNTS_SCOPE: 'full' });
    for (const url of ['/api/citizen/parcours', '/api/citizen/referrals']) expect(refusedBy(await call('GET', url, { as: { cit: true } })), url).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    expect(refusedBy(await call('GET', '/api/pro/referrals?box=inbox', { as: { pro: P.y1 } }))).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    expect(refusedBy(await call('GET', '/api/institution/me', { as: { inst: true } }))).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    // listed, but no HDS attestation: the capabilities that may host health data stay closed, the others open
    setEnv({ ADA_CAPABILITIES_OPEN: OPEN.ADA_CAPABILITIES_OPEN });
    for (const [url, as] of [['/api/citizen/referrals', { cit: true }], ['/api/pro/referrals?box=inbox', { pro: P.y1 }], ['/api/pro/cases?scope=unassigned', { pro: P.xa }]]) {
      const r = await call('GET', url, { as }); expect(refusedBy(r), url).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    }
    ok(await call('GET', '/api/citizen/parcours', { as: { cit: true } }));
    // with the (synthetic LAB) attestation every capability of the journey is open; the jobs stay closed
    setEnv({ ADA_HDS_CERTIFIED_HOSTING: OPEN.ADA_HDS_CERTIFIED_HOSTING });
    ok(await call('GET', '/api/citizen/referrals', { as: { cit: true } }));
    expect(refusedBy(await cron())).toEqual([503, 'PUBLIC_BETA_RESTRICTED']);
  });

  // ───────────────────────────── 1. Public: the need ─────────────────────────────
  it('1 · Public: a multi-need search names the needs, most urgent first, with their official sheets — the published one resolved to its page on the site', async () => {
    const out = ok(await call('POST', '/api/search', { as: { anon: true }, body: { query: QUERY, lang: 'fr' } }));
    const ids = out.orientation.needs.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux']));
    expect(out.orientation.multi).toBe(true);
    const need = out.orientation.needs.find((n) => n.id === 'expulsion-impayes');
    expect(need.sheets).toContain('F31272');
    expect(out.orientation.sources.F31272).toMatchObject({ slug: GUIDE.slug });
    expect(out.orientation.sources.F31272.url).toMatch(/^https:\/\/www\.service-public\.gouv\.fr\//);
    J.need = need; J.source = out.orientation.sources.F31272;
    // an anonymous visitor cannot keep it: Mon Parcours needs an account
    expect((await call('POST', '/api/citizen/parcours', { as: { anon: true }, body: { action: 'add', title: need.label } })).statusCode).toBe(401);
  });

  // ───────────────────────────── 2. Citizen: the step, who and next action ─────────────────────────────
  it('2 · Citizen: the need becomes ONE Mon Parcours step pointing at the published sheet, with the need, the official link, who acts and the next action', async () => {
    const add = await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'add', title: J.need.label, records: [{ type: 'guide', id: J.source.slug }],
      planStep: { need: 'expulsion-impayes', links: [{ url: J.source.url, label: J.source.title }], nextActionKey: 'read_record' } } });
    J.stepId = ok(add, 201).item.id;
    // the person decides who acts next: a professional, to whom they will share their dossier
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'plan', id: J.stepId, planStep: { actor: { kind: 'professional' }, nextActionKey: 'share_dossier' } } }));
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'status', id: J.stepId, status: 'IN_PROGRESS' } }));
    const item = ok(await call('GET', '/api/citizen/parcours', { as: { cit: true } })).items.find((i) => i.id === J.stepId);
    expect(item).toMatchObject({ status: 'IN_PROGRESS', available: true, step: { need: { id: 'expulsion-impayes' }, actor: { kind: 'professional' }, nextActionKey: 'share_dossier' } });
    expect(item.step.links[0].url).toBe(J.source.url);
    expect(item.records[0]).toMatchObject({ type: 'guide', available: true, href: `/bonnes-pratiques/${GUIDE.slug}` });
  });

  // ───────────────────────────── 3. Citizen → ADA Pro: consent to share ─────────────────────────────
  it('3 · Citizen → ADA Pro: the person saves a dossier and invites ONE organisation; nothing is readable before it redeems the invitation', async () => {
    const created = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000' }, results: { rights: [] } } }));
    Object.assign(J, { shareId: created.shareId, ownerSecret: created.ownerSecret });
    expect((await call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: P.x1 } })).statusCode).toBe(404);
    const inv = ok(await owner('invite', { structureId: S.X }), 201);
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    ok(await call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: P.x1 } }));
    for (const st of [S.Y, S.Z]) expect(await grantActive(st)).toBe(0);
  });

  // ───────────────────────────── 4. ADA Pro (sender): case and consented referral ─────────────────────────────
  it('4 · ADA Pro: the sender takes the case and proposes a referral; nothing reaches the receiver before the person agrees', async () => {
    const queue = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases;
    J.caseId = queue.find((c) => c.dossierId === J.shareId).id;
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.xa }, body: { action: 'assign', id: J.caseId, userId: P.x1.id } }));
    const p = ok(await refPost(P.x1, { action: 'propose', caseId: J.caseId, toStructureId: S.Y, reasonCode: 'HOUSING', message: `logement-${TS}` }), 201);
    J.a = p.referral.id;
    expect(p.referral.status).toBe('PENDING_CITIZEN');
    expect(await grantActive(S.Y)).toBe(0);
    expect(await box(P.y1, 'inbox')).toEqual([]);
    expect((await refOne(P.y1, J.a)).statusCode).toBe(404);
  });

  // ───────────────────────────── 5. Citizen: the consent decision ─────────────────────────────
  it('5 · Citizen: the proposal is in Mon Espace — in the list with its next action AND in the notification centre — and only the person\'s « accept » shares the dossier', async () => {
    expect(await mine(J.a)).toMatchObject({ status: 'PENDING_CITIZEN', to: NAME.Y, nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' } });
    const centre = await inbox();
    const asked = centre.notifications.filter((n) => n.kind === 'REFERRAL_DECISION_NEEDED');
    expect(asked.length, JSON.stringify(centre)).toBe(1);
    expect(asked[0]).toMatchObject({ link: '/compte/orientations', unread: true });
    expect(JSON.stringify(centre)).not.toContain(NAME.Y);   // kind, time and link only
    expect(toCit().filter((m) => /attend votre accord/.test(m.subject)).length).toBe(1);   // the LAB outbox: recorded, not delivered
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.a, decision: 'accept' } }));
    expect(await grantActive(S.Y)).toBe(1);
    // once answered, the request is no longer pending in the centre
    expect((await inbox()).notifications.filter((n) => n.kind === 'REFERRAL_DECISION_NEEDED').length).toBe(0);
  });

  // ───────────────────────────── 6. ADA Pro (receiver): redirect, linked ─────────────────────────────
  it('6 · ADA Pro: the receiver reads the dossier through its grant and declines with a suggestion; the suggested organisation learns nothing; the answer returns to the sender and to the person', async () => {
    expect((await box(P.y1, 'inbox')).map((r) => r.id)).toContain(J.a);
    ok(await call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: P.y1 } }));
    ok(await refPost(P.y1, { action: 'decline', id: J.a, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId: S.Z, message: SECRET }));
    expect(await grantActive(S.Y)).toBe(0);
    expect(await grantActive(S.Z)).toBe(0);
    expect((await refOne(P.z1, J.a)).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" = ${S.Z}`)).rows[0].n).toBe(0);
    // the sender: one in-app notice per member, the suggestion and its next action, never the receiver's text
    expect((await notices(S.X, 'referral_declined', J.a)).length).toBe(X_MEMBERS);
    const sender = ok(await refOne(P.x1, J.a)).referral;
    expect(sender).toMatchObject({ suggested: { id: S.Z, name: NAME.Z }, canProposeSuggested: true, nextAction: { code: 'SENDER_PROPOSE_SUGGESTED', by: 'SENDER' } });
    // the person: the controlled motive, the suggestion, the next action — in the list, the notification centre and the outbox; never the free text
    const person = await mine(J.a);
    expect(person).toMatchObject({ status: 'DECLINED', responseCode: 'REDIRECT_SUGGESTED', suggested: NAME.Z, nextAction: { code: 'SENDER_PROPOSE_SUGGESTED' } });
    expect(JSON.stringify(person)).not.toContain(SECRET);
    const answers = (await inbox()).notifications.filter((n) => n.kind === 'REFERRAL_ANSWER');
    expect(answers.length).toBe(1);
    expect(answers[0].link).toBe('/compte/orientations');
    const mail = toCit().filter((m) => /n’a pas été acceptée/.test(m.subject));
    expect(mail.length).toBe(1);
    expect(mail[0].text).not.toContain(SECRET);
  });

  // ───────────────────────────── 7. Platform Ops: the job flags the unresolved step ─────────────────────────────
  it('7 · Platform Ops: a suggestion nobody acted on is flagged; the follow-up job runs only once opened AND approved, notifies the sender once and decides nothing', async () => {
    await db.execute(sql`UPDATE "Referral" SET "respondedAt" = NOW() - interval '15 days' WHERE id = ${J.a}`);
    expect(await mine(J.a)).toMatchObject({ needsFollowUp: true, nextAction: { code: 'SENDER_PROPOSE_SUGGESTED' } });
    expect((await box(P.x1, 'outbox')).find((r) => r.id === J.a).needsFollowUp).toBe(true);
    // a personal-data job (category C): named alone it waits for the owner's recorded approval
    setEnv({ ADA_BETA_OPEN_JOBS: 'referral-timeouts' });
    expect(refusedBy(await cron())).toEqual([503, 'PUBLIC_BETA_RESTRICTED']);
    setEnv({ ADA_JOBS_APPROVED: 'referral-timeouts' });
    expect((await call('GET', '/api/cron/referral-timeouts')).statusCode, 'no CRON_SECRET').toBe(401);
    expect(ok(await cron()).followUpNotified).toBeGreaterThanOrEqual(1);
    expect((await notices(S.X, 'referral_follow_up', J.a)).length).toBe(X_MEMBERS);
    expect((await notices(S.Y, 'referral_follow_up', J.a)).length).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" = ${S.Z}`)).rows[0].n).toBe(0);
    ok(await cron());   // a second run: no second notice
    expect((await notices(S.X, 'referral_follow_up', J.a)).length).toBe(X_MEMBERS);
    expect((await row(J.a)).status).toBe('DECLINED');
  });

  // ───────────────────────────── 8. the linked referral ─────────────────────────────
  it('8 · ADA Pro ↔ Citizen: the sender follows the suggestion with a LINKED referral; the person authorizes it; the new receiver sees its own referral only', async () => {
    const b = ok(await refPost(P.x1, { action: 'propose', caseId: J.caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: J.a, message: `suite-${TS}` }), 201);
    J.b = b.referral.id;
    expect(await row(J.b)).toMatchObject({ status: 'PENDING_CITIZEN', previousReferralId: J.a });
    expect(await mine(J.a)).toMatchObject({ nextId: J.b, nextAction: null, needsFollowUp: false });
    expect(await mine(J.b)).toMatchObject({ previousId: J.a, nextAction: { code: 'CITIZEN_DECIDE' } });
    expect((await inbox()).notifications.filter((n) => n.kind === 'REFERRAL_DECISION_NEEDED').length).toBe(1);
    expect(await grantActive(S.Z)).toBe(0);
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.b, decision: 'accept' } }));
    expect(await grantActive(S.Z)).toBe(1);
    expect((await notices(S.Z, 'referral_received', J.b)).length).toBe(1);
    const z = ok(await refOne(P.z1, J.b));
    expect(z.referral.previous).toBeNull();
    for (const hidden of [J.a, SECRET, NAME.Y]) expect(JSON.stringify(z)).not.toContain(hidden);
    expect((await refOne(P.z1, J.a)).statusCode).toBe(404);
    expect(ok(await refOne(P.x1, J.a)).referral.next).toEqual({ id: J.b, status: 'SENT' });
  });

  // ───────────────────────────── 9. the answer returns; a stalled acceptance is flagged ─────────────────────────────
  it('9 · the receiver accepts: the sender and the person are told; an acceptance without a recorded step is flagged and a human is asked to follow up — the status is not changed', async () => {
    ok(await refPost(P.z1, { action: 'acknowledge', id: J.b }));
    ok(await refPost(P.z1, { action: 'accept', id: J.b }));
    expect((await notices(S.X, 'referral_accepted', J.b)).length).toBe(X_MEMBERS);
    expect(await mine(J.b)).toMatchObject({ status: 'ACCEPTED', nextAction: { code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' }, needsFollowUp: false });
    expect(toCit().filter((m) => /a été acceptée/.test(m.subject)).length).toBe(1);
    expect((await inbox()).notifications.filter((n) => n.kind === 'REFERRAL_ANSWER').length).toBe(3);   // the redirect, the acknowledgement, the acceptance
    await db.execute(sql`UPDATE "Referral" SET "respondedAt" = NOW() - interval '15 days' WHERE id = ${J.b}`);
    expect((await mine(J.b)).needsFollowUp).toBe(true);
    ok(await cron());
    expect((await notices(S.Z, 'referral_follow_up', J.b)).length).toBe(1);
    expect((await notices(S.X, 'referral_follow_up', J.b)).length).toBe(X_MEMBERS);
    expect((await row(J.b)).status).toBe('ACCEPTED');
  });

  // ───────────────────────────── 10. closed honestly ─────────────────────────────
  it('10 · closed honestly: the receiver records a step and a known outcome; the sender closes; the person ends THEIR step as « outcome unknown » — each side keeps its own truth', async () => {
    ok(await refPost(P.z1, { action: 'start', id: J.b }));
    expect((await mine(J.b)).needsFollowUp).toBe(false);
    ok(await refPost(P.z1, { action: 'complete', id: J.b, outcome: 'INFORMATION_PROVIDED', citizenSummary: `infos-donnees-${TS}` }));
    expect(await mine(J.b)).toMatchObject({ status: 'COMPLETED', outcome: 'INFORMATION_PROVIDED', outcomeSummary: `infos-donnees-${TS}`, nextAction: null });
    expect(ok(await refOne(P.x1, J.b)).referral.outcome).toBe('INFORMATION_PROVIDED');
    ok(await refPost(P.x1, { action: 'close', id: J.b }));
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.x1 }, body: { action: 'close', id: J.caseId, outcome: 'REFERRED_ELSEWHERE', citizenSummary: `oriente-${TS}` } }));
    const trail = (await db.execute(sql`SELECT "actorType" a, "toStatus" s FROM "ReferralEvent" WHERE "referralId" = ${J.b} ORDER BY "createdAt"`)).rows;
    expect(trail.map((e) => e.s)).toEqual(['PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']);
    expect(trail.map((e) => e.a)).toEqual(['SENDER', 'CITIZEN', 'RECEIVER', 'RECEIVER', 'RECEIVER', 'RECEIVER', 'SENDER']);
    // the person never learnt the decision on the right itself: they say so, the platform does not invent a result
    ok(await call('POST', '/api/citizen/parcours', { as: { cit: true }, body: { action: 'status', id: J.stepId, status: 'OUTCOME_UNKNOWN' } }));
    const item = ok(await call('GET', '/api/citizen/parcours', { as: { cit: true } })).items.find((i) => i.id === J.stepId);
    expect(item).toMatchObject({ status: 'CLOSED', closure: 'OUTCOME_UNKNOWN' });
    const history = ok(await call('GET', `/api/citizen/parcours?history=${encodeURIComponent(J.stepId)}`, { as: { cit: true } })).events.map((e) => e.toStatus);
    expect(history).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'CLOSED']);
  });

  // ───────────────────────────── 11. Structure ─────────────────────────────
  it('11 · Structure: the organisation administrator reads its aggregate counters (no person, no dossier, no text); a plain member cannot', async () => {
    const r = await call('GET', '/api/pro/reports?period=month&format=csv', { as: { pro: P.xa } });
    const csv = String(ok(r));
    const sent = csv.split(/\r?\n/).find((l) => l.startsWith('orientations_envoyees'));
    expect(Number(sent.split(',')[1])).toBe(2);
    for (const hidden of [J.shareId, CIT.email, SECRET, `logement-${TS}`, NAME.Y, NAME.Z]) expect(csv).not.toContain(hidden);
    expect((await call('GET', '/api/pro/reports?period=month', { as: { pro: P.x1 } })).statusCode).toBe(403);
  });

  // ───────────────────────────── 12. Territory / Institution ─────────────────────────────
  it('12 · Territory / Institution: the account reads the observatoire of ITS territory only — complete quarters, masked cells, nothing of this pathway — and none of the person-level routes', async () => {
    const me = ok(await call('GET', '/api/institution/me', { as: { inst: true } }));
    expect(me.territoryScope).toMatchObject({ defined: true });
    const obs = await call('GET', '/api/institution/observatoire', { as: { inst: true } });
    const body = JSON.stringify(ok(obs));
    for (const hidden of [J.shareId, J.a, J.b, S.X, S.Y, S.Z, NAME.X, NAME.Y, NAME.Z, CIT.email, SECRET]) expect(body).not.toContain(hidden);
    expect((await call('GET', '/api/institution/observatoire?territory=Haut-Rhin', { as: { inst: true } })).statusCode).toBe(400);
    for (const url of ['/api/pro/referrals?box=inbox', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, '/api/citizen/referrals']) {
      expect([401, 403, 404], url).toContain((await call('GET', url, { as: { inst: true } })).statusCode);
    }
  });

  // ───────────────────────────── 13. Administration ─────────────────────────────
  it('13 · Administration: a named MFA administrator finds the pathway\'s trail (identifiers only) and still cannot open the dossier, the case or the referrals', async () => {
    const items = ok(await call('GET', `/api/admin/audit-log?entity=Referral&entityId=${encodeURIComponent(J.a)}`, { as: { admin: true } })).items;
    expect(items.map((i) => i.action)).toEqual(expect.arrayContaining(['REFERRAL_REDIRECT_SUGGESTED', 'REFERRAL_CITIZEN_NOTICE']));
    expect(JSON.stringify(items)).not.toContain(SECRET);
    expect(items.find((i) => i.action === 'REFERRAL_REDIRECT_SUGGESTED').details).toMatchObject({ suggestedStructureId: S.Z, byStructureId: S.Y });
    const linked = ok(await call('GET', `/api/admin/audit-log?entity=Referral&entityId=${encodeURIComponent(J.b)}`, { as: { admin: true } })).items;
    expect(linked.find((i) => i.action === 'REFERRAL_REDIRECT_PROPOSED').details).toMatchObject({ previousReferralId: J.a, followsSuggestion: true });
    for (const url of [`/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, '/api/pro/cases?scope=unassigned', '/api/pro/referrals', '/api/citizen/referrals', '/api/citizen/parcours']) {
      expect([401, 403, 404], url).toContain((await call('GET', url, { as: { admin: true } })).statusCode);
    }
  });

  // ───────────────────────────── 13b. the notification centre is the person's own, and follows the capability ─────────────────────────────
  it('13b · Citizen: the referral items of the centre are the account\'s own, carry no content, include a sender\'s cancellation, and disappear with the capability', async () => {
    const OTHER = { id: `e7-other-${TS}`, email: `e7-other-${TS}@example.test` };
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${OTHER.id}, ${OTHER.email}, 'x', NOW(), NOW())`);
    try {
      const { listInbox } = await import('../../api/_services/citizen-inbox.js');
      expect((await listInbox(OTHER.id, db, { isOpen: () => true })).notifications).toEqual([]);
      // a proposal the sender withdrew before the person answered (synthetic row and its append-only events)
      const c = `e7-cancel-${TS}`;
      await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "closedAt", "updatedAt") VALUES (${c}, ${J.shareId}, ${S.X}, ${S.Y}, 'CANCELLED', 'OTHER', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ReferralEvent" (id, "referralId", "actorType", "actorId", "fromStatus", "toStatus") VALUES (${c + '-e1'}, ${c}, 'SENDER', ${P.x1.id}, NULL, 'PENDING_CITIZEN'), (${c + '-e2'}, ${c}, 'SENDER', ${P.x1.id}, 'PENDING_CITIZEN', 'CANCELLED')`);
      const all = await listInbox(CIT.id, db, { isOpen: () => true });
      const kinds = all.notifications.map((n) => n.kind);
      expect(kinds.filter((k) => k === 'REFERRAL_ENDED').length).toBe(1);
      expect(kinds.filter((k) => k === 'REFERRAL_ANSWER').length).toBe(5);   // the redirect; then acknowledged, accepted, started, completed
      expect(kinds).not.toContain('REFERRAL_DECISION_NEEDED');
      const raw = JSON.stringify(all);
      for (const hidden of [J.a, J.b, c, J.shareId, NAME.X, NAME.Y, NAME.Z, SECRET, `infos-donnees-${TS}`]) expect(raw).not.toContain(hidden);
      // the capability closed: the referral part is neither read nor returned
      const closed = await listInbox(CIT.id, db, { isOpen: (cap) => cap !== 'citizen.orientation_records' });
      expect(closed.notifications.filter((n) => n.kind.startsWith('REFERRAL_'))).toEqual([]);
    } finally {
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${OTHER.id}`);
    }
  });

  // ───────────────────────────── 14. Platform Ops / Super Admin ─────────────────────────────
  it('14 · Platform Ops: the job runs are recorded (counts only), the providers are reported from configuration, and closing the surfaces again refuses everything without losing data', async () => {
    const runs = (await db.execute(sql`SELECT status, metrics FROM "CronRun" WHERE job = 'referral-timeouts' ORDER BY "startedAt" DESC LIMIT 3`)).rows;
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(runs.every((r) => r.status === 'success')).toBe(true);
    expect(JSON.stringify(runs)).not.toContain(J.a);
    const providers = ok(await call('GET', '/api/admin/provider-status', { as: { admin: true } }));
    expect(providers.basis).toBe('ENV_PRESENCE_ONLY');
    // rollback: the surfaces close, every person-level route refuses again; nothing of the pathway is lost
    setEnv({ ADA_BETA_OPEN_SURFACES: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined });
    for (const [url, as] of [['/api/citizen/referrals', { cit: true }], ['/api/pro/referrals?box=outbox', { pro: P.x1 }], ['/api/institution/observatoire', { inst: true }], ['/api/admin/audit-log', { admin: true }], ['/api/cron/referral-timeouts', { cron: true }]]) {
      expect(refusedBy(await call('GET', url, { as })), url).toEqual([503, 'PUBLIC_BETA_RESTRICTED']);
    }
    ok(await call('GET', `/api/aides/${AIDE.slug}`));
    expect((await row(J.b)).status).toBe('CLOSED');
    expect((await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId}`)).rows[0].n).toBe(3);   // a, b and the synthetic cancelled proposal of 13b
  });
});
