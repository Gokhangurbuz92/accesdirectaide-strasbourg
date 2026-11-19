// @ts-nocheck
/**
 * Diagnostic-to-Action S1 stage 1 — result-state + provenance contract (PURE: no I/O, no clock, no randomness, no DB, no network).
 * Contract: docs/release/PRODUCT_FLOW_CONTRACT.md v0.3 (Dossier de Référence §8, ADR-006 — relayed excerpts, not read in full).
 *
 * Rules enforced here:
 *  - Only a validated AUTHORITATIVE engine/source may produce ELIGIBLE_WHERE_AUTHORITY_VERIFIED or NOT_APPLICABLE_WHERE_PROVEN.  This module never
 *    produces them from the local heuristic; `assertAssessmentItem` rejects them unless every authority field is present.
 *  - The local simulation (LocalRulesEngine, thresholds "NOT legal thresholds") is indicative pre-orientation.  Its rights-specific heuristic LEADS are
 *    DISABLED BY DEFAULT: with leads off, the heuristic outcome is not even read, so nothing about eligibility can leak.  With leads on, a heuristic hit is
 *    only POSSIBLE ("piste à vérifier"); a heuristic miss is CHECK_REQUIRED, never "not applicable".
 *  - No amount is ever carried (amount: null) unless authoritative.
 *  - Every item carries all five provenance fields (source, verifiedAt, territory, rule, uncertainty); absent values are explicit, never omitted/invented.
 *  - Wording never states or implies a right ("éligible", "vous avez droit", "non applicable", "officiel", montants).
 *  - PKG-6 / D20: every item explains « why this result » in two registers (whyFr, whyFalc): the state's reason, the answers it was based on (labels, never values),
 *    whether a validated rule was applied and whether an official source backs the result. With no validated rule / source (D11 open) it says so plainly.
 */
import { TERRITORY_SCOPES, territoryStatus } from './territoryScopes.js';
import { ageFromBand } from './ageBands.js';

export const STATES = Object.freeze({
  ELIGIBLE_WHERE_AUTHORITY_VERIFIED: 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED',
  POSSIBLE: 'POSSIBLE',
  MISSING_INFORMATION: 'MISSING_INFORMATION',
  CHECK_REQUIRED: 'CHECK_REQUIRED',
  NOT_APPLICABLE_WHERE_PROVEN: 'NOT_APPLICABLE_WHERE_PROVEN',
  UNSUPPORTED: 'UNSUPPORTED',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
});
export const AUTHORITATIVE_STATES = Object.freeze([STATES.ELIGIBLE_WHERE_AUTHORITY_VERIFIED, STATES.NOT_APPLICABLE_WHERE_PROVEN]);
export const NOT_AVAILABLE = 'NON_DISPONIBLE';
export const PROVENANCE_FIELDS = Object.freeze(['source', 'verifiedAt', 'territory', 'rule', 'uncertainty']);
export const UNCERTAINTY_LOCAL = 'ORIENTATION_NON_OFFICIELLE';   // provisional vocabulary (Q-N4 open)
export const AMOUNT_STATUS = 'NOT_PROVIDED_NO_AUTHORITY';

const WORDING_FORBIDDEN = /éligible|eligible|vous avez droit|avez droit|non applicable|règles? (de calcul )?officielle|montant estimé|estimation totale/i;

// Which facts a local right needs (names of `answers` paths).  Absent / unknown ("je ne sais pas" => null/''/'unknown') => MISSING_INFORMATION.
const NEEDS = Object.freeze({
  rsa: ['birthDate', 'householdSize', 'income'],
  apl: ['housing.status', 'housing.rent'],
  'faj-strasbourg': ['birthDate', 'territory'],
});
// Who to ask: ONLY organism types already named by the existing engine/UI strings (LocalRulesEngine explain texts: "La CAF doit vérifier", "Un professionnel peut vérifier").
const WHO_TO_ASK = Object.freeze({ rsa: 'votre CAF', apl: 'votre CAF', 'faj-strasbourg': 'un professionnel (travailleur social ou structure d\'accompagnement)' });
// R34 / D20: the other rights of the research register (who decides, from its « decidedBy »), reached only through an expert-validated reading
const WHO_DECIDES = Object.freeze({ 'prime-activite': 'votre CAF ou votre MSA', aah: 'la MDPH', apa: 'la Collectivité européenne d\'Alsace (le Département)', are: 'France Travail', c2s: 'votre CPAM' });

