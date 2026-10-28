/**
 * Launch-readiness item 44 on REAL PostgreSQL — scripts/admin-bootstrap.mjs run as the owner would run it (only DATABASE_URL in its environment):
 * a named account with an scrypt hash and MFA still to enrol, one AuditLog line ADMIN_ACCOUNT_BOOTSTRAP without the password, nothing printed that is secret,
 * and the refusals (wrong host, an administrator already present, a second account for the same person) write nothing.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const EMAIL = `bootstrap-${TS}@example.test`;
const NAME = `Titulaire Amorçage ${TS}`;
const PASSWORD = `Planted-Password-${TS}`;

const runCli = (args, input) => spawnSync(process.execPath, ['scripts/admin-bootstrap.mjs', ...args], {
  input, encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: process.env.DATABASE_URL },
});

describe.skipIf(!hasDatabase)('admin bootstrap (real DB)', () => {
  let db, host, adminLogin;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ adminLogin } = await import('../../api/_services/admin-identity.js'));
    host = new URL(process.env.DATABASE_URL).hostname;
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'ADMIN_ACCOUNT_BOOTSTRAP' AND details->>'target' LIKE ${`%-${TS}@example.test`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor LIKE ${`%-${TS}@example.test`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email LIKE ${`%-${TS}@example.test`}`).catch(() => {});
  });
  const count = async () => (await db.execute(sql`SELECT count(*)::int AS n FROM "AdminUser"`)).rows[0].n;

  it('refuses a host that does not match DATABASE_URL, before asking anything', async () => {
    const before = await count();
    const r = runCli(['--confirm-host', 'wrong.example.test', '--additional'], '');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ne correspond pas');
    expect(await count()).toBe(before);
  });

  it('creates a named account (scrypt hash, MFA to enrol at first sign-in) and journalises it without any secret', async () => {
    // the integration database may already hold administrators from other suites: this run is a further named account, journalised as such
    const r = runCli(['--confirm-host', host, '--additional', '--email', EMAIL, '--name', NAME, '--role', 'admin', '--attest-one-account'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    for (const secret of [PASSWORD, process.env.DATABASE_URL]) expect(out).not.toContain(secret);
    expect(out).toContain('MFA obligatoire');
    const [row] = (await db.execute(sql`SELECT password, role, "mfaEnabled", "displayName" FROM "AdminUser" WHERE email = ${EMAIL}`)).rows;
    expect(row).toMatchObject({ role: 'admin', mfaEnabled: false, displayName: NAME });
    expect(row.password).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    const audits = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'ADMIN_ACCOUNT_BOOTSTRAP' AND details->>'target' = ${EMAIL}`)).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toMatchObject({ role: 'admin', holder: NAME, attestedOnePersonOneAccount: true, databaseHost: host });
    expect(JSON.stringify(audits[0].details)).not.toContain(PASSWORD);
    // the first sign-in asks for MFA enrolment: the account is never usable without it
    const login = await adminLogin({ email: EMAIL, password: PASSWORD }, { db });
    expect(login).toMatchObject({ ok: true, mfa_required: false, mfa_setup_required: true });
  });

  it('is not a way to add accounts silently: without --additional it refuses once an administrator exists', async () => {
    const before = await count();
    expect(before).toBeGreaterThan(0);
    const r = runCli(['--confirm-host', host, '--email', `second-${TS}@example.test`, '--name', `Autre Personne ${TS}`, '--role', 'admin', '--attest-one-account'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--additional');
    expect(await count()).toBe(before);
  });

  it('one person, one account: the same holder cannot receive a second account', async () => {
    const before = await count();
    const r = runCli(['--confirm-host', host, '--additional', '--email', `again-${TS}@example.test`, '--name', NAME, '--role', 'admin', '--attest-one-account'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('une personne = un compte');
    expect(await count()).toBe(before);
  });

  it('a short or mistyped password creates nothing', async () => {
    const before = await count();
    expect(runCli(['--confirm-host', host, '--additional', '--email', `short-${TS}@example.test`, '--name', `Mot Court ${TS}`, '--role', 'admin', '--attest-one-account'], 'court\ncourt\n').status).toBe(1);
    expect(runCli(['--confirm-host', host, '--additional', '--email', `typo-${TS}@example.test`, '--name', `Mot Faux ${TS}`, '--role', 'admin', '--attest-one-account'], `${PASSWORD}\n${PASSWORD}x\n`).status).toBe(1);
    expect(await count()).toBe(before);
  });
});
