/**
 * Auto-generated Zod schemas from Drizzle tables.
 *
 * Usage:
 *   import { insertAideSchema, adminBulkActionSchema } from '../../src/db/drizzle-schemas.js';
 *   const parsed = adminBulkActionSchema.parse(req.body);
 */

import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import * as schema from './schema.js';

// ─── Core Entity Schemas ─────────────────────────────────────────────────────

/** Insert schema for Aide */
export const insertAideSchema = createInsertSchema(schema.Aide);
export const selectAideSchema = createSelectSchema(schema.Aide);

/** Insert schema for Actualite */
export const insertActualiteSchema = createInsertSchema(schema.Actualite);
export const selectActualiteSchema = createSelectSchema(schema.Actualite);

/** Insert schema for Structure */
export const insertStructureSchema = createInsertSchema(schema.Structure);
export const selectStructureSchema = createSelectSchema(schema.Structure);

/** Insert schema for Demarche */
export const insertDemarcheSchema = createInsertSchema(schema.Demarche);
export const selectDemarcheSchema = createSelectSchema(schema.Demarche);

// ─── Admin Schemas ───────────────────────────────────────────────────────────

export const insertReviewQueueItemSchema = createInsertSchema(schema.ReviewQueueItem);
export const insertAuditLogSchema = createInsertSchema(schema.AuditLog);

// ─── Pro/Booking Schemas ─────────────────────────────────────────────────────

export const insertProAppointmentSchema = createInsertSchema(schema.ProAppointment);
export const insertProRdvServiceSchema = createInsertSchema(schema.ProRdvService);
export const insertProAvailabilityRuleSchema = createInsertSchema(schema.ProAvailabilityRule);
export const insertProTimeOffSchema = createInsertSchema(schema.ProTimeOff);
export const insertContentReportSchema = createInsertSchema(schema.ContentReport);

// ─── Update schemas (partial, all fields optional) ───────────────────────────

export const updateActualiteSchema = createUpdateSchema(schema.Actualite);
export const updateAideSchema = createUpdateSchema(schema.Aide);
export const updateStructureSchema = createUpdateSchema(schema.Structure);
export const updateDemarcheSchema = createUpdateSchema(schema.Demarche);

// ─── Handler-Specific Schemas ────────────────────────────────────────────────

/** admin/actions.js — bulk publish/reject/retry */
export const adminBulkActionSchema = z.object({
  action: z.enum(['PUBLISH', 'REJECT', 'RETRY_FALC']),
  ids: z.array(z.string().min(1)).min(1).max(200),
  // launch-readiness item 65: why an actualité is published or rejected (required for those two, recorded in the journal)
  reason: z.string().trim().max(500).optional(),
});

/** admin/validate-publication.js — validate before publishing */
export const validatePublicationSchema = z.object({
  entityType: z.enum(['aide', 'demarche', 'structure', 'actualite']),
  entityId: z.string().min(1),
});

/** admin/review-queue.js — PATCH status update */
export const reviewQueuePatchSchema = z.object({
  status: z.enum(['resolved', 'dismissed', 'ignored', 'resolved_by_ai']),
});

/** admin/review-queue.js — bulk PATCH */
export const reviewQueueBulkPatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  status: z.enum(['resolved', 'dismissed', 'ignored', 'resolved_by_ai']),
});

// ─── Pro Handler-Specific Schemas ────────────────────────────────────────────

/** pro/services.js — POST create service */
export const createServiceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  durationMinutes: z.coerce.number().int().positive().optional(),
  duration_minutes: z.coerce.number().int().positive().optional(),
  bufferBeforeMinutes: z.coerce.number().int().min(0).optional(),
  buffer_before_minutes: z.coerce.number().int().min(0).optional(),
  bufferAfterMinutes: z.coerce.number().int().min(0).optional(),
  buffer_after_minutes: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).refine(
  (d) => {
    const dur = d.durationMinutes ?? d.duration_minutes;
    return typeof dur === 'number' && dur > 0;
  },
  { message: 'durationMinutes must be a positive number', path: ['durationMinutes'] },
);

/** pro/services.js — PATCH update service (partial, only validates provided fields) */
export const updateServiceSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  durationMinutes: z.coerce.number().int().positive().optional(),
  duration_minutes: z.coerce.number().int().positive().optional(),
  bufferBeforeMinutes: z.coerce.number().int().min(0).optional(),
  buffer_before_minutes: z.coerce.number().int().min(0).optional(),
  bufferAfterMinutes: z.coerce.number().int().min(0).optional(),
  buffer_after_minutes: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/** pro/timeoff.js — POST create time off */
export const createTimeOffSchema = z.object({
  startAt: z.unknown().refine((v) => v !== undefined && v !== null && v !== '', 'startAt is required').pipe(z.coerce.date({ error: 'startAt must be a valid date' })),
  endAt: z.unknown().refine((v) => v !== undefined && v !== null && v !== '', 'endAt is required').pipe(z.coerce.date({ error: 'endAt must be a valid date' })),
  reason: z.string().optional(),
  // R24 (owner decision R18.5): whose absence — omitted = the author's own (or a closure of the structure for its schedule managers); 'structure' = a closure
  proUserId: z.string().min(1).max(200).optional(),
  scope: z.enum(['member', 'structure']).optional(),
}).refine(
  (d) => d.endAt > d.startAt,
  { message: 'endAt must be greater than startAt', path: ['endAt'] },
);

/** pro/appointments/index.js — POST create appointment */
export const createAppointmentSchema = z.object({
  serviceId: z.string().min(1, 'serviceId is required'),
  startAt: z.unknown().refine((v) => v !== undefined && v !== null && v !== '', 'startAt is required').pipe(z.coerce.date({ error: 'startAt must be a valid date' })),
  beneficiaryName: z.string().min(1, 'beneficiaryName is required'),
  beneficiaryPhone: z.string().optional(),
  notes: z.string().optional(),
});

/** pro/appointments/index.js — PATCH update appointment status */
export const patchAppointmentSchema = z.object({
  id: z.string().min(1).optional(),
  status: z.enum(['cancelled', 'done', 'no_show'], { error: 'status must be cancelled, done or no_show' }),
  notes: z.string().optional(),
});

/** pro/timeoff.js — PATCH update time off */
export const updateTimeOffSchema = z.object({
  id: z.string().min(1).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  reason: z.string().optional().nullable(),
});

/** Single availability rule entry */
const availabilityRuleItemSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM required'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM required'),
  timezone: z.string().optional(),
  isActive: z.boolean().optional().default(true),
}).refine(
  (d) => d.endTime > d.startTime,
  { message: 'endTime must be after startTime', path: ['endTime'] },
);

/** pro/availability.js — PUT/POST availability rules */
export const availabilityPayloadSchema = z.object({
  timezone: z.string().optional().default('Europe/Paris'),
  rules: z.array(availabilityRuleItemSchema).optional(),
  slots_json: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (d) => d.rules || d.slots_json,
  { message: 'rules or slots_json is required' },
);
