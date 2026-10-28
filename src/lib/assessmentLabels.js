// @ts-nocheck
/**
 * DTA S1 stage 2b — presentation helpers for the assessment contract (PURE, no React, no I/O).
 * Wording rule (PRODUCT_FLOW_CONTRACT §2): pre-orientation only — never an entitlement claim, never an inapplicability claim, never an amount or a total (forbidden phrases are pinned in tests/unit/dta-s1b-ui.test.jsx).
 * In S1 no state is authoritative: an item that claims an authoritative state (or lacks the five provenance fields) is NEVER shown as verified.
 */
export const PROVENANCE_KEYS = ['source', 'verifiedAt', 'territory', 'rule', 'uncertainty'];

export const STATE_LABELS = Object.freeze({
  MISSING_INFORMATION: 'Informations manquantes',
  CHECK_REQUIRED: 'À faire vérifier',
  POSSIBLE: 'Piste à vérifier',
  UNSUPPORTED: 'Pas encore évalué par ADA',
  ENGINE_UNAVAILABLE: 'Service indisponible',
});
const RENDERABLE = Object.keys(STATE_LABELS);

export const MISSING_FACT_LABELS = Object.freeze({
  birthDate: 'date de naissance ou tranche d\'âge',
  householdSize: 'composition du foyer',
  income: 'revenus',
  'housing.status': "statut d'occupation du logement",
  'housing.rent': 'loyer',
  territory: 'commune ou code postal',
});
export const AGE_BAND_LABELS = Object.freeze({ 'moins-de-18': 'Moins de 18 ans', '18-24': '18 à 24 ans', '25-59': '25 à 59 ans', '60-et-plus': '60 ans et plus' });
/** Display of the age declaration of a situation: the exact date, else the declared band, else "Non précisée". */
export const birthDisplay = (situation) => (situation && situation.birthDate) || (situation && AGE_BAND_LABELS[situation.ageBand] ? `Tranche d'âge : ${AGE_BAND_LABELS[situation.ageBand]}` : 'Non précisée');
export const missingFactLabel = (k) => MISSING_FACT_LABELS[k] || 'information à préciser';

export const GROUPS = Object.freeze([
  { id: 'check', title: "À faire vérifier auprès de l'organisme", states: ['POSSIBLE', 'CHECK_REQUIRED'] },
  { id: 'missing', title: 'Informations manquantes', states: ['MISSING_INFORMATION'] },
  { id: 'unsupported', title: 'ADA ne sait pas encore évaluer', states: ['UNSUPPORTED'] },
  { id: 'engine', title: 'Service indisponible', states: ['ENGINE_UNAVAILABLE'] },
]);

/** True only for a non-authoritative item that carries all five provenance display lines and a non-empty explanation. */
export function isRenderableItem(it) {
  if (!it || typeof it !== 'object') return false;
  if (!RENDERABLE.includes(it.state)) return false;                                   // authoritative / unknown states are never rendered as a result in S1
  if (it.authoritative !== false || it.amount !== null && it.amount !== undefined) return false;
  const d = it.provenance && it.provenance.display;
  if (!d || PROVENANCE_KEYS.some((k) => typeof d[k] !== 'string' || !d[k])) return false;
  return typeof it.label === 'string' && !!it.label && typeof it.explanation === 'string' && !!it.explanation;
}

/** @returns {{ items: object[], rejected: number, usable: boolean, dataStatusBanner: string }} */
export function readAssessment(results) {
  const a = results && typeof results === 'object' ? results.assessment : null;
  const raw = a && Array.isArray(a.items) ? a.items : null;
  const items = raw ? raw.filter(isRenderableItem) : [];
  return {
    items,
    rejected: raw ? raw.length - items.length : 0,
    usable: !!raw && items.length > 0,
    dataStatusBanner: 'Données en cours de vérification.',                           // S1: never "vérifié" (WS2 manifest launchReady:false)
  };
}

/** What may leave the page toward /api/share/create and the PDF: the contract only (no legacy rights[], no amounts, no totals). */
export function shareableResults(results) {
  const r = results && typeof results === 'object' ? results : {};
  const { items } = readAssessment(r);
  return {
    assessment: {
      contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: r.assessment?.referenceDate ?? null, totals: null,
      items: items.map((i) => ({ code: i.code, label: i.label, state: i.state, authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: i.missingFacts || [], whoToAsk: i.whoToAsk ?? null, explanation: i.explanation, explanationFalc: i.explanationFalc || i.explanation, provenance: i.provenance, basisFacts: Array.isArray(i.basisFacts) ? i.basisFacts : [], whyFr: i.whyFr ?? null, whyFalc: i.whyFalc ?? null })),
    },
    provenance: r.provenance ? { source: r.provenance.source ?? null, engineVersion: r.provenance.engineVersion ?? null, referenceDate: r.provenance.referenceDate ?? null, authoritative: false, dataStatus: 'UNVERIFIED' } : undefined,
    period: typeof r.period === 'string' ? r.period : undefined,
    meta: r.meta ? { source: r.meta.source, engineVersion: r.meta.engineVersion, referenceDate: r.meta.referenceDate, requestId: r.meta.requestId } : undefined,
  };
}

/** Fixed user-facing texts for failed requests: keyed on the error code, never on server-supplied free text. */
export function errorMessageFor(status, code) {
  if (code === 'invalid_json' || code === 'invalid_body' || code === 'validation_error') return 'Vérifiez les informations saisies (date de naissance, montants) puis réessayez.';
  if (status === 429 || code === 'rate_limit_exceeded') return 'Trop de demandes en peu de temps. Patientez un instant avant de réessayer.';
  if (status === 503 || code === 'OPENFISCA_UNAVAILABLE') return 'Le service est momentanément indisponible. Aucun résultat de remplacement n\'est affiché. Réessayez plus tard.';
  return 'Le service de diagnostic est temporairement indisponible. Réessayez plus tard.';
}
