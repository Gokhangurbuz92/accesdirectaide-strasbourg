// @ts-nocheck
/**
 * OfficialSourceService — Deterministic source registry
 *
 * Migrates ALLOWED_DOMAINS, RESOURCE_TYPES, isAllowedSource() from resource-curator.js.
 * Provides source envelopes to specialists. Purely deterministic — no LLM calls.
 */

import { SourceEnvelope } from '../agents/dispatch.js';

// Canonical allowed domains — migrated from resource-curator.js
export const ALLOWED_DOMAINS = [
  'gouv.fr',
  'service-public.fr',
  'caf.fr',
  'ameli.fr',
  'francetravail.fr',
  'aides-territoires.beta.gouv.fr',
  '1jeune1solution.gouv.fr',
  'mesdroitssociaux.gouv.fr',
];

export const RESOURCE_TYPES = ['RESSOURCE', 'BONNE_PRATIQUE', 'OUTIL', 'DISPOSITIF'];

// Forbidden network destinations for SSRF protection
const FORBIDDEN_HOSTS = [
  'localhost', '127.0.0.1', '::1', '0.0.0.0',
];
const PRIVATE_RANGES = [
  /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
  /^169\.254\./, /^fc00:/, /^fe80:/,
];

/**
 * Validate that a URL belongs to an allowed official domain.
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedSource(url) {
  if (!url || typeof url !== 'string') return false;
  // PKG-1: match the HOST (exact or a subdomain), not a substring of the whole URL ("https://evil.example/?gouv.fr" used to pass).
  let host = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

/**
 * Validate that a URL is safe to fetch (no SSRF).
 * Rejects localhost, loopback, private/link-local ranges.
 * @param {string} url
 * @returns {{ safe: boolean, reason?: string }}
 */
export function validateUrlSafety(url) {
  if (!url || typeof url !== 'string') {
    return { safe: false, reason: 'EMPTY_URL' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'INVALID_URL' };
  }

  // Reject non-HTTP(S) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'FORBIDDEN_SCHEME' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check forbidden hosts
  if (FORBIDDEN_HOSTS.includes(hostname)) {
    return { safe: false, reason: 'LOOPBACK_ADDRESS' };
  }

  // Check private IP ranges
  for (const pattern of PRIVATE_RANGES) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: 'PRIVATE_NETWORK' };
    }
  }

  // Check allowed domains
  if (!isAllowedSource(url)) {
    return { safe: false, reason: 'DOMAIN_NOT_ALLOWED' };
  }

  return { safe: true };
}

/**
 * Create a source envelope from known source data.
 * @param {{ sourceId: string, url?: string, organisation?: string, verificationStatus?: string, lastVerified?: string, contentHash?: string }} sourceData
 * @returns {import('zod').infer<typeof SourceEnvelope>}
 */
export function createSourceEnvelope(sourceData) {
  const domain = sourceData.url ? extractDomain(sourceData.url) : undefined;

  return SourceEnvelope.parse({
    sourceId: sourceData.sourceId,
    url: sourceData.url,
    organisation: sourceData.organisation,
    domain,
    verificationStatus: sourceData.verificationStatus || 'UNVERIFIED',
    lastVerified: sourceData.lastVerified,
    contentHash: sourceData.contentHash,
    freshnessState: sourceData.freshnessState || 'UNKNOWN',
    // @ts-ignore
    conflictState: sourceData.conflictState || 'NONE'
  });
}

/**
 * Extract domain from URL.
 * @param {string} url
 * @returns {string|undefined}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Validate a citation against supplied source envelopes.
 * Returns only citations that match known source IDs.
 * @param {string[]} citations - Citation IDs from specialist response
 * @param {Array} sourceEnvelopes - Supplied source envelopes
 * @returns {{ valid: string[], rejected: string[] }}
 */
export function validateCitations(citations, sourceEnvelopes) {
  if (!citations || !Array.isArray(citations)) return { valid: [], rejected: [] };

  const knownSourceIds = new Set(sourceEnvelopes.map(s => s.sourceId));
  const valid = [];
  const rejected = [];

  for (const citation of citations) {
    if (knownSourceIds.has(citation)) {
      valid.push(citation);
    } else {
      rejected.push(citation);
    }
  }

  return { valid, rejected };
}

/**
 * Detect source conflicts between envelopes.
 * @param {Array} sourceEnvelopes
 * @returns {{ hasConflict: boolean, conflictingPairs: Array }}
 */
export function detectSourceConflicts(sourceEnvelopes) {
  if (!sourceEnvelopes || sourceEnvelopes.length < 2) {
    return { hasConflict: false, conflictingPairs: [] };
  }

  const conflictingPairs = [];
  const conflicted = sourceEnvelopes.filter(s => s.conflictState === 'SOURCE_CONFLICT');

  for (let i = 0; i < conflicted.length; i++) {
    for (let j = i + 1; j < conflicted.length; j++) {
      conflictingPairs.push({
        sourceA: conflicted[i].sourceId,
        sourceB: conflicted[j].sourceId,
        dateA: conflicted[i].lastVerified,
        dateB: conflicted[j].lastVerified
      });
    }
  }

  return {
    hasConflict: conflictingPairs.length > 0,
    conflictingPairs
  };
}