// Labels of the facts (kept equal to src/lib/assessmentLabels.js MISSING_FACT_LABELS by tests/unit/pkg6-d20-why.test.js; this module stays import-free beyond its two data modules).
const FACT_LABELS = Object.freeze({ birthDate: 'date de naissance ou tranche d\'âge', householdSize: 'composition du foyer', income: 'revenus', 'housing.status': "statut d'occupation du logement", 'housing.rent': 'loyer', territory: 'commune ou code postal' });
export const FACT_KEYS = Object.freeze(Object.keys(FACT_LABELS));
const factList = (facts) => facts.map((f) => FACT_LABELS[f] || 'information à préciser').join(', ');

/** PKG-6 / D20 — « why this result », standard and FALC. Only labels of the answers, never their values. */
export function whyTexts(state, { basisFacts = [], missingFacts = [], provenance = {}, outsideTerritory = false } = {}) {
  const used = basisFacts.length ? factList(basisFacts) : null;
  const ruleFr = provenance.rule ? `Repère utilisé : ${provenance.rule}.` : 'Aucune règle validée par l\'organisme n\'a été appliquée par ADA.';
  const ruleFalc = provenance.rule ? 'ADA a utilisé un repère local. Ce repère n\'est pas une décision.' : 'ADA n\'a pas de règle validée pour décider.';
  const srcFr = provenance.source ? `Source : ${provenance.source}.` : 'Ce résultat ne s\'appuie sur aucune source officielle : c\'est une simulation locale.';
  const srcFalc = provenance.source ? `Source : ${provenance.source}.` : 'Il n\'y a pas de source officielle pour ce résultat.';
  if (state === STATES.MISSING_INFORMATION) return {
    whyFr: `Il manque des réponses pour orienter : ${factList(missingFacts)}. ${ruleFr} ${srcFr}`,
    whyFalc: `Il manque des réponses : ${factList(missingFacts)}. ${srcFalc}` };
  if (state === STATES.UNSUPPORTED) return outsideTerritory
    ? { whyFr: `ADA n'a pas de règle pour votre territoire (code postal indiqué). ${srcFr}`, whyFalc: `ADA ne connaît pas cette aide pour votre code postal. ${srcFalc}` }
    : { whyFr: `ADA n'a pas encore de règle pour ce dispositif ; aucune réponse n'a été évaluée. ${srcFr}`, whyFalc: `ADA ne connaît pas encore cette aide. ${srcFalc}` };
  if (state === STATES.ENGINE_UNAVAILABLE) return { whyFr: 'Le service de calcul n\'a pas répondu : aucun résultat n\'a été produit, aucun résultat de remplacement n\'est montré.', whyFalc: 'Le service de calcul ne répond pas. ADA ne montre rien à la place.' };
  const lead = state === STATES.POSSIBLE ? 'Un repère local non légal signale une piste.' : 'ADA ne tranche pas.';
  const leadFalc = state === STATES.POSSIBLE ? 'C\'est une piste. Ce n\'est pas une décision.' : 'ADA ne décide pas.';
  return {
    whyFr: `Réponses prises en compte : ${used || 'aucune'}. ${lead} ${ruleFr} ${srcFr} Seul l'organisme compétent peut décider.`,
    whyFalc: `ADA a lu vos réponses : ${used || 'aucune'}. ${leadFalc} ${ruleFalc} ${srcFalc} Seul l'organisme peut décider.` };
}

const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const known = (v) => v !== undefined && v !== null && v !== '' && v !== 'unknown';

function hasFact(answers, fact) {
  if (fact === 'income') return known(get(answers, 'income.salary')) || known(get(answers, 'income.unemployment'));
  if (fact === 'territory') return known(answers?.territory) || known(answers?.zipCode);
  if (fact === 'birthDate') return known(get(answers, 'birthDate')) || ageFromBand(answers?.ageBand) !== null;   // DTA S2B: an age band is enough to orient
  return known(get(answers, fact));
}

