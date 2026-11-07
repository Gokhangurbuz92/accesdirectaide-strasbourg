/**
 * Release A / G-1 (activation plan 07/11/2026) — REAL PostgreSQL, real handlers, real pro JWTs, in-memory 'test' mailer (nothing leaves the machine).
 * The platform's SUPERADMIN (second-factor session, enrolled active account) invites the FIRST administrator of an active, identity-verified partner
 * structure — the path that replaces public structure sign-up in Production. Every other actor, role or structure state is refused without writing anything;
 * the invitation is bound to the target structure, journalised without the address, redeemed into a STRUCTURE_ADMIN of that structure, and stops working
 * if the SUPERADMIN loses the role before it is used. The ordinary own-structure invitation is unchanged. Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PLATFORM = `rela-pf-${TS}`, PILOT = `rela-pi-${TS}`, DRAFT = `rela-dr-${TS}`, UNVERIFIED = `rela-uv-${TS}`, SUSPENDED = `rela-su-${TS}`, OTHER = `rela-ot-${TS}`;
const U = (n, sid, role, extra = {}) => ({ id: `rela-${n}-${TS}`, email: `rela-${n}-${TS}@example.test`, sid, role, status: 'active', mfa: true, ...extra });
const OP = U('op', PLATFORM, 'SUPERADMIN'), OP2 = U('op2', PLATFORM, 'SUPERADMIN'), NOFACTOR = U('nf', PLATFORM, 'SUPERADMIN', { mfa: false });
const SA = U('sa', OTHER, 'STRUCTURE_ADMIN');
const PASSWORD = 'Synthetique-QA-2026!x';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('Release A / G-1 — platform invitation of a partner structure\'s first administrator (real DB)', () => {
  let db, auth, mailer, H;
  const hdr = (u, mfa = true) => ({ host: 'localhost', authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role }, { mfa })}` });
  const call = async (h, req) => { const r = mk(); await h({ query: {}, socket: {}, ...req }, r); return r; };
  const invite = (u, body, mfa = true) => call(H.invite, { method: 'POST', url: '/api/pro/invite', body, headers: hdr(u, mfa) });
  const redeem = (token) => call(H.register, { method: 'POST', url: '/api/pro/auth/register-invite', body: { token, password: PASSWORD }, headers: { host: 'localhost' } });
  const tokenFromMail = (to) => { const m = mailer.__getTestOutbox().filter((x) => x.to === to).pop(); expect(m, 'invitation e-mail handed to the mailer').toBeTruthy(); return new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); };
  const n = async (q) => (await db.execute(q)).rows[0].n;

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    H = { invite: (await import('../../api/_handlers/pro/invite.js')).default, register: (await import('../../api/_handlers/pro/auth/register-invite.js')).default };
    const st = [[PLATFORM, 'brouillon', 'UNVERIFIED'], [PILOT, 'actif', 'VERIFIED'], [DRAFT, 'brouillon', 'UNVERIFIED'], [UNVERIFIED, 'actif', 'UNVERIFIED'], [SUSPENDED, 'suspendu', 'VERIFIED'], [OTHER, 'actif', 'VERIFIED']];
    for (const [sid, statut, ver] of st) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${sid}, ${'Release A ' + sid}, ${sid + '-slug'}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${ver}, NOW(), NOW())`);
    }
    for (const u of [OP, OP2, NOFACTOR, SA]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${u.id}, ${u.email}, 'x', ${u.role}, ${u.status}, ${u.sid}, ${u.mfa}, NOW())`);
    }
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const all = [PLATFORM, PILOT, DRAFT, UNVERIFIED, SUSPENDED, OTHER];
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)}) OR actor_id LIKE ${'rela-%-' + TS}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
  });

  it('refuses every actor, role or structure state outside the rule, and writes nothing', async () => {
    const email = `rela-refused-${TS}@example.test`;
    const cases = [
      [SA, { email, role: 'STRUCTURE_ADMIN', structure: PILOT }, true, 403, 'PLATFORM_INVITATION_FORBIDDEN'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: PILOT }, false, 403, 'PLATFORM_INVITATION_MFA_REQUIRED'],
      [NOFACTOR, { email, role: 'STRUCTURE_ADMIN', structure: PILOT }, true, 403, 'PLATFORM_INVITATION_FORBIDDEN'],
      [OP, { email, role: 'PRO', structure: PILOT }, true, 400, 'PLATFORM_INVITATION_ROLE'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: `rela-unknown-${TS}` }, true, 404, 'PLATFORM_INVITATION_STRUCTURE_NOT_FOUND'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: DRAFT }, true, 409, 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: UNVERIFIED }, true, 409, 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: SUSPENDED }, true, 409, 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE'],
      [OP, { email, role: 'STRUCTURE_ADMIN', structure: PLATFORM }, true, 409, 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE'],
    ];
    for (const [who, body, mfa, status, code] of cases) {
      const r = await invite(who, body, mfa);
      expect(r.statusCode, `${who.id} → ${JSON.stringify(body)}`).toBe(status);
      expect(r.body.code).toBe(code);
    }
    expect(await n(sql`SELECT count(*)::int n FROM "Invitation" WHERE email = ${email}`), 'no invitation from a refusal').toBe(0);
    expect(mailer.__getTestOutbox().filter((m) => m.to === email)).toHaveLength(0);
  });

  it('invites the first administrator of an active verified structure (by slug): bound to it, journalised without the address, redeemed as its STRUCTURE_ADMIN', async () => {
    const email = `rela-first-admin-${TS}@example.test`;
    const r = await invite(OP, { email, role: 'STRUCTURE_ADMIN', structure: `${PILOT}-slug` });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.structure).toEqual({ id: PILOT, nom: `Release A ${PILOT}` });
    expect(r.body.mailStatus).toBe('TEST_RECORDED');
    const inv = (await db.execute(sql`SELECT id, role, "structureId" FROM "Invitation" WHERE email = ${email}`)).rows;
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ role: 'STRUCTURE_ADMIN', structureId: PILOT });
    const a = (await db.execute(sql`SELECT actor_id, details FROM "AuditLog" WHERE action = 'INVITATION_SENT' AND details->>'invitationId' = ${inv[0].id}`)).rows;
    expect(a).toHaveLength(1);
    expect(a[0].actor_id).toBe(OP.id);
    expect(a[0].details).toMatchObject({ role: 'STRUCTURE_ADMIN', invitationId: inv[0].id, platform: true, actorStructureId: PLATFORM });
    expect(JSON.stringify(a[0].details)).not.toContain(email);
    // a second invitation of the same address while it is not a member is allowed (resend semantics are the ordinary ones); a member already there is refused
    const red = await redeem(tokenFromMail(email));
    expect(red.statusCode, JSON.stringify(red.body)).toBe(201);
    expect(red.body.user).toMatchObject({ email, role: 'STRUCTURE_ADMIN', structureId: PILOT });
    expect(red.body.mfaEnrolment?.token, 'the second factor is enrolled through this invitation').toBeTruthy();
    expect((await db.execute(sql`SELECT role, status, mfa_enabled FROM "ProUser" WHERE email = ${email}`)).rows[0]).toMatchObject({ role: 'STRUCTURE_ADMIN', mfa_enabled: false });
    const again = await invite(OP, { email, role: 'STRUCTURE_ADMIN', structure: PILOT });
    expect(again.statusCode, 'already a member of the structure').toBe(400);
  });

  it('the invitation stops working when the SUPERADMIN who sent it loses the role before it is used', async () => {
    const email = `rela-orphan-${TS}@example.test`;
    expect((await invite(OP2, { email, role: 'STRUCTURE_ADMIN', structure: PILOT })).statusCode).toBe(201);
    const token = tokenFromMail(email);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${OP2.id}`);
    const r = await redeem(token);
    expect(r.statusCode).toBe(410); expect(r.body.code).toBe('INVITATION_SENDER_REVOKED');
    expect(await n(sql`SELECT count(*)::int n FROM "ProUser" WHERE email = ${email}`)).toBe(0);
    // and that account can no longer send one (its token is still signed)
    const after = await invite(OP2, { email: `rela-after-${TS}@example.test`, role: 'STRUCTURE_ADMIN', structure: PILOT });
    expect([401, 403]).toContain(after.statusCode);
  });

  it('the ordinary own-structure invitation is unchanged (a structure administrator invites a member of their own structure without « structure »)', async () => {
    const email = `rela-member-${TS}@example.test`;
    const r = await invite(SA, { email, role: 'PRO' });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.structure).toBeUndefined();
    expect((await db.execute(sql`SELECT "structureId" FROM "Invitation" WHERE email = ${email}`)).rows[0].structureId).toBe(OTHER);
    const a = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'INVITATION_SENT' AND actor_id = ${SA.id}`)).rows[0];
    expect(a.details.platform).toBeUndefined();
  });
});
