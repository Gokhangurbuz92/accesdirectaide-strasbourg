// @ts-nocheck
/**
 * D11 → D20 → P13 (R31) — the ONLY gate through which a rule of the research register (data/rules/rights-rules.v1.json) may reach a person's result.
 *
 * A right passes the gate only when ALL of these hold:
 *   - status EXPERT_VALIDATED, set by scripts/d11-review.mjs (applyForm) from a completed expert review form; scripts/d11-source-assert.mjs (R35) only checks texts and never sets it;
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

/**
 * R46 (D11): the gate, explained — why a right passes or not, in the fixed vocabulary below (the reviewer workflow and the status command show it; nothing
 * here is shown to a person). A right whose official page was revised AFTER its review lapses: the expert read an earlier text, so the right must be reviewed
 * again (scripts/d11-source-check.mjs records the page's new « Vérifié le » date in sources[].pageVerifiedOn).
 */
export const GATE_REASONS = Object.freeze({
  UNKNOWN_RIGHT: 'UNKNOWN_RIGHT', NOT_EXPERT_VALIDATED: 'NOT_EXPERT_VALIDATED', REVIEWER_INCOMPLETE: 'REVIEWER_INCOMPLETE', NO_ACCEPTED_CASE: 'NO_ACCEPTED_CASE',
  CASE_NOT_ACCEPTED: 'CASE_NOT_ACCEPTED', CASE_NO_LONGER_MATCHES: 'CASE_NO_LONGER_MATCHES', SOURCE_REVISED_AFTER_REVIEW: 'SOURCE_REVISED_AFTER_REVIEW', NO_SOURCE: 'NO_SOURCE',
});
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** @returns {{ code: string, passes: boolean, reasons: string[] }} */
export function gateStatus(register, code) {
  const R = GATE_REASONS;
  const right = (register?.rights || []).find((r) => r.id === code);
  if (!right) return { code, passes: false, reasons: [R.UNKNOWN_RIGHT] };
  const reasons = [];
  if (right.status !== 'EXPERT_VALIDATED') reasons.push(R.NOT_EXPERT_VALIDATED);
  const rev = right.expertReview;
  const reviewOk = Boolean(rev && String(rev.name || '').trim() && String(rev.role || '').trim() && ISO.test(String(rev.date || '')));
  if (right.status === 'EXPERT_VALIDATED' && !reviewOk) reasons.push(R.REVIEWER_INCOMPLETE);
  const sources = Array.isArray(right.sources) ? right.sources : [];
  if (!sources.length || !sources[0]?.url) reasons.push(R.NO_SOURCE);
  if (right.status === 'EXPERT_VALIDATED') {
    const cases = Array.isArray(right.referenceCases) ? right.referenceCases : [];
    if (!cases.length) reasons.push(R.NO_ACCEPTED_CASE);
    if (cases.some((c) => !c.acceptedBy)) reasons.push(R.CASE_NOT_ACCEPTED);
    if (cases.some((c) => c.acceptedBy && !sameExpected(readConditions(register, code, c.facts), c.expected))) reasons.push(R.CASE_NO_LONGER_MATCHES);
    if (reviewOk && sources.some((s) => ISO.test(String(s?.pageVerifiedOn || '')) && s.pageVerifiedOn > rev.date)) reasons.push(R.SOURCE_REVISED_AFTER_REVIEW);
  }
  return { code, passes: reasons.length === 0, reasons };
}

/** @returns {any | null} the right when it passes the gate, else null */
export function validatedRight(register, code) {
  if (!gateStatus(register, code).passes) return null;
  return (register?.rights || []).find((r) => r.id === code);
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
 * @returns {Record<string, { rule: string, source: string, verifiedAt: string, label: string, decidedBy: string | null, met: string[], notMet: string[], unknown: string[] }>}
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
      label: right.label, decidedBy: right.decidedBy || null,
      met: by(RESULTS.MET), notMet: by(RESULTS.NOT_MET), unknown: by(RESULTS.UNKNOWN),
    };
  }
  return out;
}
