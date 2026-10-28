import { z } from 'zod';

/**
 * Canonical normalized benefit (Aide) schema.
 * Maps raw connector output to a standardized domain model.
 * Raw source is always preserved separately in SourceDocument.
 */
export const NormalizedBenefit = z.object({
  // Identity
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  
  // Core fields
  title: z.string().min(3).max(500),
  description: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  categoryCode: z.enum(['LOGEMENT', 'SANTE', 'HANDICAP', 'EMPLOI', 'FAMILLE', 'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'JUSTICE', 'NUMERIQUE', 'AUTRE']).default('AUTRE'),
  
  // Eligibility
  eligibility: z.object({
    conditions: z.array(z.string()).optional(),
    audiences: z.array(z.string()).optional(),
    ageMin: z.number().nullable().optional(),
    ageMax: z.number().nullable().optional(),
    incomeThreshold: z.number().nullable().optional(),
    situationsVie: z.array(z.string()).optional()
  }).optional(),
  
  // Financial
  financials: z.object({
    amount: z.number().nullable().optional(),
    amountMax: z.number().nullable().optional(),
    amountUnit: z.string().nullable().optional(),
    frequency: z.string().nullable().optional()
  }).optional(),
  
  // Provenance (SourceEnvelope-compatible)
  sourceUrl: z.string().url().or(z.literal('')).nullable().optional(),
  sourceOrg: z.string().nullable().optional(),
  sourceAuthority: z.string().nullable().optional(),
  
  // Territory
  territoryScope: z.string().nullable().optional(),
  departements: z.array(z.string()).optional(),
  regionCodes: z.array(z.string()).optional(),
  geoScope: z.string().nullable().optional(),
  
  // Metadata
  language: z.string().default('fr'),
  fetchedAt: z.date().optional().default(() => new Date()),
  sourceUpdatedAt: z.date().nullable().optional(),
  effectiveDate: z.date().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  
  // Legal basis references
  legalReferences: z.array(z.object({
    articleNumber: z.string(),
    codeRef: z.string().optional(),
    effectiveDate: z.string().optional()
  })).optional()
}).passthrough();

export default NormalizedBenefit;
