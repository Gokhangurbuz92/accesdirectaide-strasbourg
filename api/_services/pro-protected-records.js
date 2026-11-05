/**
 * R46 — protected RECORDS of the professional case work (case notes today: ProCaseNote.bodyEncrypted), behind one small interface so the lead can move them
 * to a certified (HDS) host without touching the case logic. It is the row-level sibling of the blob ProtectedStore (api/lib/protected-store/, files of the
 * vault and of shared dossiers) and follows the same selection rule:
 *
 *   driver `main-db-sealed` (only driver today): the text is sealed by ADA (envelope encryption, api/lib/data-keys.ts, purpose « case-note », context
 *   « case:<id> ») and stored in ADA's PostgreSQL row.
 *     - development / test (LAB): always available (synthetic data only);
 *     - production / preview: refused unless ADA_HDS_CERTIFIED_HOSTING holds a valid attestation token (api/_utils/capabilities.js) AND
 *       ADA_PROTECTED_RECORDS=main-db-certified — the controller's explicit statement that the PostgreSQL holding these rows is on the certified host.
 *   Refusal = 503 PROTECTED_STORE_REFUSED, nothing read or written. This is a second lock beside the capability gate (pro.case_management is closed in
 *   production anyway). Neither switch is a verification of a certificate.
 *
 * Interface (what a certified implementation must provide): sealCaseNote(caseId, text) → stored value; openCaseNote(caseId, stored) → text | null; state().
 */
import { openText, sealText } from '../lib/data-keys.js';
import { hdsAttestation } from '../_utils/capabilities.js';

export const PROTECTED_RECORDS_DRIVER = 'main-db-sealed';
export const PROTECTED_STORE_REFUSED = 'PROTECTED_STORE_REFUSED';
export const PROTECTED_RECORDS_REFUSED_MESSAGE = 'Le stockage protégé des notes de suivi n’est pas disponible sur ce service : aucune note n’a été lue ni enregistrée.';

export class ProtectedRecordsRefusedError extends Error {
  /** @param {string} reason */
  constructor(reason) { super(`${PROTECTED_STORE_REFUSED}: ${reason}`); this.name = 'ProtectedRecordsRefusedError'; this.code = PROTECTED_STORE_REFUSED; this.reason = reason; }
}

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();

/**
 * @param {Record<string, string | undefined>} [envVars] @param {Date} [now]
 * @returns {{ ok: boolean, driver: string, reason: string | null, hdsCertified: boolean }}
 */
export function protectedRecordsState(envVars = process.env, now = new Date()) {
  const deployed = ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());
  if (!deployed) return { ok: true, driver: PROTECTED_RECORDS_DRIVER, reason: null, hdsCertified: false };
  const hds = hdsAttestation(envVars, now);
  if (!hds.valid) return { ok: false, driver: PROTECTED_RECORDS_DRIVER, reason: hds.reason || 'HDS_HOSTING_NOT_ATTESTED', hdsCertified: false };
  if (flag(envVars.ADA_PROTECTED_RECORDS) !== 'main-db-certified') return { ok: false, driver: PROTECTED_RECORDS_DRIVER, reason: 'RECORDS_HOST_NOT_DECLARED_CERTIFIED', hdsCertified: false };
  return { ok: true, driver: PROTECTED_RECORDS_DRIVER, reason: null, hdsCertified: true };
}

/** @param {{ env?: Record<string, string | undefined>, now?: () => Date }} [deps] */
export function createProProtectedRecords(deps = {}) {
  const state = () => protectedRecordsState(deps.env || process.env, deps.now ? deps.now() : new Date());
  const guard = () => { const s = state(); if (!s.ok) throw new ProtectedRecordsRefusedError(/** @type {string} */ (s.reason)); };
  return {
    state,
    /** @param {string} caseId @param {string} text */
    sealCaseNote(caseId, text) { guard(); return sealText(text, { purpose: 'case-note', context: `case:${caseId}` }); },
    /** @param {string} caseId @param {string | null} stored */
    openCaseNote(caseId, stored) { guard(); return openText(String(stored || ''), { purpose: 'case-note', context: `case:${caseId}` }); },
  };
}

export const proProtectedRecords = createProProtectedRecords();
export const protectedRecordsRefusal = () => ({ ok: false, status: 503, code: PROTECTED_STORE_REFUSED, message: PROTECTED_RECORDS_REFUSED_MESSAGE });
