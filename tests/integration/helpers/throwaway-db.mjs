/**
 * A THROWAWAY database on the cluster of the suite's DATABASE_URL, migrated by drizzle's own migrator (the one the other migration suites use) up to ONE
 * journal entry: a staged copy of drizzle/ whose journal stops at that entry. For the files that test the code on a database BEFORE a migration
 * (Production receives each migration later, separately authorised): they used to skip themselves on a fully migrated database and needed a hand-made
 * database at the right level; now each one makes its own, runs, and drops it — in the native QA and in local runs alike, with no extra variable.
 * Loopback clusters only (the role must be allowed to create a database); the name always ends in « _test »; drop() removes it (WITH (FORCE)).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** @param {string | undefined} url */
export function isLoopbackDatabaseUrl(url) {
  try { const u = new URL(String(url || '')); return /^postgres(ql)?:$/.test(u.protocol) && LOOPBACK.has(u.hostname); } catch { return false; }
}

/** @param {string} url @param {string} name */
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

/** @param {string} baseUrl @param {string} name */
async function dropDatabase(baseUrl, name) {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } finally { await admin.end(); }
}

/**
 * @param {{ prefix: string, upTo: string, baseUrl?: string }} options  prefix: « ada_<letters/digits/_> »; upTo: the tag of the last journal entry to apply
 * @returns {Promise<{ name: string, url: string, applied: string[], drop: () => Promise<void> }>}
 */
export async function createThrowawayDatabase({ prefix, upTo, baseUrl = process.env.DATABASE_URL }) {
  if (!isLoopbackDatabaseUrl(baseUrl)) throw new Error('throwaway databases are only created on a loopback PostgreSQL cluster');
  if (!/^ada_[a-z0-9_]+$/.test(prefix)) throw new Error(`bad throwaway database prefix ${prefix}`);
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const last = journal.entries.findIndex((/** @type {{ tag: string }} */ e) => e.tag === upTo);
  if (last < 0) throw new Error(`no journal entry ${upTo}`);
  const entries = journal.entries.slice(0, last + 1);
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-staged-migrations-'));
  const name = `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}_test`;
  const base = String(baseUrl);
  try {
    fs.mkdirSync(path.join(staged, 'meta'));
    fs.writeFileSync(path.join(staged, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }, null, 2));
    for (const e of entries) fs.copyFileSync(path.join('drizzle', `${e.tag}.sql`), path.join(staged, `${e.tag}.sql`));
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${name}`);
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
    } finally { await admin.end(); }
    const pool = new pg.Pool({ connectionString: withDb(base, name), max: 2 });
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;');
      await migrate(drizzle(pool), { migrationsFolder: staged });
      const recorded = (await pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n;
      if (recorded !== entries.length) throw new Error(`throwaway database: ${recorded} migrations recorded, ${entries.length} expected`);
    } finally { await pool.end(); }
  } catch (err) {
    await dropDatabase(base, name).catch(() => {});
    throw err;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
  return { name, url: withDb(base, name), applied: entries.map((/** @type {{ tag: string }} */ e) => e.tag), drop: () => dropDatabase(base, name) };
}
