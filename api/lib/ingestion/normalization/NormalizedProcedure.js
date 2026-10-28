import { z } from 'zod';

export const NormalizedProcedure = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(3).max(500),
  shortDescription: z.string().nullable().optional(),
  detailedContent: z.string().nullable().optional(),
  targetAudience: z.string().nullable().optional(),
  officialUrl: z.string().url().or(z.literal('')).nullable().optional(),
  sourceUrl: z.string().url().or(z.literal('')),
  sourceUrlExact: z.string().url().or(z.literal('')).nullable().optional(),
  sourceHost: z.string().optional(),
  category: z.string().optional(),
  audiences: z.array(z.string()).optional(),
  territoryScope: z.string().nullable().optional(),
  sourceApi: z.string().optional(),
  sourceOrg: z.string().nullable().optional(),
  sourceAuthority: z.string().nullable().optional(),
  language: z.string().default('fr'),
  fetchedAt: z.date().optional().default(() => new Date()),
  sourceUpdatedAt: z.date().nullable().optional(),
  effectiveDate: z.date().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  requiredDocuments: z.array(z.string()).optional(),
  deadlines: z.array(z.object({
    label: z.string(),
    date: z.string().optional(),
    isRecurring: z.boolean().optional()
  })).optional(),
  steps: z.array(z.object({
    order: z.number(),
    title: z.string(),
    description: z.string().optional()
  })).optional(),
  legalReferences: z.array(z.object({
    articleNumber: z.string(),
    codeRef: z.string().optional(),
    effectiveDate: z.string().optional()
  })).optional()
}).passthrough();

export default NormalizedProcedure;
