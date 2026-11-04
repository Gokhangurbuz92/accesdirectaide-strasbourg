/**
 * R43 (E3) on REAL PostgreSQL — scripts/pro-superadmin-bootstrap.mjs run as the owner would run it (a child process with only DATABASE_URL, APP_BASE_URL and
 * the confirmation flags): the first platform SUPERADMIN is created without a factor, its MFA enrolment invitation goes through the existing mechanism
 * (hashed, single use, 72 h, bound to structure + e-mail + role) and is redeemable ONLY by that account; nothing secret is printed; one AuditLog line;
 * every refusal (wrong host or database, an existing SUPERADMIN, a second run, a resend after enrolment) writes nothing.
 * Isolation: other suites create SUPERADMIN rows in the shared integration database at the same time, so this suite works in its OWN schema (copies of
 * Structure / ProUser / Invitation / AuditLog made with LIKE … INCLUDING ALL from the database under test — same columns, at 0042 as at the latest
 * migration) selected through the connection's search_path, and drops it at the end. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const SCHEMA = `r43boot_${TS}`;
const EMAIL = `r43-superadmin-${TS}@example.test`;
const NAME = `Titulaire Exploitation ${TS}`;
/** synthetic password built at run time (never a literal a secret scanner reads as a credential) */
const PASSWORD = ['Synthetique', 'R43', `Boot${TS.slice(0, 4)}9`].join('-');
const TABLES = ['Structure', 'ProUser', 'Invitation', 'AuditLog'];

