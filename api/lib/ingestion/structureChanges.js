/**
 * PKG-11 / D14 — spec 002 change semantics for the structure directory ingestion (PURE: no I/O).
 * Before: a record's identity WAS its content hash (and its slug embedded the hash), so any change in the source (a new phone number) created a second
 * structure; updates never refreshed changed contact details; nothing was classified, versioned or soft-removed.
 *  - identity: the dataset + the SIRET when the source gives one, else the dataset + the folded name + the postal code (never the content);
 *  - FR-105 classification: NEW · UNCHANGED · METADATA_ONLY_CHANGED (the raw source document changed, the normalized facts did not: nothing downstream) ·
 *    NORMALIZED_FACT_CHANGED (with the changed fields);
 *  - the caller versions the prior facts (EntityVersion) before applying a change, never overwrites a VERIFIED record (a review item carries the diff instead),
 *    and soft-removes records absent from a COMPLETE fetch (FR-029; an empty or partial fetch removes nothing — last known good).
 */

export const FACT_FIELDS = Object.freeze(['nom', 'adresse', 'ville', 'code_postal', 'telephone', 'email', 'site_web']);

const fold = (/** @type {unknown} */ v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (/** @type {unknown} */ v) => String(v ?? '').replace(/\D+/g, '').replace(/^33(?=\d{9}$)/, '0');
const url = (/** @type {unknown} */ v) => String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/**
 * The facts compared between the source and the database, normalized so that formatting alone is not a change.
 * @param {Record<string, any>} r a validated incoming record or a Structure row
 * @param {{ fromRow?: boolean }} [opts] rows keep the full address in `adresse` (« 1 rue 67000 Ville »); incoming records keep the street only
 */
export function normalizedFacts(r, { fromRow = false } = {}) {
  const street = fromRow ? String(r.adresse ?? '') : `${r.adresse ?? ''} ${r.code_postal ?? ''} ${r.ville ?? ''}`;
  return {
    nom: fold(r.nom),
    adresse: fold(street),
    ville: fold(r.ville),
    code_postal: String(r.code_postal ?? '').trim(),
    telephone: digits(r.telephone),
    email: String(r.email ?? '').trim().toLowerCase(),
    site_web: url(r.site_web),
  };
}

/** @param {string} datasetId @param {Record<string, any>} r @returns {string} stable identity of a source record (never its content) */
export function identityKey(datasetId, r) {
  const siret = String(r.siret ?? '').replace(/\s+/g, '');
  return /^\d{14}$/.test(siret) ? `${datasetId}|siret|${siret}` : `${datasetId}|name|${fold(r.nom)}|${String(r.code_postal ?? '').trim()}`;
}

/**
 * @param {Record<string, any> | null | undefined} existing the Structure row (or null)
 * @param {Record<string, any>} incoming the validated incoming record
 * @param {string | null} incomingDocumentId the SourceDocument the record came from (a new document = the raw content changed)
 * @returns {{ state: 'NEW' | 'UNCHANGED' | 'METADATA_ONLY_CHANGED' | 'NORMALIZED_FACT_CHANGED', changed: string[] }}
 */
export function classifyStructureChange(existing, incoming, incomingDocumentId) {
  if (!existing) return { state: 'NEW', changed: [] };
  const before = /** @type {Record<string, string>} */ (normalizedFacts(existing, { fromRow: true }));
  const after = /** @type {Record<string, string>} */ (normalizedFacts(incoming));
  const changed = FACT_FIELDS.filter((f) => before[f] !== after[f]);
  if (changed.length) return { state: 'NORMALIZED_FACT_CHANGED', changed };
  return { state: (existing.source_document_id || null) === (incomingDocumentId || null) ? 'UNCHANGED' : 'METADATA_ONLY_CHANGED', changed: [] };
}

/** The values written for a fact change (the full address is stored as the directory shows it). @param {Record<string, any>} v */
export function factValues(v) {
  return {
    nom: v.nom, adresse: `${v.adresse} ${v.code_postal} ${v.ville}`.trim(), ville: v.ville, code_postal: v.code_postal,
    telephone: v.telephone || null, email: v.email || null, site_web: v.site_web || null,
  };
}

/**
 * A fetch is COMPLETE when it returned at least one record and every record the source announced (total_count), with no limit applied.
 * @param {{ received: number, announced?: number | null, limited?: boolean }} fetch
 */
export function isCompleteFetch({ received, announced, limited }) {
  return !limited && received > 0 && (announced == null || Number(announced) === received);
}
