// @ts-nocheck
/**
 * R15 (D10 / D20 / P13, owner directive 27/10/2026 § 4) — what the AUTHORITATIVE_MODE may say from a real OpenFisca computation (PURE: no I/O).
 *
 * An HTTP 200 from the engine is a computation on the situation it was GIVEN, not an entitlement. The diagnostic form does not ask for most of what the engine
 * needs (spouse, children's ages, pensions, MDPH rate, unemployment history, the other parent, the tax reference income, the commune), and buildTestCase fills
 * the gaps with defaults (a spouse born in 1990 with no income, children born in 2015, the engine's own defaults). So, per right:
 *   - a required input was not given        → INSUFFICIENT_INFORMATION, no amount, the missing inputs are named;
 *   - everything required was given, > 0     → INDICATIVE_ESTIMATE, an order of magnitude (10 € steps) under the stated assumptions, never « vous avez droit »;
 *   - everything required was given, = 0     → NOT_INDICATED_UNDER_ASSUMPTIONS (not « non éligible »: other resources or rules may change it).
 * Nothing here is authoritative: the rules are not expert-validated (D11) and only the competent organism decides.
 */
import { RIGHTS_CATALOG } from './openfiscaRightsCatalog.js';
import { ACTIVITE_MAP } from './openfiscaMapping.js';

export const ESTIMATE_CONTRACT = 'ADA_OPENFISCA_ESTIMATE_V1';

export const MISSING = Object.freeze({
  birthDate: 'votre date de naissance exacte',
  statut: 'votre situation professionnelle',
  income: 'vos revenus du mois (salaire, allocation chômage), même nuls',
  household: 'la composition exacte du foyer (conjoint, âge et revenus de chaque personne)',
  pension: 'le montant de vos pensions de retraite ou d’invalidité (non demandé par le formulaire)',
  housing: 'votre statut de locataire et le montant du loyer',
  commune: 'votre commune (code commune INSEE, qui fixe la zone de loyer)',
  disabilityRate: 'le taux d’incapacité reconnu par la MDPH (non demandé par le formulaire)',
  unemploymentHistory: 'votre parcours d’emploi et la fin de vos droits au chômage (non demandés par le formulaire)',
  otherParent: 'la situation de l’autre parent (non demandée par le formulaire)',
  taxReference: 'le revenu fiscal de référence du foyer (non demandé par le formulaire)',
});

/** Inputs each right needs before an order of magnitude may be shown. Rights not listed here are never estimated. */
const NEEDS = Object.freeze({
  rsa: ['birthDate', 'statut', 'income', 'household', 'pensionIfRetired'],
  prime_activite: ['birthDate', 'statut', 'income', 'household', 'pensionIfRetired'],
  apl: ['income', 'household', 'housing', 'commune', 'pensionIfRetired'],
  aide_logement: ['income', 'household', 'housing', 'commune', 'pensionIfRetired'],
  aspa: ['birthDate', 'income', 'household', 'pension'],
  ass: ['unemploymentHistory'],
  aah: ['disabilityRate'],
  af: ['household', 'income'],
  cf: ['household', 'income'],
  asf: ['otherParent'],
  bourse_college: ['taxReference'],
  css: ['income', 'household', 'pensionIfRetired'],
});

export const ASSUMPTIONS = Object.freeze([
  'Les revenus déclarés pour le mois sont supposés identiques sur les 24 mois précédents (le calcul en a besoin ; ce n’est pas vérifié).',
  'Le revenu imposable est approché par le revenu net déclaré : c’est une borne basse de vos ressources.',
  'Aucune autre ressource (pension, allocation, revenu du patrimoine, aide en cours) n’est prise en compte.',
  'Les règles sont celles de la version du moteur de calcul indiquée ; elles ne sont pas validées par un expert des droits sociaux.',
]);

const known = (v) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v));
const TENANT = new Set(['tenant', 'tenant_hlm', 'tenant_furnished']);
const RETIRED = new Set(['retraite', 'retraité']);

/** Only a one-person household is fully described by the form; anyone else (spouse, children) is filled with defaults by buildTestCase. */
function householdKnown(a) {
  if (a.has_conjoint || a.situation_familiale === 'couple') return false;
  const children = Number(a.nombre_enfants || (a.enfants || []).length || 0);
  const size = known(a.householdSize) ? Number(a.householdSize) : null;
  if (children > 0) {
    const all = (a.enfants || []).length === children && a.enfants.every((e) => e?.date_naissance || known(e?.age));
    return all && (size === null || size === 1 + children);
  }
  return size === 1;
}

