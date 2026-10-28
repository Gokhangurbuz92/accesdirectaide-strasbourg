import { z } from 'zod';

export const NormalizedStructure = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  name: z.string().min(2).max(500),
  address: z.string().min(5),
  city: z.string().min(1).max(200),
  postalCode: z.string().min(4).max(10),
  department: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  telephone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  website: z.string().url().nullable().optional().or(z.literal('')),
  structureType: z.string().nullable().optional(),
  services: z.array(z.string()).optional(),
  openingHours: z.string().nullable().optional(),
  openingHoursStructured: z.array(z.object({
    day: z.string(),
    open: z.string(),
    close: z.string()
  })).optional(),
  sourceUrl: z.string().url(),
  sourceOrg: z.string().nullable().optional(),
  sourceAuthority: z.string().nullable().optional(),
  language: z.string().default('fr'),
  fetchedAt: z.date().optional().default(() => new Date()),
  sourceUpdatedAt: z.date().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  accessibility: z.object({
    wheelchairAccess: z.boolean().nullable().optional(),
    reducedMobility: z.boolean().nullable().optional(),
    notes: z.string().nullable().optional()
  }).optional()
}).passthrough();

export default NormalizedStructure;