const prov = (p = {}) => {
  const out = {
    source: p.source ?? null,
    verifiedAt: p.verifiedAt ?? null,
    territory: p.territory ?? null,
    rule: p.rule ?? null,
    uncertainty: p.uncertainty ?? null,
  };
  const label = {
    source: out.source ?? 'Source : aucune — simulation locale, pas une source officielle',
    verifiedAt: out.verifiedAt ?? 'Vérifié le : non vérifié',
    territory: out.territory ?? 'Territoire : non précisé',
    rule: out.rule ?? 'Règle : aucune règle officielle appliquée (repère indicatif local)',
    uncertainty: out.uncertainty ?? 'Incertitude : non évaluée',
  };
  return { ...out, display: label };
};

const TEXT = Object.freeze({
  [STATES.CHECK_REQUIRED]: {
    fr: (who) => `Ceci est une pré-orientation indicative : ce n'est ni une réponse ni un refus. Faites vérifier votre situation auprès de ${who}.`,
    falc: (who) => `Ce résultat n'est pas une décision. Demandez à ${who} de regarder votre situation.`,
  },
  [STATES.POSSIBLE]: {
    fr: (who) => `Piste à vérifier : votre situation pourrait mériter un examen. Ce n'est pas une décision. Faites-la vérifier auprès de ${who}.`,
    falc: (who) => `C'est une idée à vérifier. Ce n'est pas une décision. Demandez à ${who}.`,
  },
  [STATES.MISSING_INFORMATION]: {
    fr: () => 'Il manque des informations pour orienter votre demande. Vous pouvez répondre « je ne sais pas » ; un professionnel pourra vous aider.',
    falc: () => 'Il manque des informations. Vous pouvez dire « je ne sais pas ». Un professionnel peut vous aider.',
  },
  [STATES.UNSUPPORTED]: {
    fr: () => 'ADA ne dispose pas encore de règle vérifiée pour ce dispositif. Rien n\'est affirmé à son sujet.',
    falc: () => 'ADA ne sait pas encore vous répondre pour cette aide.',
  },
  [STATES.ENGINE_UNAVAILABLE]: {
    fr: () => 'Le service de calcul officiel est momentanément indisponible. Aucun résultat de remplacement n\'est affiché. Réessayez plus tard.',
    falc: () => 'Le service ne marche pas en ce moment. Réessayez plus tard.',
  },
});

function item(code, label, state, extra = {}) {
  const who = extra.whoToAsk ?? null;
  const t = TEXT[state];
  return {
    code,
    label,
    state,
    authoritative: false,
    amount: null,
    amountStatus: AMOUNT_STATUS,
    missingFacts: extra.missingFacts ?? [],
    whoToAsk: who,
    explanation: extra.explanation ?? t.fr(who ?? 'un organisme compétent'),
    explanationFalc: extra.explanationFalc ?? t.falc(who ?? 'un organisme compétent'),
    provenance: prov(extra.provenance),
    basisFacts: extra.basisFacts ?? [],
    ...whyTexts(state, { basisFacts: extra.basisFacts ?? [], missingFacts: extra.missingFacts ?? [], provenance: extra.provenance ?? {}, outsideTerritory: extra.outsideTerritory === true }),
  };
}

/**
 * @param {{ simulation?: object, answers?: object, leadsEnabled?: boolean, dataStatus?: string, unsupportedRights?: Array<{code:string,label:string,reason?:string}>, territory?: string }} input
 *   simulation  = result of runLocalSimulation (read ONLY when leadsEnabled === true)
 *   dataStatus  = status of the launch-data manifest ('UNVERIFIED' default); carried as a banner field, never as a verification claim
 */
/**
 * R31 (D11 → D20 → P13): `ruleReadings` are the readings of rights that passed the expert-validation gate (api/lib/validatedRules.js, computed by the caller:
 * this module stays pure and never reads the register). Empty today. A reading only ever yields POSSIBLE or CHECK_REQUIRED, with its rule and official page.
 */