describe.skipIf(!hasDatabase)('R43 first platform SUPERADMIN bootstrap (real DB, isolated schema)', () => {
  let pg, admin, scoped, scopedUrl, host, dbName, tmp, mod, enrolment, drizzle;
  const runCli = (args, input = '') => spawnSync(process.execPath, ['scripts/pro-superadmin-bootstrap.mjs', ...args], {
    input, encoding: 'utf8', timeout: 60000,
    // TZ=Europe/Paris: the owner's machine is not in UTC — the stored expiry must not move with it (timestamp without time zone, read as UTC)
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'Europe/Paris', DATABASE_URL: scopedUrl, APP_BASE_URL: 'http://localhost:5185' },
  });
  const confirm = () => ['--confirm-host', host, '--confirm-database', dbName];
  const rows = async (q, p = []) => (await scoped.query(q, p)).rows;
  const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await rows(`SELECT count(*)::int AS n FROM "${t}"`))[0].n])));

  beforeAll(async () => {
    pg = (await import('pg')).default;
    mod = await import('../../scripts/pro-superadmin-bootstrap.mjs');
    enrolment = await import('../../api/_utils/pro-mfa-enrolment.js');
    ({ drizzle } = await import('drizzle-orm/node-postgres'));
    const u = new URL(process.env.DATABASE_URL);
    host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); dbName = decodeURIComponent(u.pathname.slice(1));
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    for (const t of TABLES) await admin.query(`CREATE TABLE "${SCHEMA}"."${t}" (LIKE public."${t}" INCLUDING ALL)`);
    u.searchParams.set('options', `-c search_path=${SCHEMA}`);
    scopedUrl = u.toString();
    scoped = new pg.Client({ connectionString: scopedUrl }); await scoped.connect();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r43-boot-'));
  }, 60000);
  afterAll(async () => {
    await scoped?.end().catch(() => {});
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).catch(() => {}); await admin.end().catch(() => {}); }
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the isolated schema is the one the script will write to (no row of the shared tables is visible)', async () => {
    expect(await counts()).toEqual({ Structure: 0, ProUser: 0, Invitation: 0, AuditLog: 0 });
  });

  it('refuses a host or a database name that does not match DATABASE_URL, and a non-LAB name without --confirm-non-lab — before connecting', async () => {
    for (const args of [['--confirm-host', 'db.example.test', '--confirm-database', dbName], ['--confirm-host', host, '--confirm-database', 'neondb'], []]) {
      const r = runCli([...args, '--email', EMAIL, '--name', NAME, '--attest-one-account', '--link-file', path.join(tmp, `x-${args.length}`)], `${PASSWORD}\n${PASSWORD}\n`);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/ne correspond pas|--confirm-host/);
    }
    // a local database whose name is not a LAB/test name needs the explicit flag (pure decision: the integration database is LAB-named)
    expect(mod.planTarget({ url: 'postgresql://u@127.0.0.1:5432/accesdirectaide', confirmHost: '127.0.0.1', confirmDatabase: 'accesdirectaide' })).toMatchObject({ ok: false, reason: expect.stringContaining('--confirm-non-lab') });
    expect(await counts()).toEqual({ Structure: 0, ProUser: 0, Invitation: 0, AuditLog: 0 });
  });

  it('refuses when no delivery channel exists (noop mailer, no link file): nothing is created', async () => {
    const r = runCli([...confirm(), '--email', EMAIL, '--name', NAME, '--attest-one-account'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('fournisseur');
    expect(await counts()).toEqual({ Structure: 0, ProUser: 0, Invitation: 0, AuditLog: 0 });
  });

  let token = '';
  it('creates the first SUPERADMIN without a factor, its hashed 72 h invitation and ONE audit line; prints no secret', async () => {
    const linkFile = path.join(tmp, 'invitation-link.txt');
    const before = Date.now();
    const r = runCli([...confirm(), '--email', EMAIL.toUpperCase(), '--name', NAME, '--attest-one-account', '--link-file', linkFile], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const link = fs.readFileSync(linkFile, 'utf8').trim();
    expect(fs.statSync(linkFile).mode & 0o777).toBe(0o600);
    token = decodeURIComponent(new URL(link).hash.replace(/^#invitation=/, ''));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(link).pathname).toBe('/pro/mfa-settings');
    for (const secret of [PASSWORD, token, link, scopedUrl, process.env.DATABASE_URL]) expect(r.stdout + r.stderr).not.toContain(secret);

    const [u] = await rows(`SELECT id, email, role, status, mfa_enabled, mfa_secret, password_hash, "structureId" FROM "ProUser"`);
    expect(u).toMatchObject({ email: EMAIL, role: 'SUPERADMIN', status: 'active', mfa_enabled: false, mfa_secret: null });
    expect(u.password_hash).toMatch(/^scrypt:/);
    const [s] = await rows(`SELECT slug, statut, verification_status, is_pro_enabled, data_origin FROM "Structure" WHERE id = $1`, [u.structureId]);
    expect(s).toMatchObject({ slug: mod.PLATFORM_STRUCTURE.slug, statut: 'brouillon', verification_status: 'UNVERIFIED', is_pro_enabled: false });   // never public, never bookable
    const [inv] = await rows(`SELECT id, email, role, token, expires_at, used_at, "structureId" FROM "Invitation"`);
    expect(inv).toMatchObject({ email: EMAIL, role: 'SUPERADMIN', used_at: null, structureId: u.structureId });
    expect(inv.token).toBe(`sha256:${crypto.createHash('sha256').update(token).digest('hex')}`);   // only the hash is stored
    const ttl = new Date(inv.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(enrolment.MFA_INVITATION_TTL_MS - 120000);
    expect(ttl).toBeLessThanOrEqual(enrolment.MFA_INVITATION_TTL_MS + 1000);
    expect(mod.INVITATION_TTL_MS).toBe(enrolment.MFA_INVITATION_TTL_MS);
    const audits = await rows(`SELECT action, actor, actor_id, entity, entity_id, details FROM "AuditLog"`);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'PRO_SUPERADMIN_BOOTSTRAP', actor: mod.AUDIT_ACTOR, entity: 'ProUser', entity_id: u.id });
    expect(audits[0].details).toMatchObject({ role: 'SUPERADMIN', target: EMAIL, holder: NAME, invitationId: inv.id, delivery: 'link-file', databaseHost: host, databaseName: dbName });
    for (const secret of [PASSWORD, token, u.password_hash, link]) expect(JSON.stringify(audits[0].details)).not.toContain(secret);
  });

  it('the invitation is redeemable only by that account (same mechanism as the application), once, and yields a valid enrolment grant', async () => {
    const dbh = drizzle(scoped);
    const [u] = await rows(`SELECT id, email, role, "structureId", "sessionsValidAfter", mfa_enabled FROM "ProUser"`);
    // another account (other role, same structure) is refused and does not consume it
    expect(await enrolment.redeemMfaInvitation(dbh, { ...u, id: 'someone-else', role: 'PRO' }, token)).toMatchObject({ ok: false, reason: 'OTHER_ROLE' });
    expect(await enrolment.redeemMfaInvitation(dbh, { ...u, email: `other-${EMAIL}` }, token)).toMatchObject({ ok: false, reason: 'OTHER_IDENTITY' });
    const out = await enrolment.redeemMfaInvitation(dbh, u, token);
    expect(out).toMatchObject({ ok: true });
    expect(await enrolment.redeemMfaInvitation(dbh, u, token)).toMatchObject({ ok: false, reason: 'USED' });
    const grant = enrolment.signMfaEnrolmentGrant({ userId: u.id, structureId: u.structureId, invitationId: out.invitationId });
    expect(await enrolment.checkMfaEnrolmentGrant(dbh, u, grant)).toEqual({ ok: true, invitationId: out.invitationId });
  });

  it('is one-time: a second run is refused once a SUPERADMIN exists, and writes nothing', async () => {
    const before = await counts();
    const r = runCli([...confirm(), '--email', `second-${EMAIL}`, '--name', `Autre Personne ${TS}`, '--attest-one-account', '--link-file', path.join(tmp, 'second.txt')], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SUPERADMIN existe déjà');
    expect(await counts()).toEqual(before);
    expect(fs.existsSync(path.join(tmp, 'second.txt'))).toBe(false);
  });

  it('resend-invitation replaces the pending link while no factor is enrolled, is journalised, and is refused after enrolment', async () => {
    await scoped.query(`UPDATE "Invitation" SET used_at = NULL`);   // as if the first e-mail had been lost before use
    const r = runCli(['resend-invitation', ...confirm(), '--link-file', path.join(tmp, 'resent.txt')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const fresh = decodeURIComponent(new URL(fs.readFileSync(path.join(tmp, 'resent.txt'), 'utf8').trim()).hash.replace(/^#invitation=/, ''));
    expect(r.stdout).not.toContain(fresh);
    const invs = await rows(`SELECT token FROM "Invitation" WHERE used_at IS NULL`);
    expect(invs).toHaveLength(1);
    expect(invs[0].token).toBe(`sha256:${crypto.createHash('sha256').update(fresh).digest('hex')}`);   // the old link no longer works
    expect((await rows(`SELECT 1 FROM "AuditLog" WHERE action = 'PRO_SUPERADMIN_BOOTSTRAP_INVITATION_RESENT'`))).toHaveLength(1);
    await scoped.query(`UPDATE "ProUser" SET mfa_enabled = true`);
    const before = await counts();
    const again = runCli(['resend-invitation', ...confirm(), '--link-file', path.join(tmp, 'again.txt')]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('déjà active');
    expect(await counts()).toEqual(before);
  });
});
