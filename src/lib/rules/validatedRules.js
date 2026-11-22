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
  NON_HUMAN_REVIEWER: 'NON_HUMAN_REVIEWER', OWNER_REVIEW_IS_NOT_EXPERT: 'OWNER_REVIEW_IS_NOT_EXPERT',
});

/**
 * G14 (22/11/2026, owner decision): two validated statuses, never confused.
 *   - EXPERT_VALIDATED: a named qualified reviewer (expertReview), the original D11 path;
 *   - OWNER_VALIDATED: « relu et approuvé par le responsable du traitement, sur la base d'une analyse documentaire assistée par IA ; pas une validation
 *     d'expert indépendant » (ownerReview, kind 'owner'), set only by scripts/d11-review.mjs from a form with validation_kind=owner and a human reviewer.
 * An owner review can never make a right EXPERT_VALIDATED (OWNER_REVIEW_IS_NOT_EXPERT), and an AI never reviews (NON_HUMAN_REVIEWER).
 */
export const VALIDATED_STATUSES = Object.freeze(['EXPERT_VALIDATED', 'OWNER_VALIDATED']);
export const OWNER_REVIEW_BASIS = "relu et approuvé par le responsable du traitement, sur la base d'une analyse documentaire assistée par IA ; pas une validation d'expert indépendant";
/** the review that backs a validated status (expertReview or ownerReview), or null */
export const reviewOf = (right) => (right?.status === 'OWNER_VALIDATED' ? right.ownerReview : right?.status === 'EXPERT_VALIDATED' ? right.expertReview : null) || null;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * G14 (22/11/2026): an AI or automated « review » is an engineering input, never the D11 human approval. True when the reviewer named in a form row or in
 * expertReview is (or declares) an AI / a system, or when the row carries the columns of an AI review (ai_review_status, ai_confidence…). Fail-closed: a human
 * whose name or role trips it is asked to re-sign without the term; a real first name such as « Claude » alone does not trip it.
 * @param {Record<string, unknown>} row form row ({ reviewer_name, reviewer_role, … }) or expertReview ({ name, role, … })
 */
export function nonHumanReviewer(row = {}) {
  const who = `${row.reviewer_name ?? row.name ?? ''} | ${row.reviewer_role ?? row.role ?? ''}`;
  if (/(?<![\p{L}\d])(IA|AI|GPT|LLM|GenAI)(?![\p{L}])/u.test(who)) return true;
  if (/chat\s?gpt|gpt-?\d|openai|anthropic|claude\s*(?:ai|opus|sonnet|haiku|\d)|gemini|copilot|mistral\s*ai|llama|intelligence\s+artificielle|artificial\s+intelligence|syst[eè]me|system|automat|robot|(?<![\p{L}])bot(?![\p{L}])|machine|mod[eè]le de langage|language model/iu.test(who)) return true;
  for (const k of ['ai_review_status', 'ai_confidence', 'aiReviewStatus']) if (String(row[k] ?? '').trim()) return true;
  if (/absente|absent|not signed|non sign/i.test(String(row.human_signature_status ?? ''))) return true;
  return false;
}
/** @returns {{ code: string, passes: boolean, reasons: string[] }} */
export function gateStatus(register, code) {
  const R = GATE_REASONS;
  const right = (register?.rights || []).find((r) => r.id === code);
  if (!right) return { code, passes: false, reasons: [R.UNKNOWN_RIGHT] };
  const reasons = [];
  const validatedStatus = VALIDATED_STATUSES.includes(right.status);
  if (!validatedStatus) reasons.push(R.NOT_EXPERT_VALIDATED);
  const rev = validatedStatus ? reviewOf(right) : right.expertReview;
  const reviewOk = Boolean(rev && String(rev.name || '').trim() && String(rev.role || '').trim() && ISO.test(String(rev.date || '')));
  if (validatedStatus && !reviewOk) reasons.push(R.REVIEWER_INCOMPLETE);
  if (rev && nonHumanReviewer(rev)) reasons.push(R.NON_HUMAN_REVIEWER);   // G14: an AI / system review never opens the gate
  // G14: the two kinds never mix — an owner review cannot stand for an expert one, and an owner status needs an explicit owner review
  if (right.status === 'EXPERT_VALIDATED' && (right.expertReview?.kind === 'owner' || right.ownerReview)) reasons.push(R.OWNER_REVIEW_IS_NOT_EXPERT);
  if (right.status === 'OWNER_VALIDATED' && (right.ownerReview?.kind !== 'owner' || right.expertReview)) reasons.push(R.OWNER_REVIEW_IS_NOT_EXPERT);
  const sources = Array.isArray(right.sources) ? right.sources : [];
  if (!sources.length || !sources[0]?.url) reasons.push(R.NO_SOURCE);
  if (validatedStatus) {
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
  // G14: the reading date, so an amount-bearing check is read only inside the window its source dates (rulesDraft effectiveFrom / staleAfter)
  const day = referenceDate ? new Date(referenceDate) : new Date();
  return { ageRange, territory: answers.territory ?? answers.zipCode ?? null, housing: answers.housing ? { status: answers.housing.status } : undefined,
    householdSize: Number.isFinite(Number(answers.householdSize)) ? Number(answers.householdSize) : undefined,
    referenceDate: Number.isFinite(day.getTime()) ? day.toISOString().slice(0, 10) : undefined };
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
    const rev = reviewOf(right);
    const owner = right.status === 'OWNER_VALIDATED';
    const day = rev.date.split('-').reverse().join('/');
    out[right.id] = {
      // G14: an owner-approved rule never says « expert »: « règle relue par l'équipe ADA », and the organism decides
      rule: owner
        ? `règle « ${right.label} » du registre ADA (${register.builtAt}), relue par l'équipe ADA le ${day} à partir des pages officielles (analyse documentaire assistée par IA, sans expert indépendant) ; l'organisme décide`
        : `règle « ${right.label} » du registre ADA (${register.builtAt}), relue par ${rev.role} le ${day}`,
      validation: owner ? 'OWNER' : 'EXPERT',
      source: `${page.url}${page.pageVerifiedOn ? ` (page vérifiée le ${page.pageVerifiedOn.split('-').reverse().join('/')})` : ''}`,
      verifiedAt: rev.date,
      label: right.label, decidedBy: right.decidedBy || null,
      met: by(RESULTS.MET), notMet: by(RESULTS.NOT_MET), unknown: by(RESULTS.UNKNOWN),
    };
  }
  return out;
}
