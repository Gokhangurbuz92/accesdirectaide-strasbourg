// @ts-nocheck
/**
 * G4 (19/11/2026) — BROWSER-ONLY orientation (/orientation wizard + Plan d'action), founder directive: anonymous multi-need orientation usable now, with no
 * new processing of personal data. Switched on by the build flag VITE_ORIENTATION_BROWSER_ONLY=1 (exact value; anything else = off, the server mode stays).
 *
 * What runs here, in the browser, and nowhere else:
 *   - the SAME pure SIMULATION_MODE chain as POST /api/diagnostic (api/_handlers/diagnostic.js): runLocalSimulation → simulationResponse (the assessment
 *     contract: states + provenance, never an eligible flag or an amount) with the D11 gate validatedReadings over the bundled register
 *     (data/rules/rights-rules.v1.json: no right passes it today, so no right is ever shown as validated);
 *   - the needs → official fiches / bodies / places, from the bundled public view of the Rights Graph (data/reference/rights-public-view.v1.json, the /droits data).
 * No request carries the answers, nothing is written to any storage (not even the tab's session storage), nothing is measured. The answers live in React
 * state only and disappear with « Effacer mes réponses », a reload or the tab's closing. The record for the owner / counsel: G4_ORIENTATION_BROWSER_2026-11-19.md.
 */
import { runLocalSimulation } from './rules/LocalRulesEngine.js';
import { simulationResponse } from './rules/diagnosticAssessment.js';
import { validatedReadings } from './rules/validatedRules.js';
import register from '../../data/rules/rights-rules.v1.json';
import { buildWizardDiagnostic } from './wizardDiagnostic.js';
import { NEEDS } from './rightsPublicView.js';

/** the one value that switches the mode on (a typo, « true » or « yes » leaves it off) */
export const BROWSER_ONLY_FLAG_VALUE = '1';

/** @param {unknown} [value] the build's VITE_ORIENTATION_BROWSER_ONLY @returns {boolean} */
export function orientationBrowserOnly(value) {
  let v = value;
  if (arguments.length === 0) {
    try { v = import.meta.env.VITE_ORIENTATION_BROWSER_ONLY; } catch { v = undefined; }
  }
  return v === BROWSER_ONLY_FLAG_VALUE;
}

/**
 * The need TOPICS a choice of the wizard points to (ids of the Rights Graph needs, data/reference/rights-public-view.v1.json). A topic is a subject to read
 * about, never a statement about the person: « Situation de handicap » only adds the handicap topics — no health or disability detail is asked or kept.
 */
export const NEED_TOPICS = Object.freeze({
  logement: Object.freeze(['aides-logement', 'expulsion-impayes', 'energie', 'hebergement-urgence']),
  sante: Object.freeze(['acces-aux-droits', 'psy']),
  travail: Object.freeze(['recherche-emploi', 'minima-sociaux']),
  papiers: Object.freeze(['acces-aux-droits', 'droits-sans-titre']),
  urgence: Object.freeze(['hebergement-urgence', 'violences-conjugales', 'crise-suicide']),
});
export const OPTION_TOPICS = Object.freeze({
  handicap: Object.freeze(['mdph-droits', 'accessibilite-mobilite', 'adaptation-logement']),
  langue: Object.freeze(['acces-aux-droits']),
  numerique: Object.freeze(['acces-aux-droits']),
});
export const SITUATION_TOPICS = Object.freeze({ famille: Object.freeze(['prestations-familiales', 'garde-enfants']) });
export const STATUT_TOPICS = Object.freeze({ chomage: Object.freeze(['recherche-emploi']), hebergement: Object.freeze(['hebergement-urgence']) });
export const HOUSING_TOPICS = Object.freeze({ homeless: Object.freeze(['hebergement-urgence']) });

const BY_ID = new Map(NEEDS.map((n) => [n.id, n]));
const own = (o, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : []);

/**
 * The topics of the wizard's choices, most urgent first (the Rights Graph priority, then the order of the choices), each once.
 * @param {Record<string, any>} data merged wizard data @returns {import('./rightsPublicView.js').PublicNeed[]}
 */
export function orientationTopics(data = {}) {
  const ids = [
    ...own(NEED_TOPICS, data.need),
    ...(Array.isArray(data.options) ? data.options.flatMap((o) => own(OPTION_TOPICS, o)) : []),
    ...own(SITUATION_TOPICS, data.situation),
    ...own(STATUT_TOPICS, data.statut),
    ...own(HOUSING_TOPICS, data.housingStatus),
  ];
  const seen = new Set();
  const topics = [];
  for (const id of ids) { if (!seen.has(id) && BY_ID.has(id)) { seen.add(id); topics.push(BY_ID.get(id)); } }
  return topics.map((n, i) => ({ n, i })).sort((a, b) => a.n.priority - b.n.priority || a.i - b.i).map((x) => x.n);
}

/**
 * The whole result, computed here: the same assessment body as the server's SIMULATION_MODE (no request id, no duration: nothing was asked of a server),
 * the shareable situation (used only if the person presses « Partager » while the documents surface is open) and the topics.
 * Throws an error with code `validation_error` when the answers cannot be read (same rule as the server: an exact date OR an age band).
 * @param {Record<string, any>} data merged wizard data
 */
export function runBrowserOrientation(data = {}) {
  const { body, situation } = buildWizardDiagnostic(data);
  const { answers } = body;
  let simulation;
  try {
    simulation = runLocalSimulation(answers);
  } catch {
    throw Object.assign(new Error('validation_error'), { status: 400, code: 'validation_error' });
  }
  const referenceDate = simulation?.meta?.referenceDate ?? null;
  const result = simulationResponse(simulation, answers, { computedIn: 'browser' }, validatedReadings(register, answers, referenceDate));
  return { result, situation, topics: orientationTopics(data) };
}
