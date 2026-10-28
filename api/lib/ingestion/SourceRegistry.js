// @ts-nocheck
import { z } from 'zod';
import * as repo from './SourceRegistryRepository.js';

const SourceRegistrySchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
  endpoint: z.string().nullable().optional(),
  cronSchedule: z.string().nullable().optional(),
  capabilities: z.array(z.string()).default([]),
  producerAuthority: z.string().nullable().optional(),
  distributionPlatform: z.string().nullable().optional(),
  trustedDomains: z.array(z.string()).default([]),
  organisation: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  licenceUrl: z.string().nullable().optional(),
  licenceName: z.string().nullable().optional(),
  reuseConditions: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'PAUSED', 'ERROR']).default('ACTIVE')
});

const SOURCE_TYPE_MAP = {
  REST: 'REST_API',
  API: 'REST_API',
  REST_API: 'REST_API',
  GRAPHQL: 'GRAPHQL',
  HTML_SCRAPER: 'HTML_SCRAPER',
  HTML: 'HTML_SCRAPER',
  SCRAPER: 'HTML_SCRAPER',
  RSS_ATOM: 'RSS_ATOM',
  RSS: 'RSS_ATOM',
  ATOM: 'RSS_ATOM',
  CSV: 'CSV',
  XML: 'XML',
  JSON_FILE: 'JSON_FILE',
  JSON: 'JSON_FILE',
  CURATED: 'CURATED',
};

/**
 * @param {string} type
 */
function normalizeSourceType(type) {
  if (typeof type !== 'string') return type;
  const upper = type.toUpperCase().trim();
  return SOURCE_TYPE_MAP[upper] || upper;
}

export async function registerSource(entry) {
  const validated = SourceRegistrySchema.parse(entry);
  const existing = await repo.getSource(validated.sourceId);
  const data = { 
    ...validated, 
    type: normalizeSourceType(validated.type),
    failureCount: existing ? existing.failureCount : 0, 
    lastSyncAt: existing ? existing.lastSyncAt : null, 
    lastSuccessAt: existing ? existing.lastSuccessAt : null, 
    createdAt: existing ? existing.createdAt : new Date(),
    status: existing ? existing.status : 'ACTIVE'
  };
  await repo.upsertSource(data);
  return repo.getSource(validated.sourceId);
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} sourceId
 */
export async function getSource(sourceId) {
  return await repo.getSource(sourceId);
}

export async function listSources(filter = {}) {
  let sources = await repo.listSources();
  if (filter.status) sources = sources.filter(s => s.status === filter.status);
  if (filter.capability) sources = sources.filter(s => s.capabilities.includes(filter.capability));
  return sources;
}

export async function updateSource(/** @type {string} */ sourceId, updates) {
  const existing = await repo.getSource(sourceId);
  if (!existing) throw new Error(`Source not found: ${sourceId}`);
  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.type) {
    normalizedUpdates.type = normalizeSourceType(normalizedUpdates.type);
  }
  const updated = { ...existing, ...normalizedUpdates };
  await repo.upsertSource(updated);
  return updated;
}

export async function disableSource(/** @type {string} */ sourceId, /** @type {string | number | boolean | null | undefined} */ reason) {
  return await updateSource(sourceId, { status: 'DISABLED', disabledAt: new Date(), disableReason: reason });
}

/**
 * @param {string} sourceId
 * @param {boolean} success
 */
export async function recordSyncResult(sourceId, success) {
  const source = await getSource(sourceId);
  if (!source) return;
  if (success) {
    await updateSource(sourceId, { failureCount: 0, lastSyncAt: new Date(), lastSuccessAt: new Date(), status: 'ACTIVE' });
  } else {
    const newCount = (source.failureCount || 0) + 1;
    const updates = { failureCount: newCount, lastSyncAt: new Date() };
    if (newCount >= 10) {
      updates.status = 'DISABLED';
      updates.disabledAt = new Date();
    }
    await updateSource(sourceId, updates);
  }
}

export async function getActiveConnectors() {
  return await listSources({ status: 'ACTIVE' });
}

export async function clearRegistry() {
  await repo.clearRegistry();
}

export default { registerSource, getSource, listSources, updateSource, disableSource, recordSyncResult, getActiveConnectors, clearRegistry };
