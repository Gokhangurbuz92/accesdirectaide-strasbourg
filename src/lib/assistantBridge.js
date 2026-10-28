import { readAssessment } from '@/lib/assessmentLabels';

/**
 * R13 (D17) — the result page hands the person's pistes to the Boussole Sociale, on the person's request only. The server already took a read-only assessment
 * (PKG-6 N14: explained, never changed, an eligibility promise is replaced by an abstention) but no page ever sent one. What leaves the page: for each piste its
 * code and its state — no situation, no amount, no name — at most 20 (the server's limit). Nothing is stored by the assistant.
 */
export const ASSISTANT_OPEN_EVENT = 'ada:assistant-open';

/** @param {unknown} results @returns {Array<{ rightId: string, state: string }>} */
export function assessmentForAssistant(results) {
  return readAssessment(results).items.slice(0, 20).map((/** @type {any} */ i) => ({ rightId: String(i.code).slice(0, 80), state: String(i.state).slice(0, 40) }));
}

/** Opens the assistant with the pistes attached. @param {unknown} results @returns {boolean} false when there is nothing to attach */
export function openAssistantWithAssessment(results) {
  const assessment = assessmentForAssistant(results);
  if (!assessment.length) return false;
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { assessment } }));
  return true;
}
