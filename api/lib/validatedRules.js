// @ts-nocheck
/**
 * D11 → D20 → P13 (R31) — the ONLY gate through which a rule of the research register (data/rules/rights-rules.v1.json) may reach a person's result.
 *
 * A right passes the gate only when ALL of these hold:
 *   - status EXPERT_VALIDATED, set by scripts/d11-apply-review.mjs from a completed expert review form;
 *   - expertReview names the reviewer's name, role and date;
 *   - at least one expert-accepted reference case is recorded, and every recorded case gives its expected result with readConditions (re-checked on every
 *     call, so a later edit of a condition that breaks a validated case closes the gate again).
 * Today no right passes (no expert review has taken place): every result stays what it was — non-authoritative, « à faire vérifier ».
 *
 * Even through the gate a reading is never a decision. It can only make an item POSSIBLE (every condition met by the answers) or CHECK_REQUIRED (a condition
 * not met, or conditions the answers cannot tell), with the rule, the official page and the review date in its provenance. The organism decides;
 * NOT_APPLICABLE_WHERE_PROVEN and ELIGIBLE_WHERE_AUTHORITY_VERIFIED stay reserved to an authoritative engine.
 */
import { readConditions, RESULTS } from './rulesDraft.js';

const sameExpected = (reading, expected) => Object.entries(expected || {}).every(([fact, want]) => reading.conditions.find((c) => c.fact === fact)?.result === want);

/** @returns {any | null} the right when it passes the gate, else null */
export function validatedRight(register, code) {
  const right = (register?.rights || []).find((r) => r.id === code);
  if (!right || right.status !== 'EXPERT_VALIDATED') return null;
  const rev = right.expertReview;
  if (!rev || !String(rev.name || '').trim() || !String(rev.role || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(rev.date || ''))) return null;
  const cases = Array.isArray(right.referenceCases) ? right.referenceCases : [];
  if (!cases.length || !cases.every((c) => c.acceptedBy && sameExpected(readConditions(register, code, c.facts), c.expected))) return null;
  return right;
}

/** the facts the register's checks read, from the diagnostic's answers (labels of the answers only ever leave this module, never values) */
export function factsFromAnswers(answers = {}, referenceDate = null) {
  let age = null;
  if (answers.birthDate) {
    const b = new Date(answers.birthDate); const ref = referenceDate ? new Date(referenceDate) : new Date();
    if (Number.isFinite(b.getTime())) age = ref.getUTCFullYear() - b.getUTCFullYear() - (ref.getUTCMonth() < b.getUTCMonth() || (ref.getUTCMonth() === b.getUTCMonth() && ref.getUTCDate() < b.getUTCDate()) ? 1 : 0);
  }
  const band = { 'moins-de-18': [0, 17], '18-24': [18, 24], '25-59': [25, 59], '60-et-plus': [60, 130] }[answers.ageBand] || null;
  const ageRange = age !== null && age >= 0 ? [age, age] : band;
  return { ageRange, territory: answers.territory ?? answers.zipCode ?? null, housing: answers.housing ? { status: answers.housing.status } : undefined,
    householdSize: Number.isFinite(Number(answers.householdSize)) ? Number(answers.householdSize) : undefined };
}

/**
 * Readings for the rights that pass the gate (an empty object today).
 * @returns {Record<string, { rule: string, source: string, verifiedAt: string, met: string[], notMet: string[], unknown: string[] }>}
 */
export function validatedReadings(register, answers = {}, referenceDate = null) {
  const out = {};
  for (const right of register?.rights || []) {
    if (!validatedRight(register, right.id)) continue;
    const reading = readConditions(register, right.id, factsFromAnswers(answers, referenceDate));
    const by = (res) => reading.conditions.filter((c) => c.result === res).map((c) => c.text);
    const page = right.sources[0];
    out[right.id] = {
      rule: `règle « ${right.label} » du registre ADA (${register.builtAt}), relue par ${right.expertReview.role} le ${right.expertReview.date.split('-').reverse().join('/')}`,
      source: `${page.url}${page.pageVerifiedOn ? ` (page vérifiée le ${page.pageVerifiedOn.split('-').reverse().join('/')})` : ''}`,
      verifiedAt: right.expertReview.date,
      met: by(RESULTS.MET), notMet: by(RESULTS.NOT_MET), unknown: by(RESULTS.UNKNOWN),
    };
  }
  return out;
}
