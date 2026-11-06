#!/usr/bin/env node
/**
 * R47 quality — the accounts of the load acceptance (load.mjs), on a LOCAL disposable LAB database after seed.mjs: 300 adult citizens who can sign in with
 * one random password (stored once as a hash; adult statement in ConsentLog, the sign-in rule), and 60 members of the fictional pilot organisation (whose
 * agenda holds 2,000 appointments), each with an own signed professional session (MFA passed), plus 20 administrator sessions — every virtual user of the
 * load is a different person, as in real use. Also 30 professional members (role PRO) for the crawl (mint.mjs signs their sessions). Writes { password, citizens, pro, admin, citizenSessions } to --out (mode 0600; never printed).
 *   node --import tsx e2e-r47/quality/load-accounts.mjs --out <file outside the repository>
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const out = process.argv[process.argv.indexOf('--out') + 1];
const u = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) { console.error('refusing: local *_test database only'); process.exit(3); }
const { hashPassword, signUserSessionToken } = await import('../../api/_utils/user-auth.js');
const { signAdminSessionToken, signProToken } = await import('../../api/_utils/auth.js');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const password = `Lab-${crypto.randomBytes(9).toString('base64url')}-9a`;
const hash = await hashPassword(password);
await c.query('BEGIN');
await c.query(`DELETE FROM "CitizenProfile" WHERE "userId" LIKE 'r47q-login-%'`); await c.query(`DELETE FROM "CitizenUser" WHERE id LIKE 'r47q-login-%'`);
await c.query(`DELETE FROM "ProUser" WHERE id LIKE 'r47q-lpro-%' OR id LIKE 'r47q-lagent-%'`);
await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") SELECT 'r47q-login-' || g, 'test.login+r47q-' || g || '@example.test', $1, NOW(), NOW() FROM generate_series(1, 300) g`, [hash]);
await c.query(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") SELECT id, 'Personne synthétique', '25-59', NOW() FROM "CitizenUser" WHERE id LIKE 'r47q-login-%'`);
await c.query(`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
  SELECT gen_random_uuid()::text, 'CITIZEN_USER', id, 'AGE_DECLARATION_ADULT', true, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'lab_fixture', false, 'SELF_DECLARATION' FROM "CitizenUser" WHERE id LIKE 'r47q-login-%'`);
await c.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") SELECT 'r47q-lpro-' || g, 'test.pro+r47q-' || g || '@example.test', 'synthetic-not-a-hash', 'STRUCTURE_ADMIN', 'active', 'lab-cdgg-conseil', NOW() FROM generate_series(1, 60) g`);
// 30 professionals (not administrators) of the same organisation: the crawl's « pro » visitors (crawl.pw.mjs, one member per visit, like real members)
await c.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") SELECT 'r47q-lagent-' || g, 'test.agent+r47q-' || g || '@example.test', 'synthetic-not-a-hash', 'PRO', 'active', 'lab-cdgg-conseil', NOW() FROM generate_series(1, 30) g`);
await c.query('COMMIT');
const citizens = Array.from({ length: 300 }, (_, i) => `test.login+r47q-${i + 1}@example.test`);
const pro = Array.from({ length: 60 }, (_, i) => signProToken({ id: `r47q-lpro-${i + 1}`, email: `test.pro+r47q-${i + 1}@example.test`, structureId: 'lab-cdgg-conseil', role: 'STRUCTURE_ADMIN' }, { mfa: true }));
const admin = Array.from({ length: 20 }, (_, i) => signAdminSessionToken({ email: `r47q-admin-${i + 1}@example.test`, role: 'admin', mfa_verified: true }));
const citizenSessions = Array.from({ length: 300 }, (_, i) => signUserSessionToken({ userId: `r47q-login-${i + 1}`, email: citizens[i] }));
await c.end();
fs.writeFileSync(out, JSON.stringify({ password, citizens, pro, admin, citizenSessions }), { mode: 0o600 });
console.log('load accounts ready: 300 citizens, 60 professionals, 20 administrators');
