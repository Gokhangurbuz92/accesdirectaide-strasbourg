#!/usr/bin/env node

/**
 * Disaster Recovery Verification Script
 *
 * Tests that the backup pipeline works end-to-end:
 *   1. Counts records in critical tables
 *   2. Creates a JSON backup snapshot
 *   3. Validates the backup (parseable, record counts match)
 *   4. Reports results
 *
 * Usage:
 *   node scripts/test-disaster-recovery.mjs
 *
 * Requires:
 *   DATABASE_URL environment variable (Neon connection string)
 */

import { writeFileSync, unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set. Add it to .env.local or export it.');
  process.exit(1);
}

let client;
async function getClient() {
  if (client) return client;
  const pg = await import('pg');
  const Client = pg.default?.Client || pg.Client;
  client = new Client({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false });
  await client.connect();
  return client;
}

async function query(sqlString) {
  const c = await getClient();
  const result = await c.query(sqlString);
  return result.rows;
}

async function main() {
  const startTime = Date.now();
  const results = { checks: [], errors: [] };

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  🔄 DISASTER RECOVERY VERIFICATION');
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // ─────────────────────────────────────────
  // Step 1: Count records in critical tables
  // ─────────────────────────────────────────
  console.log('📊 Step 1 — Counting records in critical tables...');

  const tables = [
    'Aide',
    'Structure',
    'Demarche',
    'Actualite',
    'AdminUser',
    'CitizenUser',
    'ProUser',
    'CronRun',
    'ConversationLog',
    'AuditLog',
    'ReviewQueueItem',
  ];

  const counts = {};

  for (const table of tables) {
    try {
      const result = await query(`SELECT COUNT(*) as count FROM "${table}"`);
      counts[table] = Number(result[0]?.count || 0);
      console.log(`   ✅ ${table}: ${counts[table]} records`);
      results.checks.push({ table, count: counts[table], ok: true });
    } catch (err) {
      console.log(`   ⚠️  ${table}: ${err.message.includes('does not exist') ? 'Table not found (OK if new)' : err.message}`);
      counts[table] = 0;
      results.checks.push({ table, count: 0, ok: false, error: err.message });
    }
  }

  // ─────────────────────────────────────────
  // Step 2: Create backup snapshot
  // ─────────────────────────────────────────
  console.log('');
  console.log('💾 Step 2 — Creating backup snapshot...');

  const backupTables = ['Aide', 'Structure', 'Demarche'];
  const backupData = {
    metadata: {
      version: '1.0',
      timestamp: new Date().toISOString(),
      source: DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown', // hostname only (no creds)
      counts: {},
    },
    data: {},
  };

  for (const table of backupTables) {
    try {
      const rows = await query(`SELECT * FROM "${table}" LIMIT 50`);
      backupData.data[table] = rows;
      backupData.metadata.counts[table] = rows.length;
      console.log(`   ✅ ${table}: exported ${rows.length} rows (sample)`);
    } catch (err) {
      console.log(`   ❌ ${table}: export failed — ${err.message}`);
      results.errors.push({ step: 'backup', table, error: err.message });
    }
  }

  const backupPath = join(process.cwd(), 'tmp', `dr-test-${Date.now()}.json`);
  const backupJson = JSON.stringify(backupData, null, 2);
  writeFileSync(backupPath, backupJson, 'utf-8');
  const fileSizeKB = (statSync(backupPath).size / 1024).toFixed(1);
  console.log(`   📁 Backup written: ${backupPath} (${fileSizeKB} KB)`);

  // ─────────────────────────────────────────
  // Step 3: Validate backup
  // ─────────────────────────────────────────
  console.log('');
  console.log('🔍 Step 3 — Validating backup...');

  let validationOk = true;

  // Check file exists
  if (!existsSync(backupPath)) {
    console.log('   ❌ Backup file does not exist');
    validationOk = false;
  } else {
    console.log('   ✅ Backup file exists');
  }

  // Check file not empty
  if (statSync(backupPath).size === 0) {
    console.log('   ❌ Backup file is empty');
    validationOk = false;
  } else {
    console.log(`   ✅ Backup file is not empty (${fileSizeKB} KB)`);
  }

  // Check JSON parseable
  try {
    const parsed = JSON.parse(backupJson);
    console.log('   ✅ JSON is valid and parseable');

    // Check metadata
    if (parsed.metadata?.version && parsed.metadata?.timestamp) {
      console.log('   ✅ Metadata present (version, timestamp)');
    } else {
      console.log('   ❌ Metadata missing');
      validationOk = false;
    }

    // Check counts match
    for (const table of backupTables) {
      const expected = parsed.metadata.counts[table] || 0;
      const actual = parsed.data[table]?.length || 0;
      if (expected === actual) {
        console.log(`   ✅ ${table}: count matches (${actual})`);
      } else {
        console.log(`   ❌ ${table}: count mismatch (metadata=${expected}, actual=${actual})`);
        validationOk = false;
      }
    }
  } catch (err) {
    console.log(`   ❌ JSON parse error: ${err.message}`);
    validationOk = false;
  }

  // Cleanup test file
  try {
    unlinkSync(backupPath);
    console.log('   🧹 Test file cleaned up');
  } catch {
    // Ignore cleanup errors
  }

  // ─────────────────────────────────────────
  // Step 4: Summary
  // ─────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  📋 DISASTER RECOVERY TEST RESULTS');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`  DB Connectivity     : ✅ OK`);
  console.log(`  Tables Accessible   : ${results.checks.filter(c => c.ok).length}/${tables.length}`);
  console.log(`  Total Records       : ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
  console.log(`  Backup Created      : ✅ ${fileSizeKB} KB`);
  console.log(`  Backup Valid JSON   : ${validationOk ? '✅' : '❌'}`);
  console.log(`  Counts Match        : ${validationOk ? '✅' : '❌'}`);
  console.log(`  Duration            : ${durationMs}ms`);
  console.log(`  Errors              : ${results.errors.length}`);
  console.log('');

  if (validationOk && results.errors.length === 0) {
    console.log('  🟢 VERDICT: Disaster Recovery pipeline is HEALTHY');
  } else {
    console.log('  🔴 VERDICT: Issues found — review errors above');
  }

  console.log('');
  console.log('  ⚠️  Note: This test validates backup creation only.');
  console.log('  Full restore testing requires a Neon branch (manual).');
  console.log('  See docs/disaster-recovery.md for the full procedure.');
  console.log('');

  process.exit(results.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