/** @param {object} answers the request's answers @returns {Record<string, string[]>} right code → missing input keys */
export function missingInputs(answers) {
  const a = answers || {};
  const income = a.income || {}; const housing = a.housing || {};
  const retired = RETIRED.has(a.statut);
  const has = {
    birthDate: Boolean(a.birthDate),
    statut: Object.prototype.hasOwnProperty.call(ACTIVITE_MAP, a.statut),   // an unknown value is computed as « inactif » by buildTestCase
    income: known(income.salary) || known(income.unemployment),
    household: householdKnown(a),
    pension: false,                    // the form never asks for it (owner action R14.3)
    pensionIfRetired: !retired,
    housing: TENANT.has(housing.status) && known(housing.rent) && Number(housing.rent) > 0,
    commune: Boolean(a.depcom && /^(?:\d{5}|2[AB]\d{3})$/i.test(String(a.depcom))),
    disabilityRate: false, unemploymentHistory: false, otherParent: false, taxReference: false,
  };
  const out = {};
  for (const r of RIGHTS_CATALOG) {
    const needs = NEEDS[r.code];
    if (!needs) { out[r.code] = ['notSupported']; continue; }
    out[r.code] = [...new Set(needs.filter((k) => !has[k]).map((k) => (k === 'pensionIfRetired' ? 'pension' : k)))];
  }
  return out;
}

const orderOfMagnitude = (x) => (x > 0 ? Math.max(10, Math.round(x / 10) * 10) : 0);

/**
 * @param {Array<{code:string,label:string,category:string,amount:number}>} rights parseResults() output (engine values on the given test case)
 * @param {object} answers the request's answers
 * @param {{ period: string, computedAt?: string, engineVersion?: string|null }} ctx
 */
export function qualifyEstimates(rights, answers, ctx) {
  const missing = missingInputs(answers);
  const items = (rights || []).map((r) => {
    const gaps = missing[r.code] || ['notSupported'];
    const base = { code: r.code, label: r.label, category: r.category };
    if (gaps.length) {
      return { ...base, status: 'INSUFFICIENT_INFORMATION', monthlyOrderOfMagnitude: null,
        missing: gaps.map((k) => ({ key: k, label: MISSING[k] || 'cette aide n’est pas estimée par AccesDirectAide' })) };
    }
    const amount = orderOfMagnitude(Number(r.amount) || 0);
    return amount > 0
      ? { ...base, status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: amount, missing: [] }
      : { ...base, status: 'NOT_INDICATED_UNDER_ASSUMPTIONS', monthlyOrderOfMagnitude: null, missing: [] };
  });
  return {
    contract: ESTIMATE_CONTRACT,
    authoritative: false,
    period: ctx.period,
    computedAt: ctx.computedAt || new Date().toISOString(),
    engine: { name: 'openfisca-france', version: ctx.engineVersion || null },
    assumptions: ASSUMPTIONS,
    disclaimer: 'Ordre de grandeur calculé sur les seules informations données et les hypothèses indiquées. Ce n’est ni une décision ni une promesse : seul l’organisme compétent décide, sur votre dossier.',
    items,
  };
}

/**
 * The pro/admin trace (POST /api/diagnostic/trace, off unless OPENFISCA_ENABLE_TRACE=true) shows the engine's own computation graph of the situation buildTestCase
 * sent — completed with defaults for what the form does not ask. The response says so and carries the same per-right missing inputs as the estimates.
 * @param {object} answers @param {{ period: string, computedAt?: string, engineVersion?: string|null }} ctx
 */
export function traceQualification(answers, ctx) {
  return {
    contract: ESTIMATE_CONTRACT, authoritative: false, technicalTraceOnly: true, period: ctx.period, computedAt: ctx.computedAt || new Date().toISOString(),
    engine: { name: 'openfisca-france', version: ctx.engineVersion || null }, assumptions: ASSUMPTIONS, missingByRight: missingInputs(answers),
    notice: 'Trace technique réservée aux professionnels : la situation envoyée au moteur est complétée par des valeurs par défaut pour ce que le formulaire ne demande pas. Les valeurs de cette trace ne sont ni une estimation pour la personne, ni une décision, ni une promesse.',
  };
}
