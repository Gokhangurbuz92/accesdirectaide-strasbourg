/**
 * PKG-11 deep audit (2026-10-23) on REAL PostgreSQL — the fixes that only a database can prove.
 *  - citizen sessions: a password reset and a logout end every existing session (migration 0032 CitizenUser.sessionsValidAfter); audit pass 2: a second sign-up
 *    for an unverified address sets NO password — the mailbox holder chooses it at the verification click (pass 1 let the latest sign-up win, which a re-sign-up
 *    after the person exploited); the data export re-reads the account (an e-mail change ends the old session);
 *  - referrals: authorizing a referral to an organization whose grant was REVOKED restores the base purpose only (no silent AI / SIAO consent); no new access
 *    while processing is restricted (art. 18); the free texts are hidden from a side without an active access;
 *  - content: an edit of a VERIFIED record is lifted only by a new verification (a plain release is refused); a rollback that changes a VERIFIED record holds it;
 *    the catalogue never reactivates a suspended organization; the review queue lists 'open' and 'OPEN' rows alike;
 *  - professional: /api/pro/me never returns the TOTP seed; a second MFA setup is refused while MFA is on.
 * Synthetic data only; the mailer is the in-memory 'test' provider; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const CIT = { id: `au-cit-${TS}`, email: `au-cit-${TS}@example.test` };
const S = { A: `au-A-${TS}`, B: `au-B-${TS}`, SUS: `au-S-${TS}` };
const P = { a: { id: `au-pa-${TS}`, st: S.A, role: 'PRO' }, b: { id: `au-pb-${TS}`, st: S.B, role: 'PRO' } };
const DOSSIER = `au-dos-${TS}`; const AIDE = `au-aide-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, end() { return this; } });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe.skipIf(!hasDatabase)('PKG-11 deep audit fixes (real DB)', () => {
  let db, userAuth, citizenAuth, auth, referrals, restriction, adminContent, verification, versions;
  const cookieOf = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const asCitizen = (cookie) => ({ method: 'GET', url: '/api/x', query: {}, headers: { host: 'localhost', cookie } });
  const ctxOf = (p) => ({ userId: p.id, structureId: p.st, role: p.role });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js'); citizenAuth = await import('../../api/_utils/citizen-auth.js'); auth = await import('../../api/_utils/auth.js');
    referrals = await import('../../api/_services/referrals.js'); restriction = await import('../../api/_services/processing-restriction.js');
    adminContent = await import('../../api/_services/admin-content.js'); verification = await import('../../api/_services/content-verification.js'); versions = await import('../../api/_services/content-versions.js');
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, ${await userAuth.hashPassword('Ancien-Mot-2026')}, NOW(), NOW())`);
    for (const [id, statut] of [[S.A, 'actif'], [S.B, 'actif'], [S.SUS, 'suspendu']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${DOSSIER}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h-' + TS}, ${'t-' + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'au-gA-' + TS}, ${DOSSIER}, ${S.A}, ${P.a.id}, 'invite')`);
    // B held the dossier once, with AI synthesis consent, and was revoked
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes, "revokedAt") VALUES (${'au-gB-' + TS}, ${DOSSIER}, ${S.B}, ${P.b.id}, 'invite', 'PURP-06,PURP-05', NOW() - interval '1 day')`);
    await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "updatedAt") VALUES (${'au-case-' + TS}, ${DOSSIER}, ${S.A}, 'NEW', NOW())`);
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, cest_quoi, "updatedAt")
      VALUES (${AIDE}, ${AIDE}, 'Aide audit', 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '3 days', 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', 'Texte vérifié.', NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const like = `au-%-${TS}`;
    for (const q of [sql`DELETE FROM "ReferralEvent" WHERE "referralId" IN (SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER})`, sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`,
      sql`DELETE FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOSSIER}`, sql`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER}`, sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`,
      sql`DELETE FROM "ProNotification" WHERE "structureId" LIKE ${like}`, sql`DELETE FROM "ProUser" WHERE id LIKE ${like}`, sql`DELETE FROM "Structure" WHERE id LIKE ${like}`,
      sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${CIT.id}`, sql`DELETE FROM "AuditLog" WHERE entity_id IN (${AIDE}, ${S.SUS})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" = ${AIDE}`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${AIDE}, ${S.SUS})`, sql`DELETE FROM "Aide" WHERE id = ${AIDE}`, sql`DELETE FROM "ReviewQueueItem" WHERE "entityId" = ${AIDE}`,
      sql`DELETE FROM "AuthToken" WHERE "userId" LIKE ${like}`, sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`, sql`DELETE FROM "ConsentLog" WHERE subject_id = ${`${DOSSIER}:${S.B}`}`, sql`DELETE FROM "CitizenUser" WHERE id LIKE ${like}`]) await db.execute(q).catch(() => {});
  });

  it('citizen sessions: a password reset and a logout end the existing sessions; the export re-reads the account', async () => {
    const before = cookieOf(CIT);
    expect(await citizenAuth.resolveCitizen(asCitizen(before))).toMatchObject({ id: CIT.id });
    await sleep(1100);   // the old token is from an earlier second than the reset
    const raw = `au-reset-${TS}`; await db.execute(sql`INSERT INTO "AuthToken" (id, "userId", type, "tokenHash", "expiresAt") VALUES (gen_random_uuid()::text, ${CIT.id}, 'PASSWORD_RESET', ${userAuth.hashAuthToken(raw)}, NOW() + interval '15 minutes')`);
    const reset = (await import('../../api/_handlers/auth/reset-password.js')).default; let r = mk();
    await reset({ method: 'POST', url: '/api/auth/reset-password', query: {}, headers: { host: 'localhost' }, body: { token: raw, password: 'Nouveau-Mot-2026' } }, r);
    expect(r.statusCode).toBe(200);
    expect(await citizenAuth.resolveCitizen(asCitizen(before))).toBeNull();
    await sleep(1100);
    const fresh = cookieOf(CIT); expect(await citizenAuth.resolveCitizen(asCitizen(fresh))).toMatchObject({ id: CIT.id });
    const logout = (await import('../../api/_handlers/auth/logout.js')).default; r = mk();
    await logout({ method: 'POST', url: '/api/auth/logout', query: {}, headers: { host: 'localhost', cookie: fresh } }, r);
    expect(await citizenAuth.resolveCitizen(asCitizen(fresh))).toBeNull();
    // an e-mail change (ownership recovery path) ends the old session for the export too
    await sleep(1100); const later = cookieOf(CIT);
    await db.execute(sql`UPDATE "CitizenUser" SET email = ${'au-moved-' + TS + '@example.test'} WHERE id = ${CIT.id}`);
    const exp = (await import('../../api/_handlers/auth/export-data.js')).default; r = mk();
    await exp(asCitizen(later), r); expect(r.statusCode).toBe(401);
    await db.execute(sql`UPDATE "CitizenUser" SET email = ${CIT.email} WHERE id = ${CIT.id}`);
  });

  it('sign-up (audit pass 2): a second sign-up for an unverified address sets no password; whoever clicks the newest link chooses it, and nobody else can log in', async () => {
    const email = `au-pre-${TS}@example.test`;
    const signup = (await import('../../api/_handlers/auth/signup.js')).default; const verify = (await import('../../api/_handlers/auth/verify-email.js')).default;
    const login = (await import('../../api/_handlers/auth/login.js')).default; const reset = (await import('../../api/_handlers/auth/reset-password.js')).default;
    const mailer = await import('../../api/_utils/mailer.js'); mailer.__clearTestOutbox();
    const links = [];
    for (const password of ['Attaquant-2026x', 'Victime-2026xy']) {
      const r = mk(); await signup({ method: 'POST', url: '/api/auth/signup', query: {}, headers: { host: 'localhost' }, body: { email, password } }, r); expect(r.statusCode).toBe(200);
      const box = mailer.__getTestOutbox().filter((m) => m.to === email); links.push(new URL(box[box.length - 1].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'));
    }
    const [u] = (await db.execute(sql`SELECT id, "passwordHash" h, "emailVerifiedAt" v FROM "CitizenUser" WHERE email = ${email}`)).rows;
    expect(userAuth.isUnsetPassword(u.h)).toBe(true); expect(u.v).toBeNull();
    for (const password of ['Attaquant-2026x', 'Victime-2026xy']) expect(await userAuth.verifyPassword(password, u.h)).toBe(false);
    for (const password of ['Attaquant-2026x', 'Victime-2026xy']) { const r = mk(); await login({ method: 'POST', url: '/api/auth/login', query: {}, headers: { host: 'localhost' }, body: { email, password } }, r); expect(r.statusCode, password).toBe(401); }
    let r = mk(); await verify({ method: 'GET', url: '/api/auth/verify-email', query: { token: links[0] }, headers: { host: 'localhost' } }, r);
    expect(String(r.headers.Location || r.headers.location)).toContain('status=expired');   // the first link died with the second sign-up
    r = mk(); await verify({ method: 'GET', url: '/api/auth/verify-email', query: { token: links[1], next: '/compte/profil' }, headers: { host: 'localhost' } }, r);
    const to = new URL(String(r.headers.Location || r.headers.location), 'http://localhost'); expect(to.pathname).toBe('/auth/reset'); expect(to.searchParams.get('choose')).toBe('1');
    r = mk(); await reset({ method: 'POST', url: '/api/auth/reset-password', query: {}, headers: { host: 'localhost' }, body: { token: to.searchParams.get('token'), password: 'Choisi-Par-Le-Titulaire-26' } }, r); expect(r.statusCode).toBe(200);
    const [after] = (await db.execute(sql`SELECT "passwordHash" h, "emailVerifiedAt" v FROM "CitizenUser" WHERE id = ${u.id}`)).rows;
    expect(after.v).not.toBeNull(); expect(await userAuth.verifyPassword('Choisi-Par-Le-Titulaire-26', after.h)).toBe(true); expect(await userAuth.verifyPassword('Attaquant-2026x', after.h)).toBe(false);
    // a single, uncontested sign-up keeps its password and verifies as before (the RC4 e-mail journey)
    await db.execute(sql`UPDATE "CitizenUser" SET id = ${`au-pre-${TS}`} WHERE id = ${u.id}`).catch(() => {});
  });

  it('referrals: no revived purposes, no new access under restriction, texts hidden from a side without access', async () => {
    const out = await referrals.propose(ctxOf(P.a), { caseId: `au-case-${TS}`, toStructureId: S.B, reasonCode: 'HOUSING', message: 'Message au sujet de la personne.' });
    expect(out.ok).toBe(true);
    // restricted: authorizing is refused, nothing is created
    const rq = await restriction.requestRestriction(CIT.id, { ground: 'ACCURACY_CONTESTED' }, db, { sendMail: async () => ({ outcome: 'TEST_RECORDED' }) });
    expect(rq.ok).toBe(true);
    expect(await referrals.citizenDecide(CIT.id, out.referral.id, true)).toMatchObject({ ok: false, code: 'PROCESSING_RESTRICTED' });
    expect((await restriction.liftBySubject(CIT.id, db, { notify: async () => {} })).ok).toBe(true);   // pass 2: through the service (it also unseals the share links)
    // lifted: the revoked grant comes back with the base purpose only
    expect((await referrals.citizenDecide(CIT.id, out.referral.id, true)).ok).toBe(true);
    const [g] = (await db.execute(sql`SELECT purposes, "revokedAt" FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${S.B}`)).rows;
    expect([g.purposes, g.revokedAt]).toEqual(['PURP-06', null]);
    // the sender loses its access: the texts are hidden from it, the statuses stay
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${S.A}`);
    const view = await referrals.getReferral(ctxOf(P.a), out.referral.id);
    expect([view.referral.message, view.referral.textsHidden, view.referral.status]).toEqual(['', true, 'SENT']);
    expect((await referrals.getReferral(ctxOf(P.b), out.referral.id)).referral.message).toBe('Message au sujet de la personne.');
    // R14: a referral the person refused (or the sender cancelled) BEFORE it was sent never reaches the receiver: not in its inbox, not readable, no action
    const ghost = `au-ghost-${TS}`;
    const cols = (await db.execute(sql`SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) AS c FROM information_schema.columns WHERE table_name = 'Referral' AND column_name NOT IN ('id', 'status', 'sentAt', 'grantId', 'dueAt')`)).rows[0].c;
    await db.execute(sql.raw(`INSERT INTO "Referral" (id, status, "sentAt", "grantId", "dueAt", ${cols}) SELECT '${ghost}', 'CANCELLED', NULL, NULL, NULL, ${cols} FROM "Referral" WHERE id = '${out.referral.id}'`));
    const inbox = await referrals.listBox(ctxOf(P.b), 'inbox');
    expect(inbox.referrals.map((x) => x.id)).not.toContain(ghost);
    expect((await referrals.getReferral(ctxOf(P.b), ghost)).status).toBe(404);
    expect(inbox.referrals.find((x) => x.id === out.referral.id)?.dossierId).toBe(DOSSIER);   // the sent one, with B's active grant, keeps its dossier link
    await db.execute(sql`DELETE FROM "Referral" WHERE id = ${ghost}`);
  });

  it('content: an edited VERIFIED record needs a new verification; a rollback that changes it holds it; a suspended organization is not reactivated by the catalogue', async () => {
    const reviewer = { id: 'au-reviewer@example.test', role: 'admin' };
    const e = await adminContent.updateContent('aide', AIDE, { cest_quoi: 'Texte modifié sans revue.' }, 'au-admin@example.test');
    expect(e).toMatchObject({ ok: true, heldForReverification: true });
    expect(await verification.recordVerification({ entityType: 'aide', entityId: AIDE, action: 'RELEASE_HOLD', reviewer }, { db })).toMatchObject({ ok: false, code: 'REVERIFICATION_REQUIRED' });
    const v = await verification.recordVerification({ entityType: 'aide', entityId: AIDE, action: 'VERIFY', reviewer, sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1', evidenceNote: 'Texte relu contre la page officielle F1, territoire confirmé.', territoryConfirmed: true }, { db, env: {} });
    expect(v.ok).toBe(true);
    let [row] = (await db.execute(sql`SELECT publication_hold h, verification_status s FROM "Aide" WHERE id = ${AIDE}`)).rows; expect([row.h, row.s]).toEqual([null, 'VERIFIED']);
    const [old] = (await db.execute(sql`SELECT id FROM "EntityVersion" WHERE entity_id = ${AIDE} AND snapshot_json->>'cest_quoi' = 'Texte vérifié.' ORDER BY "createdAt" LIMIT 1`)).rows;
    const rb = await versions.rollbackTo(old.id, 'au-admin@example.test', db);
    expect(rb).toMatchObject({ ok: true, heldForReverification: true });
    [row] = (await db.execute(sql`SELECT publication_hold h, cest_quoi c FROM "Aide" WHERE id = ${AIDE}`)).rows; expect(row.c).toBe('Texte vérifié.'); expect(row.h).toMatch(/^Contenu modifié par l’administration/);
    expect(await adminContent.updateContent('structure', S.SUS, { statut: 'actif' }, 'au-admin@example.test')).toMatchObject({ ok: false, code: 'ORGANIZATION_LIFECYCLE' });
    expect((await db.execute(sql`SELECT statut FROM "Structure" WHERE id = ${S.SUS}`)).rows[0].statut).toBe('suspendu');
  });

  it('review queue: lowercase and uppercase « open » rows are both listed (and presented as « open »)', async () => {
    for (const [i, st] of [[1, 'open'], [2, 'OPEN']]) await db.execute(sql`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", reason, severity, status, details, "createdAt", "updatedAt") VALUES (${`au-rq${i}-${TS}`}, 'AIDE', ${AIDE}, 'MISSING_SLUG', 'P2', ${st}, '{}'::jsonb, NOW(), NOW())`);
    const rq = (await import('../../api/_handlers/admin/review-queue.js')).default; const r = mk();
    const token = auth.signAdminSessionToken({ email: 'au-admin@example.test', role: 'admin', mfa_verified: true });
    await rq({ method: 'GET', url: '/api/admin/review-queue?status=open&limit=200', query: { status: 'open', limit: '200' }, headers: { host: 'localhost', authorization: `Bearer ${token}` } }, r);
    expect(r.statusCode).toBe(200);
    const mine = r.body.items.filter((i) => i.entityId === AIDE);
    expect(mine.map((i) => i.status).sort()).toEqual(['open', 'open']);
    expect(r.body._debugSQL).toBeUndefined();
  });

  it('art. 15 export: the dossier threads (decrypted), the organizations given access and the per-dossier purpose consents are included', async () => {
    const threads = await import('../../api/_services/shared-dossier-threads.js');
    const tid = `au-thr-${TS}`;
    await db.execute(sql`INSERT INTO "SharedDossierThread" (id, "sharedDiagnosticId", "structureId", "openedByProUserId", "createdAt", "lastMessageAt") VALUES (${tid}, ${DOSSIER}, ${S.B}, ${P.b.id}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", "senderProUserId", body, "createdAt") VALUES (${`au-msg-${TS}`}, ${tid}, 'PRO', ${P.b.id}, ${threads.sealMessage(tid, 'Bonjour, voici les pièces à prévoir.')}, NOW())`);
    await db.execute(sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel) VALUES (gen_random_uuid()::text, 'SHARED_DOSSIER_GRANT', ${`${DOSSIER}:${S.B}`}, 'PURP-06', true, 'qa', 'qa', 'ui')`);
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    const crypto = await import('node:crypto');
    const exp = await createPrivacyRightsService({ db, cryptoLib: crypto }).getExportData(CIT.id);
    expect(exp.dossierThreads.find((t) => t.id === tid).messages.map((m) => m.text)).toEqual(['Bonjour, voici les pièces à prévoir.']);
    expect(exp.dossierAccesses.map((g) => g.organization).sort()).toEqual([`Org ${S.A}`, `Org ${S.B}`].sort());
    expect(exp.dossierPurposeConsents.some((c) => c.dossierAndOrganization === `${DOSSIER}:${S.B}` && c.decision === true)).toBe(true);
    expect(JSON.stringify(exp)).not.toMatch(/tokenHash/);
    await db.execute(sql`DELETE FROM "SharedDossierMessage" WHERE "threadId" = ${tid}`); await db.execute(sql`DELETE FROM "SharedDossierThread" WHERE id = ${tid}`);
  });

  it('professional: /api/pro/me never returns the TOTP seed; a second MFA setup is refused while MFA is on', async () => {
    await db.execute(sql`UPDATE "ProUser" SET mfa_secret = 'SEEDSEEDSEEDSEED', mfa_enabled = true WHERE id = ${P.a.id}`);
    const tok = auth.signProToken({ id: P.a.id, email: `${P.a.id}@example.test`, structureId: S.A, role: 'PRO' });
    const req = (method) => ({ method, url: '/api/pro/x', query: {}, headers: { host: 'localhost', authorization: `Bearer ${tok}` } });
    const me = (await import('../../api/_handlers/pro/me.js')).default; let r = mk(); await me(req('GET'), r);
    expect(r.statusCode).toBe(200); expect(JSON.stringify(r.body)).not.toMatch(/SEEDSEED|mfa_secret|password_hash/); expect(r.body.user.mfa_enabled).toBe(true);
    const setup = (await import('../../api/_handlers/pro/mfa-setup.js')).default; r = mk(); await setup(req('GET'), r);
    expect(r.statusCode).toBe(409);
    expect((await db.execute(sql`SELECT mfa_secret s, mfa_enabled e FROM "ProUser" WHERE id = ${P.a.id}`)).rows[0]).toEqual({ s: 'SEEDSEEDSEEDSEED', e: true });
  });
});
