/**
 * PKG-5 — the owner's local LAB review (synthetic database):
 *   - runWs2ReviewSeed loads the 49 launch records as NON-PUBLIC drafts, writes no verification, is idempotent and never overwrites an existing record (a recorded decision stays)
 *   - scripts/lab-local.mjs admin-create creates a NAMED administrator without MFA (MFA is enrolled at the first sign-in), refuses short passwords and duplicates,
 *     never prints the password, and writes an audit row
 *   - the WS2 queue then shows every record with a preparation (group, next step, checklist, source) and the record's current content, all records still unverified
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const EMAIL = `lab-cli-${TS}@example.test`;

describe.skipIf(!hasDatabase)('PKG-5 local LAB review (real DB)', () => {
  let db, seed, ws2, dir;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); seed = await import('../../scripts/seed-strasbourg.mjs'); ws2 = await import('../../api/_services/ws2-review.js');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-cli-'));
    fs.writeFileSync(path.join(dir, 'lab.env'), `DATABASE_URL=${process.env.DATABASE_URL}\nLAB_PORT=3000\n`, { mode: 0o600 });
  }, 60000);
  afterAll(async () => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (db) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${EMAIL}`).catch(() => {});
  });

  it('review seed: drafts only, no verification, idempotent, existing records untouched', async () => {
    const first = await seed.runWs2ReviewSeed({ databaseUrl: process.env.DATABASE_URL });
    expect(first.ok).toBe(true); expect(first.counts.inserted + first.counts.keptExisting).toBe(49);
    const q = ws2.readQueue();
    const slugs = q.records.map((r) => r.slug);
    const inList = sql.join(slugs.map((x) => sql`${x}`), sql`, `);
    const rows = (await db.execute(sql`SELECT slug, statut, verification_status AS v, launch_eligible AS le FROM "Aide" WHERE slug IN (${inList})
      UNION ALL SELECT slug, statut, verification_status, launch_eligible FROM "Demarche" WHERE slug IN (${inList})
      UNION ALL SELECT slug, statut, verification_status, launch_eligible FROM "Structure" WHERE slug IN (${inList})`)).rows;
    const mine = rows;
    expect(mine.length).toBeGreaterThanOrEqual(49);
    for (const r of mine.filter((x) => x.v !== 'VERIFIED')) { expect(r.statut).not.toBe('publie'); expect(r.le).not.toBe(true); }
    const aide = q.records.find((r) => r.dataset === 'aides').slug;
    await db.execute(sql`UPDATE "Aide" SET titre = 'Titre corrigé par une personne' WHERE slug = ${aide}`);
    const again = await seed.runWs2ReviewSeed({ databaseUrl: process.env.DATABASE_URL });
    expect(again.counts.inserted).toBe(0); expect(again.counts.keptExisting).toBe(49);
    expect((await db.execute(sql`SELECT titre FROM "Aide" WHERE slug = ${aide}`)).rows[0].titre).toBe('Titre corrigé par une personne');
    await expect(seed.runWs2ReviewSeed({ databaseUrl: 'postgresql://x@db.example.com:5432/x' })).rejects.toThrow(/WS2_REMOTE_DATABASE_FORBIDDEN/);
  }, 120000);

  it('admin-create: named account without MFA yet, password never printed, refusals, audited', async () => {
    // owner LAB audit: a named account (holder) and the « one person, one account » attestation
    const run = (input, extra = []) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab-local.mjs', 'admin-create', '--env', path.join(dir, 'lab.env'), '--email', EMAIL, '--name', `Personne Test ${TS}`, '--attest-one-account', ...extra],
      { input, encoding: 'utf8', env: { ...process.env } });
    const pw = crypto.randomBytes(12).toString('hex');
    const short = run('short\nshort\n', ['--role', 'admin']); expect(short.status).toBe(1); expect(short.stderr).toMatch(/trop court/);
    const ok = run(`${pw}\n${pw}\n`, ['--role', 'superadmin']);
    expect(ok.status, ok.stderr).toBe(0); expect(ok.stdout + ok.stderr).not.toContain(pw);
    const [a] = (await db.execute(sql`SELECT role, "mfaEnabled", password, "displayName" FROM "AdminUser" WHERE email = ${EMAIL}`)).rows;
    expect(a.role).toBe('superadmin'); expect(a.mfaEnabled).toBe(false); expect(a.password).not.toContain(pw); expect(a.displayName).toBe(`Personne Test ${TS}`);
    const dup = run(`${pw}\n${pw}\n`, ['--role', 'admin']); expect(dup.status).toBe(1); expect(dup.stderr).toMatch(/existe déjà/);
    // owner LAB audit: one person, one account — the same holder under another address is refused, and so is a creation without the attestation
    const other = (input, extra) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab-local.mjs', 'admin-create', '--env', path.join(dir, 'lab.env'), '--email', `other-${EMAIL}`, '--role', 'admin', ...extra],
      { input, encoding: 'utf8', env: { ...process.env } });
    const sameHolder = other(`${pw}\n${pw}\n`, ['--name', `personne test ${TS}`, '--attest-one-account']); expect(sameHolder.status).toBe(1); expect(sameHolder.stderr).toMatch(/déjà un compte administrateur/);
    const noAttest = other(`non\n${pw}\n${pw}\n`, ['--name', `Autre Personne ${TS}`]); expect(noAttest.status).toBe(1); expect(noAttest.stderr).toMatch(/une personne qui a déjà un compte/);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AdminUser" WHERE email = ${'other-' + EMAIL}`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ADMIN_ACCOUNT_CREATED_LOCAL'`)).rows[0].n).toBeGreaterThan(0);
    await db.execute(sql`UPDATE "AdminUser" SET "mfaEnabled" = true, "mfaSecret" = 'x', "mfaIv" = 'y' WHERE email = ${EMAIL}`);
    const reset = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab-local.mjs', 'admin-reset-mfa', '--env', path.join(dir, 'lab.env'), '--email', EMAIL], { encoding: 'utf8', env: { ...process.env } });
    expect(reset.status, reset.stderr).toBe(0);
    expect((await db.execute(sql`SELECT "mfaEnabled", "mfaSecret", "sessionsValidAfter" IS NOT NULL AS ended FROM "AdminUser" WHERE email = ${EMAIL}`)).rows[0]).toEqual({ mfaEnabled: false, mfaSecret: null, ended: true });
    // owner LAB audit: local password recovery — a new password typed on this machine (never printed), every session ended, the lockout lifted, MFA untouched, audited
    await db.execute(sql`UPDATE "AdminUser" SET "mfaEnabled" = true, "mfaSecret" = 'x', "mfaIv" = 'y', "failedLoginAttempts" = 5, "lockoutUntil" = NOW() + interval '10 minutes', "sessionsValidAfter" = NULL WHERE email = ${EMAIL}`);
    const before = (await db.execute(sql`SELECT password FROM "AdminUser" WHERE email = ${EMAIL}`)).rows[0].password;
    const npw = crypto.randomBytes(12).toString('hex');
    const rp = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab-local.mjs', 'admin-reset-password', '--env', path.join(dir, 'lab.env'), '--email', EMAIL], { input: `${npw}\n${npw}\n`, encoding: 'utf8', env: { ...process.env } });
    expect(rp.status, rp.stderr).toBe(0); expect(rp.stdout + rp.stderr).not.toContain(npw);
    const after = (await db.execute(sql`SELECT password, "mfaEnabled", "failedLoginAttempts" AS f, "lockoutUntil" IS NULL AS unlocked, "sessionsValidAfter" IS NOT NULL AS ended FROM "AdminUser" WHERE email = ${EMAIL}`)).rows[0];
    expect(after.password).not.toBe(before); expect(after.password).not.toContain(npw);
    expect([after.mfaEnabled, after.f, after.unlocked, after.ended]).toEqual([true, 0, true, true]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ADMIN_PASSWORD_RESET_LOCAL' AND details->>'target' = ${EMAIL}`)).rows[0].n).toBe(1);
  }, 120000);

  it('the WS2 queue shows each record with a preparation and its current content; nothing is verified by the seed', async () => {
    const q = await ws2.ws2Queue();
    expect(q.totals.records).toBe(49); expect(q.totals.notInDatabase).toBe(0);
    for (const r of q.records) {
      expect(['A_PRET', 'B_A_RECHERCHER', 'C_A_TRANCHER', 'D_IDENTITE', 'E_BLOQUANT']).toContain(r.preparation.group);
      expect(r.preparation.isResearchOnly).toBe(true); expect(r.current.length).toBeGreaterThan(0);
    }
    expect(q.records.filter((r) => r.preparation.sourceUrl).length).toBeGreaterThanOrEqual(30);
    expect(q.records.filter((r) => r.preparation.group === 'A_PRET').every((r) => r.preparation.sourceUrl)).toBe(true);
    expect(q.records.some((r) => r.state === 'HUMAN_VERIFIED')).toBe(false);
  }, 60000);
});
