/**
 * Seed test accounts for all user interfaces.
 *
 * Usage:
 *   TEST_ADMIN_PASSWORD=xxx TEST_CITIZEN_PASSWORD=xxx TEST_PRO_PASSWORD=xxx \
 *     node scripts/seed-test-accounts.js
 *
 * If password env vars are not set, random passwords are generated.
 * DATABASE_URL is read from .env.local or passed directly.
 *
 * This script is IDEMPOTENT — safe to run multiple times.
 */
import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────
// Passwords are read from environment variables to avoid GitGuardian alerts.
// If not set, random passwords are generated and printed at the end.
function getOrGeneratePassword(envVar) {
  return process.env[envVar] || `Test${crypto.randomBytes(8).toString('hex')}!`;
}

const TEST_ACCOUNTS = {
  admin: {
    email: 'admin-test@accesdirectaide.fr',
    password: getOrGeneratePassword('TEST_ADMIN_PASSWORD'),
    role: 'admin',
  },
  citizen: {
    email: 'citoyen-test@accesdirectaide.fr',
    password: getOrGeneratePassword('TEST_CITIZEN_PASSWORD'),
    phone: '0600000001',
  },
  pro: {
    email: 'pro-test@accesdirectaide.fr',
    password: getOrGeneratePassword('TEST_PRO_PASSWORD'),
    role: 'PRO',
    status: 'active',
    structureName: 'CCAS de Strasbourg (Test)',
  },
};

