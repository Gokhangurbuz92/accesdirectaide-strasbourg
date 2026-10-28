// @ts-nocheck
/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function extractSourceHost(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const host = String(url.hostname || '').trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function formatProvenanceDate(value) {
  const date = toDate(value);
  if (!date) return null;
  return date.toLocaleDateString('fr-FR');
}

/**
 * @param {unknown} verifiedAt
 * @param {Date=} now
 * @returns {'up_to_date' | 'to_review' | 'at_risk' | 'not_verified'}
 */
export function getFreshnessState(verifiedAt, now = new Date()) {
  const verifiedDate = toDate(verifiedAt);
  const nowDate = toDate(now) || new Date();

  if (!verifiedDate) return 'not_verified';

  const diffMs = nowDate.getTime() - verifiedDate.getTime();
  const safeDiffMs = Math.max(0, diffMs);
  const ageDays = Math.floor(safeDiffMs / (1000 * 60 * 60 * 24));

  if (ageDays <= 90) return 'up_to_date';
  if (ageDays <= 180) return 'to_review';
  return 'at_risk';
}

/**
 * @param {unknown} verifiedAt
 * @param {Date=} now
 * @returns {{ state: 'up_to_date' | 'to_review' | 'at_risk' | 'not_verified', label: string }}
 */
export function getFreshnessBadge(verifiedAt, now = new Date()) {
  const state = getFreshnessState(verifiedAt, now);
  if (state === 'up_to_date') return { state, label: 'À jour' };
  if (state === 'to_review') return { state, label: 'À actualiser' };
  if (state === 'not_verified') return { state, label: null };
  return { state, label: 'À risque' };
}

/**
 * @param {any} item
 * @returns {{ verifiedAt: string | null, fetchedAt: string | null, sourceUrl: string | null, sourceHost: string | null, contentStatus: string | null }}
 */
export function getProvenance(item) {
  const provenance = item?.provenance || {};
  const sourceUrl = provenance.sourceUrl || item?.source_url || item?.source_url_exact || item?.canonical_url || item?.lien_url || item?.url || null;
  // D-5: the normalised block keeps the server's content status (the component is fed the already-normalised block, so the LAB_UNVERIFIED notice must survive a second pass).
  // An unverified (lab) record never gets a verification date from a legacy field: the import/edit date is not a verification.
  const contentStatus = provenance.contentStatus || null;
  return {
    contentStatus,
    verifiedAt: provenance.verifiedAt || (contentStatus === 'LAB_UNVERIFIED' ? null : item?.date_verification) || null,
    fetchedAt: provenance.fetchedAt || item?.fetched_at || item?.retrieved_at || null,
    sourceUrl,
    sourceHost: provenance.sourceHost || extractSourceHost(sourceUrl),
  };
}
