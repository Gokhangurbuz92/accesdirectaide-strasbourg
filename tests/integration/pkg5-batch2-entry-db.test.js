/**
 * PKG-5 batch 2 on REAL PostgreSQL THROUGH THE REAL API ENTRY (synthetic data only; the TOTP secrets, vault key and accounts are test fixtures):
 *   A16  named admin login (lockout), MFA step, JIT elevation (superadmin only, fresh code, reason), expiry, break-glass reviewed by ANOTHER admin, every admin write audited,
 *        and NO dossier access for any admin / elevated / break-glass / institutional session (negative tests on the dossier, case, referral, Coffre and share routes)
 *   A15  kill switch needs elevation; forced OFF closes public reports; cleared reopens them; unknown flag refused
 *   A13  audit search needs MFA; export needs elevation, is itself audited and formula-safe
 *   A07  every content change keeps the exact prior version; rollback restores it exactly, never the verification state
 *   A12  legal hold release and ownership recovery need two different administrators (also database CHECKs)
 *   A19  support requests stored sealed; readable only with MFA; closing needs a note; audited
 *   P19  content-report triage works for an admin session (it never could), changes need MFA
 *   I01 I03 I04 I05  agreement recorded from a signed document -> account activation; institutional token = aggregates only; deterministic, suppressed export behind its flag;
 *        ending the agreement suspends the account
 *   R22  the person grants / withdraws the SIAO purpose per organization with its own action; the AI toggle keeps it; the RC5 purposes list is unchanged
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { sup: `k5-sup-${TS}@example.test`, adm: `k5-adm-${TS}@example.test`, adm2: `k5-adm2-${TS}@example.test` };
const PW = 'k5-Synthetic-Pass-1';
const CIT = { id: `k5-cit-${TS}`, email: `k5-cit-${TS}@example.test` };
const ST = `k5-st-${TS}`; const CSRF = 'k5csrf' + TS; const COMMUNE = `QA-Commune-${TS}`;
const savedVaultKey = process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-5 batch 2 (K5) through the real API entry (real DB)', () => {
  let db, api, auth, userAuth, otp, secrets = {}, share; const extraDossiers = [];
  const call = async (method, url, { bearer, body, cit, anon, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(anon ? { cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}),   // an anonymous browser form: double-submit CSRF pair
      ...(cit ? { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}), ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  // a TOTP code is accepted ONCE (owner LAB audit, RFC 6238 §5.2): `ahead` = 1 gives the code of the next 30-second step (still within the tolerance, not used yet)
  const code = (email, ahead = 0) => otp.generateSync({ secret: secrets[email], epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
  const mfaToken = (email, role) => auth.signAdminSessionToken({ email, role, mfa_verified: true });
  // the elevation route itself (fresh code, reason, superadmin, single use) is exercised in the A16 test; the other tests start from an elevated session (its claims)
  const elevated = async (email) => auth.signAdminSessionToken({ email, role: 'superadmin', mfa_verified: true, elev_until: Math.floor(Date.now() / 1000) + 15 * 60, elev_kind: 'JIT', elev_id: 'qa-' + crypto.randomUUID() });
  const DOSSIER_ROUTES = [['GET', '/api/pro/dossier?shareId=x'], ['GET', '/api/pro/cases?scope=unassigned'], ['GET', '/api/pro/referrals'], ['GET', '/api/pro/dossier/export?shareId=x'], ['GET', '/api/citizen/dossier'], ['GET', '/api/citizen/coffre'], ['POST', '/api/share/get']];

  beforeAll(async () => {
    process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');   // synthetic vault key for this suite only
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); otp = await import('otplib');
    const vault = await import('../../api/_utils/vault.js');
    for (const [email, role] of [[A.sup, 'superadmin'], [A.adm, 'admin'], [A.adm2, 'admin']]) {
      secrets[email] = otp.generateSecret(); const enc = vault.encryptToken(secrets[email]);
      await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "mfaSecret", "mfaIv")
        VALUES (${'k5-' + crypto.randomUUID()}, ${email}, ${await userAuth.hashPassword(PW)}, ${role}, NOW(), NOW(), 0, true, ${enc.content}, ${enc.iv})`);
    }
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, ${await userAuth.hashPassword(PW)}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ST}, ${'K5 Org ' + TS}, ${ST}, 'association', '1 rue', ${COMMUNE}, '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'UNVERIFIED', NOW(), NOW())`);
    const created = await call('POST', '/api/share/create', { cit: true, body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    share = { id: created.body.shareId, owner: created.body.ownerSecret };
  }, 90000);
  afterAll(async () => {
    if (savedVaultKey === undefined) delete process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY; else process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY = savedVaultKey;
    delete process.env.OPEN_DATA_EXPORT_ENABLED;
    if (!db) return;
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email LIKE ${'k5-%' + TS + '@example.test'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE email LIKE ${'%' + TS + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE "partnerName" LIKE ${'%' + TS + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "FeatureFlagOverride"`).catch(() => {});
    await db.execute(sql`DELETE FROM "LegalHold" WHERE "recordId" = ${share?.id || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${share?.id || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${share?.id || ''}`).catch(() => {});
    for (const d of extraDossiers) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${d}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Referral" WHERE "toStructureId" LIKE ${'k5-%' + TS + '%'} OR "fromStructureId" LIKE ${'k5-%' + TS + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" LIKE ${'k5-%' + TS + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${'k5-%' + TS + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('A16: separate admin login (wrong password refused, MFA step announced), MFA verify, JIT only for a superadmin with a fresh code and a reason', async () => {
    expect((await call('POST', '/api/admin/login', { anon: true, body: { email: A.adm, password: 'wrong' } })).statusCode).toBe(401);
    const ok = await call('POST', '/api/admin/login', { anon: true, body: { email: A.adm, password: PW } });
    expect(ok.statusCode).toBe(200); expect(ok.body.mfa_required).toBe(true);
    const pre = ok.body.token;
    expect((await call('POST', '/api/admin/privacy', { bearer: pre, body: { action: 'hold_place' } })).statusCode, 'no write before MFA').toBe(403);
    const used = code(A.adm);
    const v = await call('POST', '/api/admin/mfa-verify', { bearer: pre, body: { code: used } });
    expect(v.statusCode).toBe(200); expect(auth.verifyAdminSessionToken(v.body.token).mfa_verified).toBe(true);
    expect((await call('POST', '/api/admin/mfa-verify', { bearer: pre, body: { code: used } })).statusCode, 'the same code is not accepted twice').toBe(403);
    const asAdmin = await call('POST', '/api/admin/elevation', { bearer: v.body.token, body: { action: 'elevate', code: code(A.adm, 1), reason: 'Synthetic QA platform operation' } });
    expect([asAdmin.statusCode, asAdmin.body.error]).toEqual([403, 'SUPERADMIN_REQUIRED']);
    const noReason = await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'elevate', code: code(A.sup), reason: 'short' } });
    expect(noReason.statusCode).toBe(400);
    const badCode = await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'elevate', code: '000000', reason: 'Synthetic QA platform operation' } });
    expect(badCode.statusCode).toBe(403);
    const fresh = code(A.sup);
    const granted = await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'elevate', code: fresh, reason: 'Synthetic QA platform operation' } });
    expect(granted.statusCode).toBe(200); const tok = granted.body.token;
    const replay = await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'elevate', code: fresh, reason: 'Synthetic QA platform operation' } });
    expect([replay.statusCode, replay.body.error], 'an elevation code is accepted once').toEqual([403, 'FRESH_MFA_CODE_REQUIRED']);
    const st = await call('GET', '/api/admin/elevation', { bearer: tok });
    expect(st.body.elevated).toBe(true); expect(st.body.kind).toBe('JIT'); expect(new Date(st.body.until).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    const expired = auth.signAdminSessionToken({ email: A.sup, role: 'superadmin', mfa_verified: true, elev_until: Math.floor(Date.now() / 1000) - 1, elev_kind: 'JIT', elev_id: 'x' });
    const exp = await call('POST', '/api/admin/platform', { bearer: expired, body: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true, reason: 'Synthetic QA kill switch' } });
    expect([exp.statusCode, exp.body.error]).toEqual([403, 'ELEVATION_REQUIRED']);
    const audited = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE actor = ${A.sup} AND action IN ('ADMIN_ELEVATION_GRANTED', 'ADMIN_ELEVATION_REFUSED')`)).rows.map((r) => r.action);
    expect(audited).toEqual(expect.arrayContaining(['ADMIN_ELEVATION_GRANTED', 'ADMIN_ELEVATION_REFUSED']));
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'hold_place' } })).statusCode).toBe(400);   // a gated write, answered
    await new Promise((r) => setTimeout(r, 300));
    const writes = (await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ADMIN_API_WRITE' AND actor = ${A.sup}`)).rows[0].n;
    expect(writes).toBeGreaterThan(0);
  });

  it('A16: break-glass (any named MFA admin) is listed until ANOTHER admin reviews it', async () => {
    // opened by A.adm2 (A.adm's two current codes were used by the A16 sign-in test: a code is accepted once), reviewed by A.adm
    const bg = await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'break_glass', code: code(A.adm2), reason: 'Synthetic QA emergency, primary superadmin unavailable' } });
    expect(bg.statusCode).toBe(200); expect(bg.body.elevation.kind).toBe('BREAK_GLASS');
    const id = bg.body.elevation.id;
    const pending = (await call('GET', '/api/admin/elevation', { bearer: mfaToken(A.adm, 'admin') })).body.pendingBreakGlassReviews.map((p) => p.id);
    expect(pending).toContain(id);
    expect((await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'review', id, note: 'I review myself' } })).body.error).toBe('TWO_PERSON_RULE');
    expect((await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'review', id, note: 'Journal checked: nothing beyond the emergency.' } })).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/elevation', { bearer: mfaToken(A.adm, 'admin') })).body.pendingBreakGlassReviews.map((p) => p.id)).not.toContain(id);
  });

  it('A16 / I01: no administrator (MFA, elevated, break-glass) and no institutional session can reach a dossier, case, referral, Coffre or share route', async () => {
    const bg = (await call('POST', '/api/admin/elevation', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'break_glass', code: code(A.adm2, 1), reason: 'Synthetic QA negative dossier test' } })).body.token;
    const inst = (await import('../../api/_utils/institution-auth.js')).signInstitutionToken({ id: 'k5-none', email: 'x@example.test' });
    for (const bearer of [mfaToken(A.sup, 'superadmin'), await elevated(A.sup), bg, inst]) {
      for (const [m, u] of DOSSIER_ROUTES) {
        const r = await call(m, u, { bearer, body: m === 'POST' ? { shareId: share.id } : undefined });
        expect([401, 403, 404], `${u} must refuse`).toContain(r.statusCode);
        expect(JSON.stringify(r.body || '')).not.toMatch(/zipCode|67000/);
      }
    }
  });

  it('A15 kill switch (elevation) closes and reopens public reports; A13 audit search (MFA) and export (elevation, audited, formula-safe)', async () => {
    const tok = await elevated(A.sup);
    expect((await call('POST', '/api/admin/platform', { bearer: mfaToken(A.sup, 'superadmin'), body: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true, reason: 'Synthetic QA kill switch' } })).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/platform', { bearer: tok, body: { action: 'flag', key: 'NOPE', forcedOff: true, reason: 'Synthetic QA kill switch' } })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/platform', { bearer: tok, body: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true, reason: 'Synthetic QA kill switch' } })).statusCode).toBe(200);
    const report = { contentType: 'AIDE', contentId: 'k5-x', reason: 'AUTRE', message: 'test' };
    expect((await call('POST', '/api/reports', { anon: true, body: report })).statusCode).toBe(503);
    expect((await call('POST', '/api/admin/platform', { bearer: tok, body: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: false, reason: 'Synthetic QA reopen' } })).statusCode).toBe(200);
    const created = await call('POST', '/api/reports', { anon: true, body: report }); expect(created.statusCode).toBe(201);
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, details) VALUES (${'k5-' + TS}, ${'=HYPERLINK("x")'}, ${`k5-formula-${TS}@example.test`}, '{}'::jsonb)`);
    expect((await call('GET', `/api/admin/audit-log?actor=k5-formula-${TS}@example.test`, { bearer: auth.signAdminSessionToken({ email: A.sup, role: 'superadmin', mfa_verified: false }) })).statusCode).toBe(403);
    const found = await call('GET', `/api/admin/audit-log?actor=k5-formula-${TS}@example.test`, { bearer: mfaToken(A.sup, 'superadmin') });
    expect(found.statusCode).toBe(200); expect(found.body.items.length).toBe(1); expect(found.body.items[0]).not.toHaveProperty('ip');
    expect((await call('POST', '/api/admin/audit-log', { bearer: mfaToken(A.sup, 'superadmin'), body: { actor: `k5-formula-${TS}@example.test`, reason: 'Synthetic QA export' } })).statusCode).toBe(403);
    const exp = await call('POST', '/api/admin/audit-log', { bearer: tok, body: { actor: `k5-formula-${TS}@example.test`, reason: 'Synthetic QA export' } });
    expect(exp.statusCode).toBe(200); expect(String(exp.body)).toContain(`'=HYPERLINK`);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'AUDIT_EXPORTED' AND actor = ${A.sup}`)).rows[0].n).toBeGreaterThan(0);
    await db.execute(sql`DELETE FROM "ContentReport" WHERE "contentId" = 'k5-x'`);
  });

  it('P19: an admin session can triage public reports (it never could); a change needs MFA', async () => {
    const r = await call('POST', '/api/reports', { anon: true, body: { contentType: 'AIDE', contentId: 'k5-y', reason: 'AUTRE' } }); const id = r.body.reportId;
    expect((await call('GET', '/api/reports?status=NEW', { bearer: auth.signAdminSessionToken({ email: A.adm, role: 'admin', mfa_verified: false }) })).statusCode).toBe(200);
    expect((await call('PUT', `/api/reports?id=${id}`, { bearer: auth.signAdminSessionToken({ email: A.adm, role: 'admin', mfa_verified: false }), body: { status: 'FIXED' } })).statusCode).toBe(403);
    expect((await call('PUT', `/api/reports?id=${id}`, { bearer: mfaToken(A.adm, 'admin'), body: { status: 'FIXED' } })).statusCode).toBe(200);
    await db.execute(sql`DELETE FROM "ContentReport" WHERE id = ${id}`);
  });

  it('A07: every content change keeps the exact prior version; rollback restores it exactly and never the verification state', async () => {
    const snap = async () => (await db.execute(sql`SELECT to_jsonb(s) - 'updatedAt' AS j FROM "Structure" s WHERE id = ${ST}`)).rows[0].j;
    const before = await snap();
    // owner LAB audit: a VERIFY carries the version of the content read (GET … version)
    const read = await call('GET', `/api/admin/content-verification?entityType=structure&entityId=${ST}`, { bearer: mfaToken(A.adm, 'admin') });
    const v = await call('POST', '/api/admin/content-verification', { bearer: mfaToken(A.adm, 'admin'), body: { entityType: 'structure', entityId: ST, action: 'VERIFY', expectedVersion: read.body.version, sourceUrl: 'https://www.service-public.fr/x', evidenceNote: 'Synthetic fixture: official page compared.', territoryConfirmed: true } });
    expect(v.statusCode).toBe(200);
    await db.execute(sql`UPDATE "Structure" SET adresse = '99 rue changée' WHERE id = ${ST}`);   // a later edit of the content
    const versions = (await call('GET', `/api/admin/content-versions?entityType=structure&entityId=${ST}`, { bearer: mfaToken(A.adm, 'admin') })).body.versions;
    expect(versions.length).toBeGreaterThanOrEqual(1);
    const target = versions[versions.length - 1];
    expect((await call('POST', '/api/admin/content-versions', { bearer: mfaToken(A.adm, 'admin'), body: { versionId: target.id, reason: 'short' } })).statusCode).toBe(400);
    const rb = await call('POST', '/api/admin/content-versions', { bearer: mfaToken(A.adm, 'admin'), body: { versionId: target.id, reason: 'Synthetic QA rollback test' } });
    expect(rb.statusCode).toBe(200);
    const after = await snap();
    const strip = (j) => Object.fromEntries(Object.entries(j).filter(([k]) => !['verification_status', 'verified_by', 'date_verification', 'territory_verified', 'launch_eligible', 'publication_hold', 'data_origin', 'source_url'].includes(k)));
    expect(strip(after)).toEqual(strip(before));
    expect(after.verification_status).toBe('VERIFIED');   // the ledger said VERIFIED: a rollback never removes or forges it
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'CONTENT_ROLLED_BACK' AND entity_id = ${ST}`)).rows[0].n).toBe(1);
  });

  it('A12: legal hold — placing protects at once; releasing needs a second administrator (and the database refuses the same person)', async () => {
    const h = await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'hold_place', dataCategory: 'SharedDiagnostic', recordId: share.id, reasonCode: 'Synthetic QA litigation hold' } });
    expect(h.statusCode).toBe(200);
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'hold_confirm_release', id: h.body.id } })).body.error).toBe('NO_PROPOSAL');
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'hold_propose_release', id: h.body.id, reason: 'Synthetic QA end of litigation' } })).statusCode).toBe(200);
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'hold_confirm_release', id: h.body.id } })).body.error).toBe('TWO_PERSON_RULE');
    const direct = await db.execute(sql`UPDATE "LegalHold" SET "releasedBy" = ${A.adm}, status = 'RELEASED' WHERE id = ${h.body.id}`).then(() => 'ok', (e) => String(e.code || e.cause?.code));
    expect(direct).toBe('23514');
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'hold_propose_release', id: h.body.id, reason: 'A second proposal must not overwrite the first' } })).statusCode, 'a pending proposal is never overwritten (PKG-6 / D22)').toBe(404);
    const seen = (await call('GET', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin') })).body.legalHolds.find((x) => x.id === h.body.id);
    expect(seen.releaseReason).toBe('Synthetic QA end of litigation');
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'hold_confirm_release', id: h.body.id } })).body.error, 'the confirmation names the proposal it read').toBe('VERSION_CHANGED');
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'hold_confirm_release', id: h.body.id, proposedAt: '2001-01-01T00:00:00.000Z' } })).body.error).toBe('VERSION_CHANGED');
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'hold_confirm_release', id: h.body.id, proposedAt: seen.releaseProposedAt } })).statusCode).toBe(200);
    const ov = await call('GET', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin') });
    expect(ov.statusCode).toBe(200); expect(ov.body.retention.conflicts).toEqual([]); expect(ov.body.retention.pendingReview.map((x) => x.key)).toEqual(expect.arrayContaining(['AUDIT_LOG', 'CONSENT_LOG'])); expect(ov.body.retention.notImplemented).toEqual(['INACTIVE_ACCOUNT']);
  });

  it('A12: assisted ownership recovery — proposed by one, decided by another; the old password stops working, the new address is unverified', async () => {
    const next = `k5-new-${TS}@example.test`;
    const p = await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'recovery_propose', currentEmail: CIT.email, newEmail: next, evidenceNote: 'Synthetic QA: identity document checked in person, not copied.' } });
    expect(p.statusCode).toBe(200);
    expect((await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm, 'admin'), body: { action: 'recovery_decide', id: p.body.id, decision: 'APPROVE', note: 'Self approval attempt' } })).body.error).toBe('TWO_PERSON_RULE');
    // R12 (C25): the new address gets the link that proves it (and lets the person choose a password); the former address is told; the answer says what happened
    const mailer = await import('../../api/_utils/mailer.js'); const savedMailer = process.env.MAILER_PROVIDER; process.env.MAILER_PROVIDER = 'test'; mailer.__clearTestOutbox();
    const decided = await call('POST', '/api/admin/privacy', { bearer: mfaToken(A.adm2, 'admin'), body: { action: 'recovery_decide', id: p.body.id, decision: 'APPROVE', note: 'Second reviewer: evidence consistent.' } });
    if (savedMailer === undefined) delete process.env.MAILER_PROVIDER; else process.env.MAILER_PROVIDER = savedMailer;
    expect(decided.statusCode).toBe(200); expect(decided.body).toMatchObject({ linkSent: 'TEST_RECORDED', previousNotified: 'TEST_RECORDED' });
    const box = mailer.__getTestOutbox();
    expect(box.find((m) => m.to === next)?.text).toMatch(/\/api\/auth\/verify-email\?token=/);
    expect(box.find((m) => m.to === CIT.email)?.text).toMatch(/remplacée/); expect(box.find((m) => m.to === CIT.email)?.text).not.toContain(next);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuthToken" WHERE "userId" = ${CIT.id} AND type = 'EMAIL_VERIFY' AND "usedAt" IS NULL AND "expiresAt" > NOW()`)).rows[0].n).toBe(1);
    const [u] = (await db.execute(sql`SELECT email, "emailVerifiedAt", "passwordHash" FROM "CitizenUser" WHERE id = ${CIT.id}`)).rows;
    expect(u.email).toBe(next); expect(u.emailVerifiedAt).toBeNull(); expect(await userAuth.verifyPassword(PW, u.passwordHash)).toBe(false);
    const stored = (await db.execute(sql`SELECT "newEmailEncrypted" AS e FROM "OwnershipRecoveryCase" WHERE id = ${p.body.id}`)).rows[0].e;
    expect(stored).not.toContain(next);
    await db.execute(sql`UPDATE "CitizenUser" SET email = ${CIT.email} WHERE id = ${CIT.id}`);
  });

  it('A19: help requests are stored sealed, readable only with MFA, closed only with a note, and audited', async () => {
    const r = await call('POST', '/api/support', { anon: true, body: { category: 'BOOKING', message: `Synthetic QA help request ${TS}`, contact: 'k5-contact@example.test' } });
    expect(r.statusCode).toBe(201);
    const raw = (await db.execute(sql`SELECT "messageEncrypted" AS m, "contactEncrypted" AS c, id FROM "SupportRequest" ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
    expect(raw.m).not.toContain('Synthetic QA'); expect(raw.c).not.toContain('k5-contact');
    expect((await call('GET', '/api/admin/support', { bearer: auth.signAdminSessionToken({ email: A.adm, role: 'admin', mfa_verified: false }) })).statusCode).toBe(403);
    const list = await call('GET', '/api/admin/support', { bearer: mfaToken(A.adm, 'admin') });
    const mine = list.body.requests.find((x) => x.id === raw.id); expect(mine.message).toBe(`Synthetic QA help request ${TS}`);
    // R12 (A19): the decrypted read is journaled with who read which requests, never their content
    const readRow = (await db.execute(sql`SELECT actor, details FROM "AuditLog" WHERE action = 'SUPPORT_REQUESTS_READ' AND actor = ${A.adm} ORDER BY "timestamp" DESC LIMIT 1`)).rows[0];
    expect(readRow.details.ids).toContain(raw.id); expect(JSON.stringify(readRow.details)).not.toContain('Synthetic QA help');
    expect((await call('POST', '/api/admin/support', { bearer: mfaToken(A.adm, 'admin'), body: { id: raw.id, status: 'CLOSED' } })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/support', { bearer: mfaToken(A.adm, 'admin'), body: { id: raw.id, status: 'CLOSED', resolutionNote: 'Answered by phone (synthetic).' } })).statusCode).toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'SUPPORT_REQUEST_UPDATED' AND entity_id = ${raw.id}`)).rows[0].n).toBe(1);
    expect((await call('POST', '/api/support', { anon: true, body: { category: 'NOPE', message: 'Synthetic QA invalid' } })).statusCode).toBe(400);
    await db.execute(sql`DELETE FROM "SupportRequest" WHERE id = ${raw.id}`);
  });

  it('I05 / I01 / I03 / I04: agreement from a signed document -> activation; aggregates only; suppressed, deterministic export behind its flag; ending the agreement suspends', async () => {
    const tok = await elevated(A.sup); const mfa = mfaToken(A.sup, 'superadmin');
    const g = await call('POST', '/api/admin/institutions', { bearer: mfa, body: { action: 'agreement_create', partnerName: `QA Collectivité ${TS}`, kind: 'CONVENTION', scope: 'statistiques' } });
    expect(g.statusCode).toBe(200);
    expect((await call('POST', '/api/admin/institutions', { bearer: mfa, body: { action: 'account_create', email: `k5-inst-${TS}@example.test`, organisationName: 'QA Collectivité', territory: 'Bas-Rhin', agreementId: g.body.id } })).statusCode, 'needs elevation').toBe(403);
    const acc = await call('POST', '/api/admin/institutions', { bearer: tok, body: { action: 'account_create', email: `k5-inst-${TS}@example.test`, organisationName: 'QA Collectivité', territory: 'Bas-Rhin', agreementId: g.body.id } });
    expect(acc.statusCode).toBe(200); expect(acc.body.initialPassword).toBeTruthy();
    expect((await call('POST', '/api/admin/institutions', { bearer: tok, body: { action: 'account_activate', id: acc.body.id } })).body.error).toBe('AGREEMENT_NOT_SIGNED');
    expect((await call('POST', '/api/institution/login', { anon: true, body: { email: `k5-inst-${TS}@example.test`, password: acc.body.initialPassword } })).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/institutions', { bearer: mfa, body: { action: 'agreement_sign', id: g.body.id, documentRef: 'QA-REF-1', signedAt: '2999-01-01', signedByPartner: 'QA signataire' } })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/institutions', { bearer: mfa, body: { action: 'agreement_sign', id: g.body.id, documentRef: 'QA-REF-1', signedAt: '2026-10-01', signedByPartner: 'QA signataire' } })).statusCode).toBe(200);
    expect((await call('POST', '/api/admin/institutions', { bearer: tok, body: { action: 'account_activate', id: acc.body.id } })).statusCode).toBe(200);
    const login = await call('POST', '/api/institution/login', { anon: true, body: { email: `k5-inst-${TS}@example.test`, password: acc.body.initialPassword } });
    expect(login.statusCode).toBe(200); const it_ = login.body.token;
    for (const [m, u] of DOSSIER_ROUTES) expect([401, 403, 404]).toContain((await call(m, u, { bearer: it_, body: m === 'POST' ? { shareId: share.id } : undefined })).statusCode);
    expect((await call('GET', '/api/admin/organizations', { bearer: it_ })).statusCode).toBe(401);
    // observatoire fixture: a commune with exactly three verified organizations; 7 referrals sent in the last complete calendar quarter (PKG-11 audit pass 2: the
    // observatoire and the export publish that quarter only — before, « last month » of a rolling window) to one of them, 2 unanswered for capacity (masked)
    const orgs = [`k5-o1-${TS}`, `k5-o2-${TS}`, `k5-o3-${TS}`];
    for (const id of orgs) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${COMMUNE + '-obs'}, '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    const lastMonth = new Date((await import('../../api/_services/territorial-stats.js')).periodWindow('quarter').start.getTime() + 9 * 86400000);   // inside the published quarter
    const dossiers = [];   // one live referral per dossier and receiver: seven synthetic dossiers
    for (let i = 0; i < 7; i += 1) dossiers.push((await call('POST', '/api/share/create', { cit: true, body: { situation: { zipCode: '67000' }, results: { rights: [] } } })).body.shareId);
    extraDossiers.push(...dossiers);
    for (let i = 0; i < 7; i += 1) await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
      VALUES (${`k5-ref-${i}-${TS}`}, ${dossiers[i]}, ${orgs[1]}, ${orgs[0]}, 'SENT', 'HOUSING', ${i < 2 ? 'NO_CAPACITY' : null}, ${lastMonth}, ${'k5-grant-fixture'}, ${lastMonth}, ${lastMonth}, NOW())`);
    const obs = await call('GET', '/api/institution/observatoire', { bearer: it_ });
    expect(obs.statusCode).toBe(200);
    expect(obs.body.byNeed.every((r) => (r.sent === null || r.sent >= 5) && (r.unmet === null || r.unmet >= 5))).toBe(true);
    expect(obs.body.byCommune.find((r) => r.commune === COMMUNE + '-obs')).toEqual({ commune: COMMUNE + '-obs', sent: 7, unmet: null });
    expect(obs.body.methodology.limites).toMatch(/inférieure à 5/);
    expect(JSON.stringify(obs.body)).not.toMatch(/k5-o\d|@example\.test/);
    expect((await call('GET', '/api/institution/export?period=quarter', { bearer: it_ })).statusCode, 'licence not decided: closed').toBe(503);
    process.env.OPEN_DATA_EXPORT_ENABLED = 'true';
    expect((await call('GET', '/api/institution/export?period=month', { bearer: it_ })).statusCode, 'PKG-11 audit pass 2: one granularity only').toBe(400);
    const e1 = await call('GET', '/api/institution/export?period=quarter', { bearer: it_ }); const e2 = await call('GET', '/api/institution/export?period=quarter', { bearer: it_ });
    expect(e1.statusCode).toBe(200); expect(e1.headers['x-content-sha256']).toBe(e2.headers['x-content-sha256']);
    const line = String(e1.body).split('\r\n').find((l) => l.includes(COMMUNE + '-obs'));
    expect(line).toMatch(/PENDING_OWNER_DECISION/); expect(line.split(',').slice(-4)).toEqual(['3', '', '7', '']);
    delete process.env.OPEN_DATA_EXPORT_ENABLED;
    expect((await call('POST', '/api/admin/institutions', { bearer: mfa, body: { action: 'agreement_end', id: g.body.id } })).body.accountsSuspended).toBe(1);
    expect((await call('GET', '/api/institution/me', { bearer: it_ })).statusCode).toBe(401);
  });

  it('R22: the person grants and withdraws the SIAO purpose per organization; the AI toggle keeps it; the RC5 purposes list is unchanged', async () => {
    await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${ST}`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", purposes, "grantedVia", "createdAt") VALUES (${'k5-g-' + TS}, ${share.id}, ${ST}, 'k5-pro', 'PURP-06', 'invite', NOW())`);
    const own = (body) => call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: share.id, ...body }, headers: { 'x-share-owner-secret': share.owner } });
    const purposes = async () => (await db.execute(sql`SELECT purposes FROM "SharedDossierGrant" WHERE id = ${'k5-g-' + TS}`)).rows[0].purposes.split(',').sort();
    expect((await own({ action: 'set_siao', structureId: ST, siao: true })).statusCode).toBe(200);
    expect(await purposes()).toEqual(['PURP-06', 'PURP-07']);
    expect((await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);
    expect(await purposes()).toEqual(['PURP-05', 'PURP-06', 'PURP-07']);
    expect((await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-07'] })).statusCode, 'RC5 list unchanged').toBe(400);
    expect((await own({ action: 'set_siao', structureId: ST, siao: false })).statusCode).toBe(200);
    expect(await purposes()).toEqual(['PURP-05', 'PURP-06']);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action IN ('DOSSIER_SIAO_CONSENT_GIVEN', 'DOSSIER_SIAO_CONSENT_WITHDRAWN') AND details::text LIKE ${'%' + ST + '%'}`)).rows[0].n).toBe(2);
  });
  // kept LAST: ending an elevation ends every earlier session of that administrator
  it('R12 (A16): ending an elevation ends the elevated token at once; the plain MFA session it returns still works', async () => {
    const tok = await elevated(A.sup);
    expect((await call('GET', '/api/admin/elevation', { bearer: tok })).body.elevated).toBe(true);
    const end = await call('POST', '/api/admin/elevation', { bearer: tok, body: { action: 'end' } });
    expect(end.statusCode, JSON.stringify(end.body)).toBe(200);
    expect([401, 403]).toContain((await call('GET', '/api/admin/elevation', { bearer: tok })).statusCode);
    const plain = await call('GET', '/api/admin/elevation', { bearer: end.body.token });
    expect(plain.statusCode).toBe(200); expect(plain.body.elevated).toBe(false);
  });
});
