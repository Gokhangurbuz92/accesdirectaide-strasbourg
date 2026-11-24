/**
 * G14-R3G — "LegalProtectionMandate" (migration drizzle/0064_r3g_legal_protection.sql, journal idx 64). The Drizzle declaration lives in
 * src/db/schema.ts with the 0064 snapshot (tests/unit/g14-snapshot-schema-sync.test.js); this module re-exports it for the callers that imported it while
 * the migration was pending. Every read or write still checks that the table exists (api/_services/legal-protection.js legalProtectionInstalled), so a
 * database where 0064 is not applied yet answers LEGAL_PROTECTION_NOT_INSTALLED.
 */
export { LegalProtectionMandate } from '../../src/db/schema.js';
