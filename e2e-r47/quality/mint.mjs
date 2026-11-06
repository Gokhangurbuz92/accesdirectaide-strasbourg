#!/usr/bin/env node
/**
 * R47 quality — signs the LAB sessions the crawl uses, one per role, with THIS run's secrets (the server verifies them exactly as in production):
 * platform administrator (MFA passed), structure administrator and professional of the fictional pilot (MFA passed), verified citizen, institution.
 * Writes them to --out (mode 0600, outside the repository); never prints them. Refuses anything but a local *_test database.
 *   node --import tsx e2e-r47/quality/mint.mjs --out <file>
 */
import fs from 'node:fs';
import pg from 'pg';

const out = process.argv[process.argv.indexOf('--out') + 1];
const u = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) { console.error('refusing: local *_test database only'); process.exit(3); }
const { signAdminSessionToken, signProToken } = await import('../../api/_utils/auth.js');
const { signUserSessionToken } = await import('../../api/_utils/user-auth.js');
const { signInstitutionToken } = await import('../../api/_utils/institution-auth.js');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const pro = async (/** @type {string} */ id) => { const r = (await c.query(`SELECT id, email, role, "structureId" FROM "ProUser" WHERE id = $1`, [id])).rows[0]; return signProToken(r, { mfa: true }); };
const cit = (await c.query(`SELECT id, email FROM "CitizenUser" WHERE id = 'lab-cdgg-cit-client'`)).rows[0];
const inst = (await c.query(`SELECT id, email, "passwordHash" FROM "InstitutionAccount" WHERE id = 'r47q-inst'`)).rows[0];
const tokens = {
  admin: signAdminSessionToken({ email: 'r47q-admin@example.test', role: 'admin', mfa_verified: true }),
  structureAdmin: await pro('lab-cdgg-admin'),
  pro: await pro('lab-cdgg-p1'),
  citizen: signUserSessionToken({ userId: cit.id, email: cit.email }),
  institution: signInstitutionToken(inst),
  // one member per crawl visit (the per-member read limit of the agenda — 60 a minute — is sized for a person; load-accounts.mjs creates these members)
  structureAdmins: await Promise.all(['lab-cdgg-admin', ...(await c.query(`SELECT id FROM "ProUser" WHERE id LIKE 'r47q-lpro-%' ORDER BY id LIMIT 30`)).rows.map((r) => r.id)].map(pro)),
  pros: await Promise.all(['lab-cdgg-p1', ...(await c.query(`SELECT id FROM "ProUser" WHERE id LIKE 'r47q-lagent-%' ORDER BY id`)).rows.map((r) => r.id)].map(pro)),
};
await c.end();
fs.writeFileSync(out, JSON.stringify(tokens), { mode: 0o600 });
console.log('minted', Object.keys(tokens).join(' '));
