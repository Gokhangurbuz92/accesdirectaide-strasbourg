// @ts-nocheck
/**
 * DTA S1 stage 2b-2 — what may be STORED in / READ from SharedDiagnostic.results (PURE: no I/O).
 *  - write side (share/create): only the contract `assessment` (re-validated, rebuilt from allowlisted keys) + provenance/meta scalars are kept. The legacy `rights[]`
 *    (eligible flags, invented amounts) and any totals are never stored; the stored state is never authoritative; client-supplied server keys (`_consent`, `_files`, …) are dropped.
 *  - read side (share/get, pro dossier/export/synthesis/attestation): rows stored before this change may still carry `rights[]` with amounts; they are removed at read time and
 *    flagged `legacyRightsOmitted` (nothing is invented in their place). Server-managed `_…` keys are left to their existing projections.
 */
import { AMOUNT_STATUS, AUTHORITATIVE_STATES, FACT_KEYS, PROVENANCE_FIELDS, STATES, assertAssessmentItem, whyTexts } from './assessmentContract.js';

const MAX_ITEMS = 20;
const MAX_TEXT = 600;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : null);

function cleanItem(raw) {
  if (!isObj(raw)) throw new Error('item must be an object');
  if (AUTHORITATIVE_STATES.includes(raw.state)) throw new Error('authoritative states cannot be shared from a client payload');
  if (!Object.values(STATES).includes(raw.state)) throw new Error('unknown state');
  const p = isObj(raw.provenance) ? raw.provenance : {};
  const d = isObj(p.display) ? p.display : {};
  const provenance = { display: {} };
  for (const f of PROVENANCE_FIELDS) { provenance[f] = str(p[f]); provenance.display[f] = str(d[f]) || ''; }
  const item = {
    code: str(raw.code) || '',
    label: str(raw.label) || '',
    state: raw.state,
    authoritative: false,
    amount: null,
    amountStatus: AMOUNT_STATUS,
    missingFacts: Array.isArray(raw.missingFacts) ? raw.missingFacts.slice(0, 10).map((x) => str(x) || '') : [],
    whoToAsk: str(raw.whoToAsk),
    explanation: str(raw.explanation) || '',
    explanationFalc: str(raw.explanationFalc) || '',
    provenance,
    basisFacts: Array.isArray(raw.basisFacts) ? raw.basisFacts.filter((f) => FACT_KEYS.includes(f)).slice(0, 10) : [],   // PKG-6 / D20: known fact keys only (labels, never values)
  };
  // D20: the « why » texts follow the same rule as `explanation` (bounded, forbidden-wording check below); a payload from before D20 gets them recomputed here
  const why = whyTexts(item.state, { basisFacts: item.basisFacts, missingFacts: item.missingFacts, provenance: { rule: provenance.rule, source: provenance.source } });
  item.whyFr = str(raw.whyFr) || why.whyFr; item.whyFalc = str(raw.whyFalc) || why.whyFalc;
  assertAssessmentItem(item);                                                          // throws on any contract violation (incl. forbidden wording)
  return item;
}

/** @returns {{ ok: true, value: object } | { ok: false, reason: string }} */
export function sanitizeResultsForStorage(results) {
  if (!isObj(results)) return { ok: false, reason: 'results_must_be_object' };
  const out = {};
  if (results.assessment !== undefined) {
    const a = results.assessment;
    if (!isObj(a) || !Array.isArray(a.items) || a.items.length > MAX_ITEMS) return { ok: false, reason: 'invalid_assessment' };
    if (a.authoritative === true) return { ok: false, reason: 'invalid_assessment' };
    try {
      out.assessment = {
        contract: 'ADA_ASSESSMENT_CONTRACT_V1',
        authoritative: false,
        leadsEnabled: a.leadsEnabled === true,
        dataStatus: 'UNVERIFIED',                                                      // a client can never assert verified data
        referenceDate: str(a.referenceDate),
        totals: null,
        items: a.items.map(cleanItem),
      };
    } catch {
      return { ok: false, reason: 'invalid_assessment' };
    }
  }
  if (isObj(results.provenance)) {
    out.provenance = { source: str(results.provenance.source), engineVersion: str(results.provenance.engineVersion), referenceDate: str(results.provenance.referenceDate), authoritative: false, dataStatus: 'UNVERIFIED' };
  }
  if (typeof results.period === 'string') out.period = results.period.slice(0, 16);
  if (isObj(results.meta)) {                                                           // scalars only; derived household figures (householdSize, resourcesPerPerson) are NOT kept
    out.meta = { source: str(results.meta.source), engineVersion: str(results.meta.engineVersion), referenceDate: str(results.meta.referenceDate), requestId: str(results.meta.requestId) };
  }
  return { ok: true, value: out };
}

/**
 * Read side: never hand out legacy eligibility flags / amounts / totals, nor the server-kept keys (PKG-11 audit: the read-only share link returned every
 * organization's follow-up — internal note and staff id included — the file storage list and the consent proof). Callers that need their own slice rebuild
 * it from the stored row (projectResultsForStructure: the caller organization's follow-up and files; the owner's pages read the row). Returns a shallow copy.
 */
export function presentResults(results) {
  if (!isObj(results)) return results;
  const out = { ...results };
  for (const k of ['_followUps', '_followUp', '_files', '_consent', '_consentByStructure']) delete out[k];
  let legacy = false;
  for (const k of ['rights', 'totalMonthly', 'total', 'totals', 'estimatedTotal']) {
    if (k in out) { delete out[k]; legacy = true; }
  }
  if (legacy) out.legacyRightsOmitted = true;
  return out;
}
