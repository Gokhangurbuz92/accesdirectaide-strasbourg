/**
 * G14 (owner decision 23/11/2026: ADA Pro opens without a pilot structure) — a structure signs up on its own; the owner, sole platform administrator,
 * verifies it on an official source and only then lets it in. REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js: CSRF, validation registry), the
 * in-memory « test » mailer (nothing leaves the machine), synthetic identities only. Skipped without DATABASE_URL.
 *   1. the sign-up request: terms in force accepted and recorded (document@version, channel « register »), SIRET stored on the Structure, the
 *      administrator pending (no session, sign-in refused), « demande reçue » e-mail; the same answer for an address already used;
 *   2. a SIRET already held by a Structure: no second Structure — the pending administrator is attached to the existing record;
 *   3. an unverified structure: the MFA enrolment invitation is refused (pending account and active member alike); the SUPERADMIN's own structure is unchanged;
 *   4. the administration lists the requests (filter « pro_pending », SIRET, count);
 *   5. « Vérifier et activer » (MFA, note, official source, territory, version read): all or nothing; then VERIFIED + actif, the account active, the MFA
 *      invitation e-mailed and redeemable (sender: the administrator, admin realm), the journal rows; the invitation stops when that administrator is disabled;
 *   6. « Refuser »: the pending account disabled, the refusal journalised, nothing deleted.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
vi.mock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: vi.fn().mockResolvedValue({ bumped: false }) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
/** a Luhn-valid SIRET unique to this run (13 random digits + key) */
function siretFor(seed) {
  const base = String(BigInt('0x' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 15)) % 10n ** 13n).padStart(13, '1').replace(/^356/, '357');
  for (let k = 0; k < 10; k += 1) {
    const d = base + k; let sum = 0;
    for (let i = 0; i < 14; i += 1) { let n = Number(d[13 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
    if (sum % 10 === 0) return d;
  }
  throw new Error('no key');
}
const SIRET = siretFor(`g14p-a-${TS}`), SIRET_KNOWN = siretFor(`g14p-k-${TS}`);
const NAME = `Association G14 inscription ${TS}`;
const KNOWN = `g14p-known-${TS}`, PLATFORM = `g14p-platform-${TS}`, UNVERIFIED = `g14p-uv-${TS}`;
const E = (n) => `g14p-${n}-${TS}@example.test`;
const ADA_EMAIL = E('ada'), ADA_OTHER = E('ada2');
const PASSWORD = ['Synthetique', 'G14P', 'Pass1word'].join('-');
const CSRF = `g14pcsrf${TS}`;
const SUP = { id: `g14p-sup-${TS}`, email: E('sup') }, OWNPRO = { id: `g14p-own-${TS}`, email: E('own') }, UVADM = { id: `g14p-uvadm-${TS}`, email: E('uvadm') }, UVPRO = { id: `g14p-uvpro-${TS}`, email: E('uvpro') };
const SOURCE = `https://annuaire-entreprises.data.gouv.fr/etablissement/${SIRET}`;
const NOTE = 'SIRET, dénomination et adresse vérifiés sur l’Annuaire des entreprises (INSEE) ; structure active à Strasbourg.';
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_PRO_SELF_REGISTRATION', 'PRO_MFA_REQUIRED', 'MAILER_PROVIDER', 'MAILER_FROM', 'VERCEL_ENV', 'OUTLOOK_TOKEN_ENCRYPTION_KEY'];
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G14 — ADA Pro self-registration verified by ADA before anything opens (real API entry, real DB)', () => {
  let db, api, auth, mailer, inviteToken;
  const saved = {};
  const J = {};
  const call = async (method, url, { bearer, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
    const res = mkRes(); await api({ method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h }, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const ada = (mfa = true, email = ADA_EMAIL) => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: mfa });
  const pro = (u, sid, role) => auth.signProToken({ id: u.id, email: u.email, structureId: sid, role }, { mfa: true });
  const one = async (q) => (await db.execute(q)).rows[0];
  const register = (body) => call('POST', '/api/pro/auth/register', { body: { structureName: NAME, siret: SIRET, email: E('a'), password: PASSWORD, termsAccepted: true, ...body } });
  const outbox = (to) => mailer.__getTestOutbox().filter((m) => m.to === to);
  const auditOf = async (actions) => (await db.execute(sql`SELECT action, actor_id, entity_id, details FROM "AuditLog" WHERE action IN (${sql.join(actions.map((a) => sql`${a}`), sql`, `)})
    AND (details->>'structureId' IN (${J.sid || 'none'}, ${KNOWN}) OR entity_id IN (${J.sid || 'none'}, ${KNOWN}) OR entity_id IN (SELECT id FROM "ProUser" WHERE "structureId" IN (${J.sid || 'none'}, ${KNOWN}))) ORDER BY "timestamp", id`)).rows;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv({ ADA_PUBLIC_BETA_RESTRICTED: undefined, ADA_BETA_OPEN_SURFACES: undefined, ADA_PRO_SELF_REGISTRATION: undefined, PRO_MFA_REQUIRED: undefined, VERCEL_ENV: 'development',
      MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test', OUTLOOK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') });
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    inviteToken = await import('../../api/_utils/invite-token.js');
    const st = (id, nom, statut, verification, siret = null) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, siret, "updatedAt", "createdAt")
      VALUES (${id}, ${nom}, ${id}, 'association', '1 rue du Test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${verification}, ${siret}, NOW(), NOW())`);
    await st(KNOWN, `Fiche connue G14 ${TS}`, 'actif', 'VERIFIED', SIRET_KNOWN);
    await st(PLATFORM, `Plateforme G14 ${TS}`, 'brouillon', 'UNVERIFIED');
    await st(UNVERIFIED, `Non vérifiée G14 ${TS}`, 'brouillon', 'UNVERIFIED');
    const { hashPassword } = await import('../../api/_utils/user-auth.js');
    const h = await hashPassword(PASSWORD);
    const user = (u, sid, role, mfa) => db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "notificationEmailEnabled", "updatedAt") VALUES (${u.id}, ${u.email}, ${h}, ${role}, 'active', ${sid}, ${mfa}, false, NOW())`);
    await user(SUP, PLATFORM, 'SUPERADMIN', true); await user(OWNPRO, PLATFORM, 'PRO', false);
    await user(UVADM, UNVERIFIED, 'STRUCTURE_ADMIN', true); await user(UVPRO, UNVERIFIED, 'PRO', false);
    // the platform administrator (admin realm); the sender of the invitations « Vérifier et activer » writes
    for (const email of [ADA_EMAIL, ADA_OTHER]) {
      await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "failedLoginAttempts", "mfaEnabled", "updatedAt", "createdAt") VALUES (${'g14p-adm-' + crypto.randomUUID()}, ${email}, 'x', 'admin', 0, true, NOW(), NOW())`);
    }
    mailer.__clearTestOutbox();
  }, 120000);

  afterAll(async () => {
    try {
      if (!db) return;
      const sts = [KNOWN, PLATFORM, UNVERIFIED, ...(J.sid ? [J.sid] : [])];
      const inSts = sql.join(sts.map((x) => sql`${x}`), sql`, `);
      const ids = (await db.execute(sql`SELECT id FROM "ProUser" WHERE "structureId" IN (${inSts})`)).rows.map((r) => r.id);
      const inIds = ids.length ? sql.join(ids.map((x) => sql`${x}`), sql`, `) : sql`NULL`;
      await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id IN (${inIds})`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${inSts}) OR entity_id IN (${inSts}) OR entity_id IN (${inIds}) OR actor_id IN (${inIds}) OR actor_id LIKE ${'g14p-%'}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ContentVersion" WHERE "entityId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "AdminUser" WHERE email IN (${ADA_EMAIL}, ${ADA_OTHER})`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('1. the sign-up request records the terms and the SIRET, creates a pending administrator, opens nothing', async () => {
    expect((await register({ termsAccepted: undefined })).body.code, 'terms required').toBe('PRO_TERMS_ACCEPTANCE_REQUIRED');
    expect((await register({ siret: '12345678901234' })).body.code).toBe('SIRET_INVALID');
    expect((await register({ structureName: 'x'.repeat(201) })).body.code).toBe('STRUCTURE_NAME_INVALID');
    expect(await one(sql`SELECT count(*)::int AS n FROM "ProUser" WHERE lower(email) = ${E('a')}`)).toEqual({ n: 0 });

    const r = await register({});
    expect(r.statusCode, JSON.stringify(r.body)).toBe(202);
    expect(r.body.message).toMatch(/^Demande reçue — votre structure sera vérifiée sur une source officielle avant l’ouverture de votre espace/);
    expect(r.body.token, 'no session').toBeUndefined();
    const u = await one(sql`SELECT id, role, status, "structureId" FROM "ProUser" WHERE lower(email) = ${E('a')}`);
    expect(u).toMatchObject({ role: 'STRUCTURE_ADMIN', status: 'pending_verification' });
    J.sid = u.structureId; J.user = u.id;
    expect(await one(sql`SELECT nom, siret, statut, verification_status, is_pro_enabled FROM "Structure" WHERE id = ${J.sid}`))
      .toEqual({ nom: NAME, siret: SIRET, statut: 'brouillon', verification_status: 'UNVERIFIED', is_pro_enabled: false });
    const { proTermsReference } = await import('../../api/_utils/pro-terms.js');
    expect((await db.execute(sql`SELECT purpose, policy_version, proof_level, collection_channel, decision FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id = ${u.id} ORDER BY purpose`)).rows).toEqual([
      { purpose: 'TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', policy_version: proTermsReference('cgu-professionnel'), proof_level: 'CONTRACT_ACCEPTANCE', collection_channel: 'register', decision: true },
      { purpose: 'TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES', policy_version: proTermsReference('conditions-structures'), proof_level: 'CONTRACT_ACCEPTANCE', collection_channel: 'register', decision: true },
    ]);
    const [req] = await auditOf(['REGISTER_REQUESTED']);
    expect(req.details).toMatchObject({ siretKnown: false, declaredName: NAME, structureId: J.sid });
    expect(JSON.stringify(req.details)).not.toContain(E('a'));
    const welcome = outbox(E('a')).pop();
    expect(welcome.text).toContain('Demande reçue — votre structure sera vérifiée sur une source officielle');
    expect(welcome.text).not.toMatch(/maintenant actif/);

    // the pending account cannot sign in (said only to the holder of the password)
    const login = await call('POST', '/api/pro/auth/login', { body: { email: E('a'), password: PASSWORD } });
    expect(login.statusCode).toBe(403); expect(login.body.error).toBe('PRO_REGISTRATION_PENDING'); expect(login.body.token).toBeUndefined();
    expect((await call('POST', '/api/pro/auth/login', { body: { email: E('a'), password: PASSWORD + 'x' } })).statusCode).toBe(401);

    // an address already used: the same answer, a notice to the address, nothing created
    mailer.__clearTestOutbox();
    const again = await register({ structureName: `${NAME} bis`, siret: siretFor(`g14p-b-${TS}`) });
    expect(again.statusCode).toBe(202); expect(again.body).toEqual(r.body);
    expect(outbox(E('a')).map((m) => m.category)).toEqual(['pro_signup_existing']);
    expect(await one(sql`SELECT count(*)::int AS n FROM "Structure" WHERE nom = ${NAME + ' bis'}`)).toEqual({ n: 0 });
  });

  it('2. a SIRET already held by a Structure: no second Structure, the pending administrator is attached to the existing record', async () => {
    const r = await register({ structureName: 'Nom déclaré différent', siret: SIRET_KNOWN.replace(/^(\d{3})(\d{3})/, '$1 $2 '), email: E('dup') });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(202);
    expect(await one(sql`SELECT count(*)::int AS n FROM "Structure" WHERE siret = ${SIRET_KNOWN}`)).toEqual({ n: 1 });
    expect(await one(sql`SELECT nom FROM "Structure" WHERE id = ${KNOWN}`)).toEqual({ nom: `Fiche connue G14 ${TS}` });   // the record is not changed
    const u = await one(sql`SELECT id, status, role, "structureId" FROM "ProUser" WHERE lower(email) = ${E('dup')}`);
    expect(u).toMatchObject({ status: 'pending_verification', role: 'STRUCTURE_ADMIN', structureId: KNOWN });
    J.dup = u.id;
    const [req] = (await auditOf(['REGISTER_REQUESTED'])).filter((a) => a.details.structureId === KNOWN);
    expect(req.details).toMatchObject({ siretKnown: true, declaredName: 'Nom déclaré différent' });
    // a second request with the same new SIRET (another address): still one Structure
    expect((await register({ email: E('a2') })).statusCode).toBe(202);
    expect(await one(sql`SELECT count(*)::int AS n FROM "Structure" WHERE siret = ${SIRET}`)).toEqual({ n: 1 });
    expect(await one(sql`SELECT "structureId" FROM "ProUser" WHERE lower(email) = ${E('a2')}`)).toEqual({ structureId: J.sid });
  });

  it('3. an unverified structure: no MFA enrolment invitation; the SUPERADMIN\'s own structure is unchanged', async () => {
    const issue = (actor, sid, role, memberId) => call('POST', '/api/pro/mfa-invitation', { bearer: pro(actor, sid, role), body: { memberId } });
    const before = await one(sql`SELECT count(*)::int AS n FROM "Invitation" WHERE "structureId" IN (${J.sid}, ${UNVERIFIED})`);
    expect((await issue(SUP, PLATFORM, 'SUPERADMIN', J.user)).statusCode, 'a pending account is not a member yet').toBe(404);
    const uv = await issue(SUP, PLATFORM, 'SUPERADMIN', UVPRO.id);
    expect(uv.statusCode, JSON.stringify(uv.body)).toBe(409); expect(uv.body.error).toBe('STRUCTURE_NOT_VERIFIED');
    expect(await one(sql`SELECT count(*)::int AS n FROM "Invitation" WHERE "structureId" IN (${J.sid}, ${UNVERIFIED})`)).toEqual(before);
    expect((await db.execute(sql`SELECT 1 FROM "AuditLog" WHERE action = 'MFA_INVITATION_REFUSED_UNVERIFIED' AND details->>'memberId' = ${UVPRO.id}`)).rows.length).toBe(1);
    // unchanged: the SUPERADMIN invites a member of its own (unverified) platform structure; a structure administrator its own members
    expect((await issue(SUP, PLATFORM, 'SUPERADMIN', OWNPRO.id)).statusCode).toBe(201);
    expect((await issue(UVADM, UNVERIFIED, 'STRUCTURE_ADMIN', UVPRO.id)).statusCode).toBe(201);
  });

  it('4. the administration lists the pending requests with the SIRET', async () => {
    const list = await call('GET', '/api/admin/organizations?decision=pro_pending', { bearer: ada(false) });
    expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
    const mine = list.body.organizations.filter((o) => [J.sid, KNOWN].includes(o.id));
    expect(mine.map((o) => [o.id, o.pendingRegistrations, o.siret]).sort()).toEqual([[J.sid, 2, SIRET], [KNOWN, 1, SIRET_KNOWN]].sort());
    expect(list.body.organizations.some((o) => o.id === UNVERIFIED), 'no request there').toBe(false);
    const members = await call('GET', `/api/admin/organizations?members=${encodeURIComponent(J.sid)}`, { bearer: ada(false) });
    expect(members.body.members.map((m) => m.status)).toEqual(['pending_verification', 'pending_verification']);
  });

  it('5. « Vérifier et activer »: all or nothing; then verified, active, invited — and the invitation is redeemable', async () => {
    const version = (await call('GET', `/api/admin/content-verification?entityType=structure&entityId=${J.sid}`, { bearer: ada() })).body.version;
    const act = (body, bearer = ada()) => call('POST', '/api/admin/organizations', { bearer, body: { userId: J.user, action: 'VERIFY_AND_ACTIVATE_PRO_REGISTRATION', sourceUrl: SOURCE, evidenceNote: NOTE, territoryConfirmed: true, expectedVersion: version, ...body } });
    const unchanged = async () => {
      expect(await one(sql`SELECT statut, verification_status FROM "Structure" WHERE id = ${J.sid}`)).toEqual({ statut: 'brouillon', verification_status: 'UNVERIFIED' });
      expect(await one(sql`SELECT status FROM "ProUser" WHERE id = ${J.user}`)).toEqual({ status: 'pending_verification' });
      expect(await one(sql`SELECT count(*)::int AS n FROM "Invitation" WHERE "structureId" = ${J.sid}`)).toEqual({ n: 0 });
    };
    mailer.__clearTestOutbox();
    expect((await act({}, ada(false))).statusCode, 'MFA required').toBe(403);
    expect((await act({ evidenceNote: 'trop court' })).body.error).toBe('EVIDENCE_NOTE_REQUIRED');
    expect((await act({ sourceUrl: 'https://example.com/siret' })).body.error).toBe('EVIDENCE_URL_NOT_ALLOWED');
    expect((await act({ territoryConfirmed: false })).body.error).toBe('TERRITORY_CONFIRMATION_REQUIRED');
    expect((await act({ expectedVersion: 'f'.repeat(64) })).statusCode, 'stale review').toBe(409);
    expect((await act({ expectedVersion: undefined })).body.error).toBe('VERSION_REQUIRED');
    await unchanged();
    expect(outbox(E('a'))).toEqual([]);

    const ok = await act({});
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, account: { id: J.user, status: 'active' }, organization: { id: J.sid, statut: 'actif', identity: 'VERIFIED' }, mailStatus: 'TEST_RECORDED' });
    expect(await one(sql`SELECT statut, verification_status, verified_by, territory_verified FROM "Structure" WHERE id = ${J.sid}`)).toEqual({ statut: 'actif', verification_status: 'VERIFIED', verified_by: ADA_EMAIL, territory_verified: true });
    expect(await one(sql`SELECT status, mfa_enabled FROM "ProUser" WHERE id = ${J.user}`)).toEqual({ status: 'active', mfa_enabled: false });
    expect(await one(sql`SELECT status FROM "ProUser" WHERE lower(email) = ${E('a2')}`), 'only the named request').toEqual({ status: 'pending_verification' });
    const inv = await one(sql`SELECT id, email, role, token FROM "Invitation" WHERE "structureId" = ${J.sid} AND used_at IS NULL`);
    expect(inv).toMatchObject({ email: E('a'), role: 'STRUCTURE_ADMIN' }); expect(inv.token).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await one(sql`SELECT "reviewerId", outcome, "sourceUrl", "territoryConfirmed" FROM "ContentVerification" WHERE "entityId" = ${J.sid}`)).toEqual({ reviewerId: ADA_EMAIL, outcome: 'VERIFIED', sourceUrl: SOURCE, territoryConfirmed: true });
    const rows = await auditOf(['CONTENT_VERIFIED', 'ORGANIZATION_REACTIVATED', 'INVITATION_SENT', 'PRO_SELF_REGISTRATION_ACTIVATED']);
    expect(rows.filter((a) => a.entity_id === J.sid || a.details.structureId === J.sid).map((a) => a.action).sort(), 'one transaction: one timestamp, the four rows')
      .toEqual(['CONTENT_VERIFIED', 'INVITATION_SENT', 'ORGANIZATION_REACTIVATED', 'PRO_SELF_REGISTRATION_ACTIVATED']);
    const sent = rows.find((a) => a.action === 'INVITATION_SENT');
    expect(sent).toMatchObject({ actor_id: ADA_EMAIL, details: { kind: 'MFA_ENROLMENT', invitationId: inv.id, memberId: J.user, senderRealm: 'ADMIN' } });
    const mail = outbox(E('a')).pop();
    expect(mail.category).toBe('pro-mfa-invitation'); expect(mail.text).toMatch(/vérifié votre structure sur une source officielle/);
    expect((await act({})).statusCode, 'already treated').toBe(404);

    // the administrator signs in (password only, outside Production) and redeems the invitation: the admin-realm sender is accepted
    const raw = decodeURIComponent(new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.replace(/^#invitation=/, ''));
    const login = await call('POST', '/api/pro/auth/login', { body: { email: E('a'), password: PASSWORD } });
    expect(login.statusCode, JSON.stringify(login.body)).toBe(200);
    expect((await inviteToken.invitationsWithRevokedSender(db, [inv.id])).size).toBe(0);
    // a disabled administrator's invitation stops working (checked on a copy of the row's journal: the sender is the other administrator, disabled)
    await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NOW() WHERE email = ${ADA_OTHER}`);
    await db.execute(sql`UPDATE "AuditLog" SET actor_id = ${ADA_OTHER} WHERE action = 'INVITATION_SENT' AND details->>'invitationId' = ${inv.id}`);
    expect([...(await inviteToken.invitationsWithRevokedSender(db, [inv.id]))]).toEqual([inv.id]);
    await db.execute(sql`UPDATE "AuditLog" SET actor_id = ${ADA_EMAIL} WHERE action = 'INVITATION_SENT' AND details->>'invitationId' = ${inv.id}`);
    const red = await call('POST', '/api/pro/mfa-enrolment', { bearer: login.body.token, body: { token: raw } });
    expect(red.statusCode, JSON.stringify(red.body)).toBe(200); expect(red.body.enrolmentToken).toBeTruthy();
  });

  it('6. « Refuser »: the pending account is disabled, the refusal journalised, nothing deleted', async () => {
    const refuse = (body, bearer = ada()) => call('POST', '/api/admin/organizations', { bearer, body: { userId: J.dup, action: 'REFUSE_PRO_REGISTRATION', ...body } });
    expect((await refuse({ reason: 'Pas de lien avec la structure.' }, ada(false))).statusCode).toBe(403);
    expect((await refuse({ reason: '' })).body.error).toBe('reason_required');
    const ok = await refuse({ reason: 'Aucun lien vérifiable avec la structure titulaire du SIRET.' });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect(await one(sql`SELECT status FROM "ProUser" WHERE id = ${J.dup}`)).toEqual({ status: 'disabled' });
    expect((await auditOf(['PRO_ACCOUNT_DISABLED', 'PRO_SELF_REGISTRATION_REFUSED'])).filter((a) => a.entity_id === J.dup).map((a) => [a.action, a.details.reason]).sort())
      .toEqual([['PRO_ACCOUNT_DISABLED', 'Aucun lien vérifiable avec la structure titulaire du SIRET.'], ['PRO_SELF_REGISTRATION_REFUSED', 'Aucun lien vérifiable avec la structure titulaire du SIRET.']]);
    expect(await one(sql`SELECT count(*)::int AS n FROM "ConsentLog" WHERE subject_id = ${J.dup}`), 'the terms acceptance is kept').toEqual({ n: 2 });
    expect((await refuse({ reason: 'Encore une fois.' })).statusCode, 'already treated').toBe(404);
    const act = await call('POST', '/api/admin/organizations', { bearer: ada(), body: { userId: J.dup, action: 'VERIFY_AND_ACTIVATE_PRO_REGISTRATION', sourceUrl: SOURCE, evidenceNote: NOTE, territoryConfirmed: true, expectedVersion: 'a'.repeat(64) } });
    expect(act.statusCode, 'a refused request cannot be activated').toBe(404);
    expect((await call('POST', '/api/pro/auth/login', { body: { email: E('dup'), password: PASSWORD } })).statusCode).toBe(403);
  });
});