export function buildAssessment({ simulation, answers = {}, leadsEnabled: leadsInput = false, dataStatus = 'UNVERIFIED', unsupportedRights = [], referenceDate = null, ruleReadings = {} } = {}) {
  const leadsEnabled = leadsInput === true;                                            // strict: truthy values ('true', 1, {}) do NOT enable leads
  const items = [];
  const local = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: UNCERTAINTY_LOCAL };
  const byCode = new Map(((leadsEnabled && simulation && Array.isArray(simulation.rights)) ? simulation.rights : []).map((r) => [r.code, r]));
  for (const [code, facts] of Object.entries(NEEDS)) {
    const label = { rsa: 'RSA', apl: 'APL', 'faj-strasbourg': "FAJ'EMS" }[code];
    const missing = facts.filter((f) => !hasFact(answers, f));
    // DTA S2A (A6): a territory-bound right needs a READABLE territory (5-digit postal code or 2-digit département); anything else is "missing"
    const scope = TERRITORY_SCOPES[code];
    const tStatus = scope ? territoryStatus(code, answers?.territory ?? answers?.zipCode) : 'NO_SCOPE';
    if (scope && tStatus === 'UNKNOWN' && !missing.includes('territory')) missing.push('territory');
    if (missing.length) { items.push(item(code, label, STATES.MISSING_INFORMATION, { missingFacts: missing, basisFacts: facts.filter((f) => !missing.includes(f)), provenance: local })); continue; }
    const whoToAsk = WHO_TO_ASK[code];
    if (scope && tStatus === 'OUTSIDE') {
      // not a refusal and not "not applicable" (nothing authoritative proves it): ADA simply has no rule for this territory
      items.push(item(code, label, STATES.UNSUPPORTED, {
        whoToAsk: 'votre commune ou votre CAF', outsideTerritory: true, basisFacts: ['territory'],
        explanation: `Cette aide est proposée sur le territoire suivant : ${scope.territory_scope} (information du catalogue, non vérifiée). D'après votre code postal, ADA n'a pas de règle pour votre territoire. Ce n'est ni une décision ni un refus : demandez à votre commune ou à votre CAF.`,
        explanationFalc: `Cette aide est pour : ${scope.territory_scope}. ADA ne sait pas vous répondre pour votre code postal. Demandez à votre commune ou à votre CAF.`,
        provenance: { ...local, territory: `Territoire : ${scope.territory_scope} (déclaré par le catalogue, non vérifié)`, rule: 'Règle : territoire de l\'aide non couvert par ADA pour ce code postal (donnée du catalogue, non vérifiée)' },
      }));
      continue;
    }
    const reading = ruleReadings && Object.prototype.hasOwnProperty.call(ruleReadings, code) ? ruleReadings[code] : null;
    if (reading) { items.push(readingItem(code, label, whoToAsk, facts, reading, local)); continue; }
    const hit = byCode.get(code);
    // leads disabled (default) => the heuristic is not read at all; enabled => a hit is only a lead, a miss is never "not applicable"
    const state = (leadsEnabled && hit && hit.eligible === true) ? STATES.POSSIBLE : STATES.CHECK_REQUIRED;
    const inArea = scope && tStatus === 'DECLARED_AREA';
    items.push(item(code, label, state, {
      whoToAsk,
      basisFacts: facts,
      ...(inArea ? {
        explanation: `${TEXT[state].fr(whoToAsk)} Cette aide est proposée sur le territoire suivant : ${scope.territory_scope} (information du catalogue, non vérifiée) : l'appartenance de votre commune à ce territoire est à faire vérifier.`,
        explanationFalc: `${TEXT[state].falc(whoToAsk)} Cette aide est pour : ${scope.territory_scope}. Demandez si votre commune est concernée.`,
      } : {}),
      provenance: { ...local, ...(inArea ? { territory: `Territoire : ${scope.territory_scope} (déclaré par le catalogue, non vérifié ; commune à vérifier)` } : {}), rule: leadsEnabled && hit ? `${hit.calculation_basis || 'HEURISTIC_LOCAL'} (repère local non légal)` : null },
    }));
  }
  // R34 / D20: every right of the register whose rule passed the expert gate shows its reading — before, only rsa, apl and faj-strasbourg could; prime
  // d'activité, AAH and C2S produced no item and ARE / APA kept « Aucune règle vérifiée dans ADA », which a validated rule would have made false
  const readingOf = (code) => (ruleReadings && Object.prototype.hasOwnProperty.call(ruleReadings, code) ? ruleReadings[code] : null);
  for (const [code, reading] of Object.entries(ruleReadings || {})) {
    if (Object.prototype.hasOwnProperty.call(NEEDS, code) || !reading) continue;
    const who = WHO_DECIDES[code] || 'l\'organisme qui décide';
    items.push(readingItem(code, String(reading.label || code), who, FACT_KEYS.filter((f) => hasFact(answers, f)), reading, local));
  }
  for (const u of unsupportedRights) if (!readingOf(String(u.code))) items.push(item(String(u.code), String(u.label), STATES.UNSUPPORTED, { provenance: { ...local, rule: u.reason ?? null } }));
  items.forEach(assertAssessmentItem);
  return {
    contract: 'ADA_ASSESSMENT_CONTRACT_V1',
    authoritative: false,
    leadsEnabled: Boolean(leadsEnabled),
    dataStatus: dataStatus === 'VERIFIED_CURRENT' ? 'VERIFIED_CURRENT' : 'UNVERIFIED',   // anything but an explicit manifest verdict stays UNVERIFIED
    referenceDate,
    totals: null,                                                                       // never a summed estimate
    items,
  };
}

