// @ts-nocheck
/**
 * PKG-6 / D11 — DRAFT reading of the research register (data/rules/rights-rules.v1.json), condition by condition. PURE: no I/O beyond the register passed in.
 *   - It never says « eligible » or « not eligible » for a right: it only reports, per cited condition, MET / NOT_MET / UNKNOWN from the facts given, with the
 *     condition's source and the register status. A right with conditions it cannot read (most of them: residence, nationality, activity…) stays UNKNOWN on those.
 *   - It is NOT a rule of the product: while a right is not EXPERT_VALIDATED, nothing user-facing calls it (api/lib/assessmentContract.js does not import it,
 *     pinned by tests/unit/pkg6-d11-rules-draft.test.js). Its use today: the expert review pack (scripts/d11-review-pack.mjs) and the proposed reference cases.
 * Facts: { ageRange?: [lo, hi] (exact age = [a, a]; an age band = its bounds), territory?: postal code, housing?: { status }, annualResources?: number (€),
 *          householdSize?: number, children?: number, area?: 'metropole' | 'outre-mer' }.
 */
import { territoryStatus } from './territoryScopes.js';

export const RESULTS = Object.freeze({ MET: 'MET', NOT_MET: 'NOT_MET', UNKNOWN: 'UNKNOWN' });
const r = (result, note = null) => ({ result, note });

/** Bounds of a declared age band (src/lib/assessmentLabels AGE_BAND_LABELS keys) for the draft reading; null when unknown. */
export function ageRangeOfBand(band) {
  return { 'moins-de-18': [0, 17], '18-24': [18, 24], '25-59': [25, 59], '60-et-plus': [60, 130] }[band] || null;
}

function check(c, facts) {
  const k = c.kind;
  const age = Array.isArray(facts.ageRange) && facts.ageRange.length === 2 && facts.ageRange.every(Number.isFinite) ? facts.ageRange : null;
  if (k === 'ageAtLeast') {
    if (!age) return r('UNKNOWN', 'âge non renseigné');
    const [lo, hi] = age;
    if (lo >= c.min) return r('MET');
    if (hi < (c.softMin ?? c.min)) return r(c.below, c.below === 'UNKNOWN' ? c.note || null : null);
    return r('UNKNOWN', c.note || 'la tranche d\'âge déclarée chevauche le seuil');   // the declared range straddles the threshold, or lies in the soft zone
  }
  if (k === 'ageBetween') {
    if (!age) return r('UNKNOWN', 'âge non renseigné');
    const [lo, hi] = age;
    if (hi < c.min || lo > c.max) return r('NOT_MET');
    if (lo >= c.min && hi < c.max) return r('MET');
    if (lo < c.min) return r('UNKNOWN', 'la tranche d\'âge déclarée chevauche le seuil minimal');
    return r(c.atMax || 'UNKNOWN', c.note || null);   // the range reaches the upper bound c.max, whose inclusion the source leaves open
  }
  if (k === 'territoryScope') {
    const t = territoryStatus(c.scope, facts.territory);
    if (t === 'OUTSIDE') return r('NOT_MET');
    return r('UNKNOWN', t === 'DECLARED_AREA' ? c.note : 'commune ou code postal non renseigné');
  }
  if (k === 'oneOf') {
    const v = String((c.fact.split('.').reduce((o, p) => (o == null ? undefined : o[p]), facts)) ?? '');
    if (!v) return r('UNKNOWN', 'réponse non renseignée');
    return c.met.includes(v) ? r('MET') : r(c.otherwise || 'UNKNOWN', c.note || null);
  }
  if (k === 'annualResourcesBands') {
    if (!Number.isFinite(facts.annualResources)) return r('UNKNOWN', 'ressources non renseignées');
    if (facts.householdSize !== c.householdSize || (facts.area || 'metropole') !== c.area) return r('UNKNOWN', c.note);
    const band = c.bands.find((b) => facts.annualResources <= b.max);
    return band ? r(band.result, band.note) : r(c.above);
  }
  if (k === 'annualResourcesCeiling') {
    if (!Number.isFinite(facts.annualResources)) return r('UNKNOWN', 'ressources non renseignées');
    const ceiling = c.byChildren[String(facts.children ?? 0)];
    if (ceiling === undefined) return r('UNKNOWN', c.note);
    return facts.annualResources <= ceiling ? r('MET') : r(c.above);
  }
  return r('UNKNOWN', 'condition non lisible automatiquement');
}

/**
 * @param {any} register the parsed research register
 * @param {string} rightId
 * @param {object} facts
 * @returns {{ right: string, status: string, authoritative: false, conditions: Array<{ fact: string, text: string, source: string, result: string, note: string|null, checked: boolean }> }}
 */
export function readConditions(register, rightId, facts = {}) {
  const right = (register?.rights || []).find((x) => x.id === rightId);
  if (!right) throw new Error(`unknown right ${rightId}`);
  return {
    right: right.id,
    status: right.status,
    authoritative: false,   // even an EXPERT_VALIDATED register does not make this reading a decision: the organism decides (right.decidedBy)
    conditions: right.conditions.map((c) => {
      const out = c.draftCheck ? check(c.draftCheck, facts) : r('UNKNOWN', 'condition non lisible à partir des réponses recueillies par ADA');
      return { fact: c.fact, text: c.text, source: c.source, result: out.result, note: out.note, checked: !!c.draftCheck };
    }),
  };
}
