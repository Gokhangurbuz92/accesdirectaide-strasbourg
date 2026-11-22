// @ts-nocheck
/**
 * PKG-6 / D11 — DRAFT reading of the research register (data/rules/rights-rules.v1.json), condition by condition. PURE: no I/O beyond the register passed in.
 *   - It never says « eligible » or « not eligible » for a right: it only reports, per cited condition, MET / NOT_MET / UNKNOWN from the facts given, with the
 *     condition's source and the register status. A right with conditions it cannot read (most of them: residence, nationality, activity…) stays UNKNOWN on those.
 *   - It is NOT a rule of the product: while a right is not EXPERT_VALIDATED, nothing user-facing calls it (api/lib/assessmentContract.js does not import it,
 *     pinned by tests/unit/pkg6-d11-rules-draft.test.js). Its use today: the expert review pack (scripts/d11-review-pack.mjs) and the proposed reference cases.
 * Facts: { ageRange?: [lo, hi] (exact age = [a, a]; an age band = its bounds), territory?: postal code, housing?: { status }, annualResources?: number (€),
 *          householdSize?: number, children?: number, area?: 'metropole' | 'outre-mer', resourcesBasis?: string, referenceDate?: 'YYYY-MM-DD' }.
 * G14 (22/11/2026, D11 corrections from the source re-read of that day):
 *   - a check holding an amount carries the date the official source gives for it (effectiveFrom) and a re-read date (staleAfter): a reading dated before
 *     effectiveFrom, or on/after staleAfter, is UNKNOWN (the amount is not, or no longer, the one in force) — an amount without a source date has no check at all;
 *   - requiresBasis: a resources check compares only a figure declared on the basis the source names (e.g. the AAH « revenu net catégoriel » N-2); any other
 *     figure (or none declared) is UNKNOWN, never MET nor NOT_MET;
 *   - metNote: a MET may carry a caveat (FAJ: « tranche d'âge annoncée par la page »), so a partial MET is never read as more than it is.
 */
import { territoryStatus } from './territoryScopes.js';

export const RESULTS = Object.freeze({ MET: 'MET', NOT_MET: 'NOT_MET', UNKNOWN: 'UNKNOWN' });
const r = (result, note = null) => ({ result, note });

/** Bounds of a declared age band (src/lib/assessmentLabels AGE_BAND_LABELS keys) for the draft reading; null when unknown. */
export function ageRangeOfBand(band) {
  return { 'moins-de-18': [0, 17], '18-24': [18, 24], '25-59': [25, 59], '60-et-plus': [60, 130] }[band] || null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** the dated window of an amount-bearing check: null when the reading may use it, else the UNKNOWN reason */
function outsideWindow(c, facts) {
  const day = ISO_DAY.test(String(facts.referenceDate || '')) ? facts.referenceDate : null;
  if (!day) return null;
  if (c.effectiveFrom && day < c.effectiveFrom) return `barème en vigueur à partir du ${c.effectiveFrom} seulement : à vérifier pour une date antérieure`;
  if (c.staleAfter && day >= c.staleAfter) return `barème du ${c.effectiveFrom || '?'} à relire (revalorisation attendue) : à vérifier`;
  return null;
}
/** the resources figure is comparable only when declared on the basis the source names */
function basisMismatch(c, facts) {
  if (!c.requiresBasis) return null;
  return facts.resourcesBasis === c.requiresBasis ? null : (c.basisNote || `ressources à comparer seulement sur la base « ${c.requiresBasis} »`);
}

function check(c, facts) {
  const k = c.kind;
  const met = () => r('MET', c.metNote || null);
  const age = Array.isArray(facts.ageRange) && facts.ageRange.length === 2 && facts.ageRange.every(Number.isFinite) ? facts.ageRange : null;
  if (k === 'ageAtLeast') {
    if (!age) return r('UNKNOWN', 'âge non renseigné');
    const [lo, hi] = age;
    if (lo >= c.min) return met();
    if (hi < (c.softMin ?? c.min)) return r(c.below, c.below === 'UNKNOWN' ? c.note || null : null);
    return r('UNKNOWN', c.note || 'la tranche d\'âge déclarée chevauche le seuil');   // the declared range straddles the threshold, or lies in the soft zone
  }
  if (k === 'ageBetween') {
    if (!age) return r('UNKNOWN', 'âge non renseigné');
    const [lo, hi] = age;
    if (hi < c.min || lo > c.max) return r('NOT_MET');
    if (lo >= c.min && hi < c.max) return met();
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
    return c.met.includes(v) ? met() : r(c.otherwise || 'UNKNOWN', c.note || null);
  }
  if (k === 'annualResourcesBands') {
    if (!Number.isFinite(facts.annualResources)) return r('UNKNOWN', 'ressources non renseignées');
    const late = outsideWindow(c, facts); if (late) return r('UNKNOWN', late);
    const basis = basisMismatch(c, facts); if (basis) return r('UNKNOWN', basis);
    let bands = null;
    if (c.byArea) {
      // G14: ceilings by area and household size (sizes listed, then « par personne supplémentaire » added per extra person)
      const t = c.byArea[facts.area || 'metropole'];
      const n = facts.householdSize;
      if (t && Number.isInteger(n) && n >= 1) {
        const top = Math.max(...Object.keys(t.bySize).map(Number));
        const base = t.bySize[String(Math.min(n, top))];
        const extra = Math.max(0, n - top);
        if (base && (extra === 0 || t.perExtra)) bands = base.map((b, i) => ({ ...b, max: b.max + extra * (t.perExtra?.[i] ?? 0) }));
      }
    } else if (facts.householdSize === c.householdSize && (facts.area || 'metropole') === c.area) bands = c.bands;
    if (!bands) return r('UNKNOWN', c.note);
    const band = bands.find((b) => facts.annualResources <= b.max);
    return band ? r(band.result, band.note) : r(c.above, c.aboveNote || null);
  }
  if (k === 'annualResourcesCeiling') {
    if (!Number.isFinite(facts.annualResources)) return r('UNKNOWN', 'ressources non renseignées');
    const late = outsideWindow(c, facts); if (late) return r('UNKNOWN', late);
    const basis = basisMismatch(c, facts); if (basis) return r('UNKNOWN', basis);
    const ceiling = c.byChildren[String(facts.children ?? 0)];
    if (ceiling === undefined) return r('UNKNOWN', c.note);
    return facts.annualResources <= ceiling ? met() : r(c.above, c.aboveNote || null);
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