/** An item from an expert-validated rule reading: never a decision; says which conditions the answers meet, do not meet, or cannot tell. */
function readingItem(code, label, whoToAsk, facts, reading, local) {
  const all = reading.notMet.length === 0 && reading.unknown.length === 0;
  const state = all ? STATES.POSSIBLE : STATES.CHECK_REQUIRED;
  const parts = [];
  if (all) parts.push('D’après vos réponses, les conditions de la règle relue par un expert sont remplies.');
  if (reading.notMet.length) parts.push(`D’après vos réponses, une condition de la règle relue ne semble pas remplie : ${reading.notMet.join(' ; ')}. Ce n’est pas un refus.`);
  if (reading.unknown.length) parts.push(`Vos réponses ne permettent pas de vérifier : ${reading.unknown.join(' ; ')}.`);
  const falc = all ? 'Vos réponses correspondent à la règle.' : reading.notMet.length ? 'Une condition ne semble pas remplie. Ce n’est pas un refus.' : 'Certaines conditions sont à vérifier.';
  return item(code, label, state, {
    whoToAsk, basisFacts: facts,
    explanation: `${TEXT[state].fr(whoToAsk)} ${parts.join(' ')}`,
    explanationFalc: `${TEXT[state].falc(whoToAsk)} ${falc}`,
    provenance: { ...local, rule: reading.rule, source: reading.source, verifiedAt: reading.verifiedAt, uncertainty: 'ORIENTATION_REGLE_RELUE' },
  });
}

/** Authoritative engine configured but down (e.g. OpenFisca 503): NO fallback item, NO local result. */
export function engineUnavailableAssessment({ retryable = true } = {}) {
  const it = item('engine', 'Service de calcul', STATES.ENGINE_UNAVAILABLE, { provenance: { uncertainty: 'AUCUN_RESULTAT' } });
  assertAssessmentItem(it);
  return { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', retryable: Boolean(retryable), totals: null, items: [it] };
}

/** Invariant check used by the builders and by tests; throws on any violation. */
export function assertAssessmentItem(it) {
  const fail = (m) => { throw new Error(`assessment contract violation [${it && it.code}]: ${m}`); };
  if (!it || typeof it !== 'object') fail('item must be an object');
  if (!Object.values(STATES).includes(it.state)) fail(`unknown state ${it.state}`);
  for (const f of PROVENANCE_FIELDS) {
    if (!(f in (it.provenance || {}))) fail(`provenance.${f} missing`);
    if (typeof it.provenance?.display?.[f] !== 'string' || !it.provenance.display[f]) fail(`provenance.display.${f} missing`);
  }
  if (AUTHORITATIVE_STATES.includes(it.state)) {
    const p = it.provenance;
    if (it.authoritative !== true || !p.source || !p.verifiedAt || !p.territory || !p.rule) fail('authoritative state without authority, source, verifiedAt, territory and rule');
  } else {
    if (it.authoritative !== false) fail('non-authoritative state must carry authoritative:false');
    if (it.amount !== null) fail('amount must be null without authority');
    if (it.amountStatus !== AMOUNT_STATUS) fail('amountStatus must be NOT_PROVIDED_NO_AUTHORITY');
  }
  if (!Array.isArray(it.basisFacts)) fail('basisFacts must be an array (labels of the answers used, never values)');
  for (const k of ['explanation', 'explanationFalc', 'whyFr', 'whyFalc']) {
    if (typeof it[k] !== 'string' || !it[k]) fail(`${k} missing`);
    if (!AUTHORITATIVE_STATES.includes(it.state) && WORDING_FORBIDDEN.test(it[k])) fail(`${k} uses forbidden wording`);
  }
  return true;
}
