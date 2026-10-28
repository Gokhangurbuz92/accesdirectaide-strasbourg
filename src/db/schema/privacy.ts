import { pgTable, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';
import crypto from 'node:crypto';

export const GuardianRelationship = pgTable('GuardianRelationship', {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    minorId: text('minorId').notNull(),
    guardianId: text('guardianId').notNull(),
    status: text('status').notNull(), // DECLARED, EMAIL_VERIFIED, STRONGER_VERIFICATION_REQUIRED, VERIFIED_STRONG, REVOKED
    scopes: jsonb('scopes').notNull().default([]),
    createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const DSRRequest = pgTable('DSRRequest', {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    subjectType: text('subjectType').notNull(),
    subjectId: text('subjectId').notNull(),
    requestType: text('requestType').notNull(), // ACCESS, EXPORT, DELETE, RESTRICT, WITHDRAW_CONSENT
    status: text('status').notNull(), // RECEIVED, IN_REVIEW, APPROVED, EXECUTING, COMPLETED, REJECTED
    executionMode: text('executionMode').notNull(), // AUTOMATIC_SAFE, HUMAN_REVIEW_REQUIRED, LEGAL_REVIEW_REQUIRED
    affectedDomains: jsonb('affectedDomains').notNull().default([]),
    reasonCode: text('reasonCode'),
    createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
    completedAt: timestamp('completedAt', { precision: 3 }),
});

export const LegalHold = pgTable('LegalHold', {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    dataCategory: text('dataCategory').notNull(),
    recordId: text('recordId').notNull(),
    reasonCode: text('reasonCode').notNull(),
    createdBy: text('createdBy').notNull(),
    status: text('status').notNull(), // ACTIVE, RELEASED
    createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
    releasedAt: timestamp('releasedAt', { precision: 3 }),
});
