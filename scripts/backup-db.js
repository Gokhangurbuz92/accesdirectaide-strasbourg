#!/usr/bin/env node

/**
 * backup-db.js – Standalone backup verification script.
 * Uses a direct PostgreSQL client (pg) instead of the Drizzle DB module.
 * This allows the script to run without importing src/db/index.ts (TS file).
 */

import pg from 'pg';
const { Client } = pg;

const TABLES = [
  'Aide',
  'Structure',
  'Demarche',
  'Actualite',
  'CitizenUser',
  'ProUser',
  'AdminUser',
];

async function backup() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  const counts = {};
  for (const table of TABLES) {
    try {
      const res = await client.query(`SELECT COUNT(*) as count FROM "${table}"`);
      counts[table] = parseInt(res.rows[0].count, 10);
    } catch (err) {
      console.error(`Failed to query table ${table}:`, err.message);
      counts[table] = null;
    }
  }

  await client.end();

  console.log('Backup verification:');
  console.log(JSON.stringify(counts, null, 2));
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  console.log('Total records:', total);

  return counts;
}

backup().catch(err => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});


