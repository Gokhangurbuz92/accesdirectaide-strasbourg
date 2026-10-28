// @ts-check
/**
 * Owner LAB audit — when may the platform ask an AI for a review-queue « repair suggestion »?
 * The generators (admin/hive-repair, admin/bulk-repair) ask a model for documents lists or official URLs from its own knowledge: ungrounded text. They may run
 * only when the AI policy allows the provider for the ADMIN audience (today it does not: the cloud provider is BLOCKED_PENDING_PROVIDER_REVIEW, and no local
 * official text is detailed enough to ground such an answer). Whether a record is « still in force » is never asked of a model: it is a human verification (WS2).
 * The answer is an honest refusal in French — the buttons used to fail with a bare error.
 */
import { AIProviderPolicy, AUDIENCE, PROVIDER } from '../lib/ai-policy.js';

export const UNAVAILABLE = Object.freeze({ status: 503, body: { error: 'AI_SUGGESTIONS_UNAVAILABLE',
  message: 'Suggestions automatiques indisponibles : le fournisseur d’IA en nuage est bloqué par la politique IA (revue en attente) et aucune source officielle locale ne permet de fonder une suggestion. Complétez la fiche à la main à partir de la source officielle.' } });
export const HUMAN_ONLY = Object.freeze({ status: 400, body: { error: 'HUMAN_DECISION', message: 'Savoir si une aide est toujours en vigueur est une vérification humaine : utilisez la vérification de la fiche (source officielle, MFA).' } });

/** @returns {boolean} */
export function suggestionsAllowed() {
  const d = AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.ADMIN });
  return Boolean(d && d.allowed);
}

/** @param {string} reason @returns {boolean} the reasons a model may never answer */
export const humanOnly = (reason) => String(reason || '') === 'MISSING_VERIFICATION';
