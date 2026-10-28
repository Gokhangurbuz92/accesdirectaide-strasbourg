/**
 * R20 (Strasbourg V1 closure, 2026-10-28) — REAL PostgreSQL, real handlers, real pro JWTs, in-memory 'test' mailer (nothing leaves the machine): a team invitation
 * is the act of the administrator who sent it. Their departure, suspension or demotion stops THEIR pending invitations from being redeemed (the link page says so,
 * no account is created, the refusal is journalised) while the other administrators' invitations keep working; a current administrator's « Relancer » makes it
 * theirs again; the team page flags it; a demoted administrator can no longer invite; another organization can neither cancel nor resend it.
 * An invitation with no recorded sender (written before R20) keeps working until it expires: pkg4-invitations-db. Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ST = `r20i-st-${TS}`, OTHER = `r20i-ot-${TS}`;
const U = (n, sid, role) => ({ id: `r20i-${n}-${TS}`, email: `r20i-${n}-${TS}@example.test`, sid, role });
const A = U('a', ST, 'STRUCTURE_ADMIN'), B = U('b', ST, 'STRUCTURE_ADMIN'), C = U('c', ST, 'STRUCTURE_ADMIN'), X = U('x', OTHER, 'STRUCTURE_ADMIN');
const PASSWORD = 'Synthetique-QA-2026!x';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('R20 invitations follow their sender (real DB)', () => {
  let db, auth, mailer, H;
  const hdr = (u) => ({ host: 'localhost', authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const call = async (h, req) => { const r = mk(); await h({ query: {}, socket: {}, ...req }, r); return r; };
  const invite = (u, email) => call(H.invite, { method: 'POST', url: '/api/pro/invite', body: { email, role: 'PRO' }, headers: hdr(u) });
  const check = (token) => call(H.register, { method: 'GET', url: `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`, headers: { host: 'localhost' } });
  const redeem = (token) => call(H.register, { method: 'POST', url: '/api/pro/auth/register-invite', body: { token, password: PASSWORD }, headers: { host: 'localhost' } });
  const tokenFromMail = (to) => { const m = mailer.__getTestOutbox().filter((x) => x.to === to).pop(); expect(m, 'invitation e-mail handed to the mailer').toBeTruthy(); return new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); };
  const invId = async (email) => (await db.execute(sql`SELECT id FROM "Invitation" WHERE email = ${email}`)).rows[0].id;
  const accounts = async (email) => (await db.execute(sql`SELECT count(*)::int n FROM "ProUser" WHERE email = ${email}`)).rows[0].n;

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    H = {
      invite: (await import('../../api/_handlers/pro/invite.js')).default, register: (await import('../../api/_handlers/pro/auth/register-invite.js')).default,
      team: (await import('../../api/_handlers/pro/team.js')).default, resend: (await import('../../api/_handlers/pro/resend-invite.js')).default,
    };
    for (const sid of [ST, OTHER]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${sid}, ${'R20 ' + sid}, ${sid}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const u of [A, B, C, X]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', ${u.role}, 'active', ${u.sid}, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${ST}, ${OTHER})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Notification" WHERE "userId" IN (SELECT id FROM "ProUser" WHERE "structureId" IN (${ST}, ${OTHER}))`).catch(() => {});
    await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${ST}, ${OTHER})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${ST}, ${OTHER})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${ST}, ${OTHER})`);
  });

  it('a departed administrator\'s invitation stops working; a colleague\'s keeps working; the team page flags it; « Relancer » revives it in the new sender\'s name', async () => {
    const ea = `r20i-by-a-${TS}@example.test`, eb = `r20i-by-b-${TS}@example.test`;
    expect((await invite(A, ea)).statusCode).toBe(201); expect((await invite(B, eb)).statusCode).toBe(201);
    const ta = tokenFromMail(ea), tb = tokenFromMail(eb);
    expect((await check(ta)).statusCode, 'valid while A is an administrator').toBe(200);
    const gone = await call(H.team, { method: 'DELETE', url: `/api/pro/team?userId=${A.id}`, headers: hdr(B) });
    expect(gone.statusCode, JSON.stringify(gone.body)).toBe(200);
    const page = await check(ta);
    expect(page.statusCode).toBe(410); expect(page.body.code).toBe('INVITATION_SENDER_REVOKED'); expect(page.body.error).toMatch(/n’est plus administratrice/);
    const refused = await redeem(ta);
    expect(refused.statusCode).toBe(410); expect(await accounts(ea), 'no account on the word of a departed administrator').toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'INVITATION_REFUSED_SENDER_REVOKED' AND details->>'invitationId' = ${await invId(ea)}`)).rows[0].n).toBe(1);
    const ok = await redeem(tb); expect(ok.statusCode, 'another administrator\'s invitation is untouched').toBe(201); expect(ok.body.user).toMatchObject({ email: eb, role: 'PRO', structureId: ST });
    const team = await call(H.team, { method: 'GET', url: '/api/pro/team', headers: hdr(B) });
    expect(team.statusCode).toBe(200);
    expect(team.body.invitations.find((i) => i.email === ea)).toMatchObject({ senderRevoked: true });
    const again = await call(H.resend, { method: 'POST', url: '/api/pro/resend-invite', body: { invitationId: await invId(ea) }, headers: hdr(B) });
    expect(again.statusCode).toBe(200);
    expect((await call(H.team, { method: 'GET', url: '/api/pro/team', headers: hdr(B) })).body.invitations.find((i) => i.email === ea)).toMatchObject({ senderRevoked: false });
    const revived = await redeem(tokenFromMail(ea)); expect(revived.statusCode, JSON.stringify(revived.body)).toBe(201);
  });

  it('a demoted administrator\'s invitation stops working and they can no longer invite; another organization can neither cancel nor resend it', async () => {
    const ec = `r20i-by-c-${TS}@example.test`;
    expect((await invite(C, ec)).statusCode).toBe(201); const tc = tokenFromMail(ec); const id = await invId(ec);
    expect((await call(H.invite, { method: 'DELETE', url: `/api/pro/invite?id=${id}`, headers: hdr(X) })).statusCode, 'another organization').toBe(404);
    expect((await call(H.resend, { method: 'POST', url: '/api/pro/resend-invite', body: { invitationId: id }, headers: hdr(X) })).statusCode).toBe(404);
    const demoted = await call(H.team, { method: 'PATCH', url: '/api/pro/team', body: { targetUserId: C.id, role: 'PRO' }, headers: hdr(B) });
    expect(demoted.statusCode, JSON.stringify(demoted.body)).toBe(200);
    expect((await invite(C, `r20i-late-${TS}@example.test`)).statusCode, 'the database role wins over the token').toBe(403);
    expect((await redeem(tc)).statusCode).toBe(410); expect(await accounts(ec)).toBe(0);
    expect((await db.execute(sql`SELECT used_at FROM "Invitation" WHERE id = ${id}`)).rows[0].used_at, 'the refused invitation is not consumed').toBeNull();
  });
});
