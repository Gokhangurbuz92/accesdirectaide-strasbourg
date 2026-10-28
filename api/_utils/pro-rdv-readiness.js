import { db as defaultDb } from '../../src/db/index.js';
import { sql } from 'drizzle-orm';

export const REQUIRED_PRO_RDV_TABLES = [
  'ProRdvService',
  'ProAvailabilityRule',
  'ProAppointment',
  'ProTimeOff',
];

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number} timeoutMs
 * @returns {Promise<Set<string>>}
 */
async function loadExistingTables(/** @type {typeof defaultDb} */ dbClient, timeoutMs) {
  const { rows } = await withTimeout(
    dbClient.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('ProRdvService', 'ProAvailabilityRule', 'ProAppointment', 'ProTimeOff')
    `),
    timeoutMs,
  );

  const existing = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tableName = row && typeof row === 'object' ? String(row.table_name || '') : '';
    if (tableName) existing.add(tableName);
  }
  return existing;
}

/**
 * Check whether the required Pro RDV tables are present in the database.
 *
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number=} timeoutMs
 * @returns {Promise<{ ok: boolean, missingTables: string[] }>}
 */
export async function getProRdvReadiness(/** @type {typeof defaultDb} */ dbClient = defaultDb, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const existingTables = await loadExistingTables(dbClient, timeoutMs);

  const missingTables = REQUIRED_PRO_RDV_TABLES.filter((tableName) => !existingTables.has(tableName));
  const ok = missingTables.length === 0;

  return {
    ok,
    missingTables,
  };
}
