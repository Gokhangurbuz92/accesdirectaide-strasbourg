// @ts-nocheck
/**
 * G14-R3G — the Drizzle declaration of "LegalProtectionMandate" (drizzle/pending/0064_r3g_legal_protection.sql).
 *
 * Deliberately NOT in src/db/schema.ts while the migration is pending (not in the journal): drizzle-kit would otherwise diff the newest snapshot against the
 * schema and emit it as the next journal migration, before g14-r3d's 0063 (tests/unit/g14-snapshot-schema-sync.test.js). Every read or write first checks
 * that the table exists (api/_services/legal-protection.js legalProtectionInstalled). When the integrator puts 0064 in the journal, this block moves to
 * src/db/schema.ts unchanged (with the 0064 snapshot) and this module re-exports it.
 */
import { boolean, date, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const LegalProtectionMandate = pgTable('LegalProtectionMandate', {
  id: text('id').notNull().primaryKey(),
  protectedUserId: text('protectedUserId').notNull(),
  representativeUserId: text('representativeUserId').notNull(),
  representativeKind: text('representativeKind').notNull(),
  mjpmForm: text('mjpmForm'),
  structureId: text('structureId'),
  siret: text('siret'),
  measure: text('measure').notNull(),
  mode: text('mode').notNull(),
  scopePerson: boolean('scopePerson').notNull().default(false),
  scopeAssets: boolean('scopeAssets').notNull().default(false),
  areas: text('areas').array().notNull().default(sql`'{}'::text[]`),
  courtName: text('courtName').notNull(),
  decisionDate: date('decisionDate', { mode: 'string' }).notNull(),
  measureEndsOn: date('measureEndsOn', { mode: 'string' }),
  validUntil: date('validUntil', { mode: 'string' }),
  decisionRefHmac: text('decisionRefHmac'),
  status: text('status').notNull().default('DECLARED'),
  personContestedAt: timestamp('personContestedAt', { precision: 3 }),
  verifiedAt: timestamp('verifiedAt', { precision: 3 }),
  verifiedBy: text('verifiedBy'),
  verificationMethod: text('verificationMethod'),
  verificationNote: text('verificationNote'),
  endedAt: timestamp('endedAt', { precision: 3 }),
  endedBy: text('endedBy'),
  endReason: text('endReason'),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  protectedIdx: index('LegalProtectionMandate_protected_idx').on(t.protectedUserId),
  representativeIdx: index('LegalProtectionMandate_representative_idx').on(t.representativeUserId),
  statusIdx: index('LegalProtectionMandate_status_idx').on(t.status),
  liveKey: uniqueIndex('LegalProtectionMandate_live_key').on(t.protectedUserId, t.representativeUserId).where(sql`"status" IN ('DECLARED', 'VERIFIED', 'SUSPENDED')`),
}));
