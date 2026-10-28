/**
 * Test helpers — DB availability guard
 *
 * Provides `describeIfDb` / `itIfDb` wrappers that skip tests
 * when no real DATABASE_URL is available.
 *
 * Usage:
 *   import { describeIfDb } from '../helpers/db-guard.js';
 *   describeIfDb('My integration suite', () => { ... });
 */

const hasDatabase = !!(process.env.DATABASE_URL || process.env.DATABASE_URL_TEST);

/**
 * describe() that skips the entire block when no database is available.
 */
export const describeIfDb = hasDatabase ? describe : describe.skip;

/**
 * it() that skips when no database is available.
 */
export const itIfDb = hasDatabase ? it : it.skip;
