// @ts-nocheck
/**
 * G14 — the orientation shown beside the « estimation indicative » on /diagnostic, computed in the browser with the SAME pure chain as the server's
 * SIMULATION_MODE (api/_handlers/diagnostic.js): runLocalSimulation → simulationResponse, with the D11 gate restricted to EXPERT_VALIDATED rules exactly as
 * the server does (an OWNER_VALIDATED rule is never applied here either). Loaded lazily (dynamic import) only when the indicative calculation is offered,
 * so the page asks the server once (POST /api/diagnostic, AUTHORITATIVE_MODE) instead of twice. Nothing is stored or sent from here.
 */
import { runLocalSimulation } from './rules/LocalRulesEngine.js';
import { simulationResponse } from './rules/diagnosticAssessment.js';
import { validatedReadings } from './rules/validatedRules.js';
import register from '../../data/rules/rights-rules.v1.json';

/** @param {Record<string, any>} answers the request's answers @returns {Record<string, any>} the SIMULATION_MODE response body (without request id) */
export function localOrientation(answers) {
  const simulation = runLocalSimulation(answers);
  const referenceDate = simulation?.meta?.referenceDate ?? null;
  const all = validatedReadings(register, answers, referenceDate);
  const expertOnly = Object.fromEntries(Object.entries(all).filter(([, r]) => r.validation === 'EXPERT'));
  return simulationResponse(simulation, answers, { computedIn: 'browser' }, expertOnly);
}
