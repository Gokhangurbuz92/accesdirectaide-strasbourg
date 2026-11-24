// @ts-check
/**
 * G14-R3 — the HDS database (its own PostgreSQL, its own numbered migrations in services/hds/migrations, never Neon) and the blob store.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** @param {string} databaseUrl @param {{ max?: number }} [o] */
export function createPool(databaseUrl, o = {}) {
  return new pg.Pool({ connectionString: databaseUrl, max: o.max ?? 5, idleTimeoutMillis: 30000, application_name: 'ada-hds' });
}

/** apply the pending migrations, in order, each in a transaction; returns the names applied @param {pg.Pool} pool */
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(744201)');   // two containers starting together apply once
    await client.query('CREATE TABLE IF NOT EXISTS public.hds_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM public.hds_schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const applied = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await client.query('INSERT INTO public.hds_schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(744201)').catch(() => {});
    client.release();
  }
}

/**
 * Blob store "pg": ciphertext in hds.blob, inside the same HDS PostgreSQL (covered by the same certificate, backups and PITR). The interface is the one
 * an S3-compatible HDS bucket driver would implement (put / get / delete by random id). Only ciphertext ever reaches it.
 * @param {pg.Pool | pg.PoolClient} q
 */
export function pgBlobStore(q) {
  return {
    /** @param {string} id @param {Buffer} bytes @param {string} digest */
    async put(id, bytes, digest) { await q.query('INSERT INTO hds.blob (id, content, sha256, byte_length) VALUES ($1, $2, $3, $4)', [id, bytes, digest, bytes.length]); },
    /** @param {string} id @returns {Promise<{ bytes: Buffer, sha256: string } | null>} */
    async get(id) { const r = await q.query('SELECT content, sha256 FROM hds.blob WHERE id = $1', [id]); return r.rows[0] ? { bytes: r.rows[0].content, sha256: r.rows[0].sha256 } : null; },
    /** @param {string[]} ids */
    async delete(ids) { if (ids.length) await q.query('DELETE FROM hds.blob WHERE id = ANY($1::uuid[])', [ids]); },
  };
}
