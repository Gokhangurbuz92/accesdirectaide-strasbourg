/**
 * Cleanup all test accounts and associated data.
 *
 * Usage:
 *   node scripts/cleanup-test-accounts.js
 *   DATABASE_URL=postgresql://... node scripts/cleanup-test-accounts.js
 *
 * Removes all accounts with email matching *test@accesdirectaide.fr
 * and the associated test Structure.
 */
import 'dotenv/config';
import pg from 'pg';
import readline from 'readline';

const { Pool } = pg;

const TEST_STRUCTURE_NAME = 'CCAS de Strasbourg (Test)';
const TEST_EMAIL_PATTERN = '%test@accesdirectaide.fr';

async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    console.log('\n🧹 Cleanup Test Accounts\n');

    // Preview what will be deleted
    const admins = await pool.query(`SELECT id, email FROM "AdminUser" WHERE email LIKE $1`, [TEST_EMAIL_PATTERN]);
    const citizens = await pool.query(`SELECT id, email FROM "CitizenUser" WHERE email LIKE $1`, [TEST_EMAIL_PATTERN]);
    const pros = await pool.query(`SELECT id, email FROM "ProUser" WHERE email LIKE $1`, [TEST_EMAIL_PATTERN]);
    const structures = await pool.query(`SELECT id, nom FROM "Structure" WHERE nom = $1`, [TEST_STRUCTURE_NAME]);

    console.log(`  Admins to delete:     ${admins.rows.length}`);
    admins.rows.forEach(r => console.log(`    - ${r.email}`));
    console.log(`  Citizens to delete:   ${citizens.rows.length}`);
    citizens.rows.forEach(r => console.log(`    - ${r.email}`));
    console.log(`  Pros to delete:       ${pros.rows.length}`);
    pros.rows.forEach(r => console.log(`    - ${r.email}`));
    console.log(`  Structures to delete: ${structures.rows.length}`);
    structures.rows.forEach(r => console.log(`    - ${r.nom}`));

    const total = admins.rows.length + citizens.rows.length + pros.rows.length + structures.rows.length;
    if (total === 0) {
      console.log('\n✅ Nothing to clean up.\n');
      return;
    }

    const ok = await confirm(`\n⚠️  Delete ${total} records?`);
    if (!ok) {
      console.log('Aborted.\n');
      return;
    }

    // Delete in correct order (foreign keys)
    // 1. Conversations & messages linked to test citizens
    for (const citizen of citizens.rows) {
      await pool.query(`DELETE FROM "RdvConversationMessage" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "citizenUserId" = $1)`, [citizen.id]);
      await pool.query(`DELETE FROM "RdvNotificationLog" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "citizenUserId" = $1)`, [citizen.id]);
      await pool.query(`DELETE FROM "RdvConversation" WHERE "citizenUserId" = $1`, [citizen.id]);
      await pool.query(`DELETE FROM "AuthToken" WHERE "userId" = $1`, [citizen.id]);
    }

    // 2. Appointments linked to test structure
    for (const struct of structures.rows) {
      await pool.query(`DELETE FROM "ProAppointment" WHERE "structureId" = $1`, [struct.id]);
      await pool.query(`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = $1`, [struct.id]);
      await pool.query(`DELETE FROM "ProRdvService" WHERE "structureId" = $1`, [struct.id]);
      await pool.query(`DELETE FROM "ProTimeOff" WHERE "structureId" = $1`, [struct.id]);
      await pool.query(`DELETE FROM "StructureRdvSettings" WHERE "structureId" = $1`, [struct.id]);
      await pool.query(`DELETE FROM "Invitation" WHERE "structureId" = $1`, [struct.id]);
    }

    // 3. Users
    const delPro = await pool.query(`DELETE FROM "ProUser" WHERE email LIKE $1 RETURNING email`, [TEST_EMAIL_PATTERN]);
    const delCitizen = await pool.query(`DELETE FROM "CitizenUser" WHERE email LIKE $1 RETURNING email`, [TEST_EMAIL_PATTERN]);
    const delAdmin = await pool.query(`DELETE FROM "AdminUser" WHERE email LIKE $1 RETURNING email`, [TEST_EMAIL_PATTERN]);

    // 4. Structure
    const delStruct = await pool.query(`DELETE FROM "Structure" WHERE nom = $1 RETURNING nom`, [TEST_STRUCTURE_NAME]);

    console.log(`\n✅ Deleted:`);
    console.log(`   ${delAdmin.rowCount} admin(s)`);
    console.log(`   ${delCitizen.rowCount} citizen(s)`);
    console.log(`   ${delPro.rowCount} pro(s)`);
    console.log(`   ${delStruct.rowCount} structure(s)\n`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
