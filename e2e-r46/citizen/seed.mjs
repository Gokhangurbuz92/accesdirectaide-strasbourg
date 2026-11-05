#!/usr/bin/env node
/**
 * R46 citizen — seeds a LOCAL disposable LAB database for e2e-r46/citizen (synthetic data only): one adult citizen with a verified address, a sourced Mon Parcours
 * deadline in 3 days and a minor's guardian-link request waiting for them (two in-app notifications). Writes the generated credentials to --out (outside the
 * repository; never printed).   node --import tsx e2e-r46/citizen/seed.mjs --out <file>
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../api/_utils/user-auth.js';

const out = process.argv[process.argv.indexOf('--out') + 1];
const u = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) { console.error('refusing: local *_test database only'); process.exit(3); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const ts = Date.now().toString(36);
const citizen = { id: `r46e-a-${ts}`, email: `r46e-a-${ts}@example.test`, password: `Lab-${crypto.randomBytes(9).toString('base64url')}-9a` };
const minor = { id: `r46e-m-${ts}`, email: `r46e-m-${ts}@example.test` };
await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW()), ($4, $5, 'unset:x', NOW(), NOW())`,
  [citizen.id, citizen.email, await hashPassword(citizen.password), minor.id, minor.email]);
await c.query(`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES ($1, '25-59', 'Personne synthétique', NOW()), ($2, 'moins-de-18', 'Mineur synthétique', NOW())`, [citizen.id, minor.id]);
await c.query(`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, status, "dueDate", "dueSourceUrl", "updatedAt") VALUES ($1, $2, 'MANUAL', 'custom', 'Étape synthétique', 'IN_PROGRESS', NOW() + interval '3 days', 'https://www.service-public.fr/particuliers/vosdroits/F0', NOW())`, [`r46e-p-${ts}`, citizen.id]);
await c.query(`INSERT INTO "GuardianRelationship" (id, "minorId", "guardianId", status, scopes, "updatedAt") VALUES ($1, $2, $3, 'DECLARED', '[]'::jsonb, NOW())`, [`r46e-g-${ts}`, minor.id, citizen.id]);
await c.end();
fs.writeFileSync(out, JSON.stringify({ citizen }), { mode: 0o600 });
console.log('seeded');
