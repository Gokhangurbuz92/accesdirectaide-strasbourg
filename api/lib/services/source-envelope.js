// @ts-nocheck
import { createSourceEnvelope as legacyCreateSourceEnvelope } from './official-sources.js';

/**
 * Phase 8 Extended SourceEnvelope.
 * Adds provenance, versioning, freshness, and capability metadata
 * on top of the existing Phase 7 SourceEnvelope.
 */
export function createExtendedSourceEnvelope({
  url,
  title,
  section,
  // Phase 8 extensions
  sourceId,
  documentId,
  territory,
  authority,
  capabilities = [],
  effectiveDate = null,
  sourceUpdatedAt = null,
  retrievedAt = new Date(),
  freshnessState = 'UNKNOWN',
  contentHash = null,
  version = null,
  language = 'fr'
}) {
  // Start with legacy envelope
  const base = legacyCreateSourceEnvelope({ url, sourceId, contentHash, freshnessState });
  
  return {
    ...base,
    title,
    section,
    // Phase 8 provenance
    documentId,
    territory,
    authority,
    capabilities,
    effectiveDate,
    sourceUpdatedAt,
    retrievedAt: retrievedAt instanceof Date ? retrievedAt.toISOString() : retrievedAt,
    version,
    language
  };
}

/**
 * Validate that a SourceEnvelope has sufficient provenance for RAG grounding.
 * Citation grounding must remain deterministic.
 */
export function validateEnvelopeForGrounding(/** @type {{ authority: string | number | boolean | null | undefined, retrievedAt: string | number | boolean | null | undefined, sourceId: string | number | boolean | null | undefined, url: string | number | boolean | null | undefined }} */ envelope) {
  const issues = [];
  if (!envelope.url) issues.push('Missing source URL');
  if (!envelope.sourceId) issues.push('Missing sourceId');
  if (!envelope.authority) issues.push('Missing authority');
  if (!envelope.retrievedAt) issues.push('Missing retrievedAt');
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Check if an envelope's source is fresh enough for use.
 * @param {{ freshnessState: string; }} envelope
 */
export function isEnvelopeFresh(envelope) {
  return envelope.freshnessState === 'FRESH' || envelope.freshnessState === 'AGING';
}

export default { createExtendedSourceEnvelope, validateEnvelopeForGrounding, isEnvelopeFresh };