// ── Scrypt hashing (matches api/_utils/user-auth.js) ──────────
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set. Add it to .env.local or pass it directly.');
    process.exit(1);
  }

  const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    console.log('\n🔑 Seed Test Accounts\n');
    console.log(`Database: ${isLocal ? 'LOCAL' : 'REMOTE'}`);
    console.log('─'.repeat(50));

    // ── 1. Admin ──
    const adminHash = await hashPassword(TEST_ACCOUNTS.admin.password);
    const adminResult = await pool.query(`
      INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled")
      VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW(), 0, false)
      ON CONFLICT (email) DO UPDATE SET password = $2, "updatedAt" = NOW()
      RETURNING id, email
    `, [TEST_ACCOUNTS.admin.email, adminHash, TEST_ACCOUNTS.admin.role]);
    console.log(`✅ Admin:    ${adminResult.rows[0].email}  (id: ${adminResult.rows[0].id})`);

    // ── 2. Citizen ──
    const citizenHash = await hashPassword(TEST_ACCOUNTS.citizen.password);
    const citizenResult = await pool.query(`
      INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), $1, $2, NOW(), $3, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET "passwordHash" = $2, "emailVerifiedAt" = NOW(), "updatedAt" = NOW()
      RETURNING id, email
    `, [TEST_ACCOUNTS.citizen.email, citizenHash, TEST_ACCOUNTS.citizen.phone]);
    console.log(`✅ Citizen:  ${citizenResult.rows[0].email}  (id: ${citizenResult.rows[0].id})`);

    // ── 3. Structure (required for Pro) ──
    const structureResult = await pool.query(`
      INSERT INTO "Structure" (id, nom, type_structure, "code_postal", ville, telephone,
                               services, publics_accueillis, categories_aidees,
                               "createdAt", "updatedAt", statut, status, is_pro_enabled)
      VALUES (gen_random_uuid(), $1, 'CCAS', '67000', 'Strasbourg', '0388000001',
              ARRAY['Accompagnement social'], ARRAY['Tous publics'], ARRAY['LOGEMENT','EMPLOI'],
              NOW(), NOW(), 'publie', 'actif', true)
      ON CONFLICT ON CONSTRAINT "Structure_pkey" DO NOTHING
      RETURNING id, nom
    `, [TEST_ACCOUNTS.pro.structureName]);

    let structureId;
    if (structureResult.rows.length > 0) {
      structureId = structureResult.rows[0].id;
      console.log(`✅ Structure: ${structureResult.rows[0].nom}  (id: ${structureId})`);
    } else {
      // Structure might already exist, find it
      const existing = await pool.query(
        `SELECT id, nom FROM "Structure" WHERE nom = $1 LIMIT 1`,
        [TEST_ACCOUNTS.pro.structureName]
      );
      if (existing.rows.length > 0) {
        structureId = existing.rows[0].id;
        console.log(`♻️  Structure: ${existing.rows[0].nom} (already exists, id: ${structureId})`);
      } else {
        // Insert without ON CONFLICT on pkey — use a deterministic approach
        const insertStruct = await pool.query(`
          INSERT INTO "Structure" (id, nom, type_structure, "code_postal", ville, telephone,
                                   services, publics_accueillis, categories_aidees,
                                   "createdAt", "updatedAt", statut, status, is_pro_enabled)
          VALUES (gen_random_uuid(), $1, 'CCAS', '67000', 'Strasbourg', '0388000001',
                  ARRAY['Accompagnement social'], ARRAY['Tous publics'], ARRAY['LOGEMENT','EMPLOI'],
                  NOW(), NOW(), 'publie', 'actif', true)
          RETURNING id, nom
        `, [TEST_ACCOUNTS.pro.structureName]);
        structureId = insertStruct.rows[0].id;
        console.log(`✅ Structure: ${insertStruct.rows[0].nom}  (id: ${structureId})`);
      }
    }

    // ── 4. Pro ──
    const proHash = await hashPassword(TEST_ACCOUNTS.pro.password);
    // Search by email ONLY (not email + structureId) to prevent duplicates across structures
    const existingPro = await pool.query(
      `SELECT id, email, "structureId" FROM "ProUser" WHERE email = $1 LIMIT 1`,
      [TEST_ACCOUNTS.pro.email]
    );
    let proResult;
    if (existingPro.rows.length > 0) {
      proResult = await pool.query(
        `UPDATE "ProUser" SET password_hash = $1, status = $2, "updatedAt" = NOW() WHERE id = $3 RETURNING id, email`,
        [proHash, TEST_ACCOUNTS.pro.status, existingPro.rows[0].id]
      );
      console.log(`♻️  Pro:      ${proResult.rows[0].email}  (updated, id: ${proResult.rows[0].id})`);
    } else {
      proResult = await pool.query(`
        INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "createdAt", "updatedAt", mfa_enabled)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW(), false)
        RETURNING id, email
      `, [TEST_ACCOUNTS.pro.email, proHash, TEST_ACCOUNTS.pro.role, TEST_ACCOUNTS.pro.status, structureId]);
      console.log(`✅ Pro:      ${proResult.rows[0].email}  (id: ${proResult.rows[0].id})`);
    }

    // ── Summary ──
    console.log('\n' + '═'.repeat(50));
    console.log('📋 TEST ACCOUNTS READY\n');
    console.log('  ADMIN:');
    console.log(`    Email:    ${TEST_ACCOUNTS.admin.email}`);
    console.log(`    Password: ${TEST_ACCOUNTS.admin.password}`);
    console.log('');
    console.log('  CITIZEN:');
    console.log(`    Email:    ${TEST_ACCOUNTS.citizen.email}`);
    console.log(`    Password: ${TEST_ACCOUNTS.citizen.password}`);
    console.log('');
    console.log('  PRO:');
    console.log(`    Email:    ${TEST_ACCOUNTS.pro.email}`);
    console.log(`    Password: ${TEST_ACCOUNTS.pro.password}`);
    console.log(`    Structure: ${TEST_ACCOUNTS.pro.structureName}`);
    console.log('\n' + '═'.repeat(50));
    console.log('⚠️  Keep these credentials safe. Do NOT commit them.');
    console.log('🧹 Run: node scripts/cleanup-test-accounts.js to remove.\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
