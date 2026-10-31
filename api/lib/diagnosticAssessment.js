// @ts-nocheck
/**
 * DTA S1 stage 2b-1 — glue between the local simulation and the pure assessment contract (PURE: no I/O).
 * Rights-specific heuristic leads are DISABLED: the handler never passes `leadsEnabled`, so the local heuristic outcome is not read at all.
 * Data status is a constant 'UNVERIFIED' in S1 (WS2 manifest launchReady:false; there is no path to "verified" here).
 */
import { buildAssessment, engineUnavailableAssessment } from './assessmentContract.js';

/** Schemes ADA has NO verified rule for (named in the product flow contract journeys J-A/J-C/J-B). Never evaluated, never asserted. */
export const UNSUPPORTED_RIGHTS = Object.freeze([
  Object.freeze({ code: 'are', label: 'ARE (France Travail)', reason: 'Aucune règle vérifiée dans ADA' }),
  Object.freeze({ code: 'apa', label: 'APA (Département)', reason: 'Aucune règle vérifiée dans ADA' }),
  Object.freeze({ code: 'impayes-loyer', label: 'Aide en cas d\'impayés de loyer', reason: 'Aucune règle vérifiée dans ADA' }),
]);

export function assessSimulation(simulation, answers, ruleReadings = {}) {
  return buildAssessment({
    simulation,
    answers,
    ruleReadings,   // R31: readings of expert-validated rights only, computed by the handler (api/lib/validatedRules.js); empty today
    dataStatus: 'UNVERIFIED',
    unsupportedRights: UNSUPPORTED_RIGHTS,
    referenceDate: simulation?.meta?.referenceDate ?? null,
  });
}

export function simulationProvenance(simulation) {
  return {
    source: 'local-rules-engine',
    engineVersion: simulation?.meta?.engineVersion ?? null,
    referenceDate: simulation?.meta?.referenceDate ?? null,
    authoritative: false,
    dataStatus: 'UNVERIFIED',
  };
}

/** Public response body of the SIMULATION_MODE: the contract only — the legacy `rights[]` (eligible flags, estimated amounts) is not exposed. */
export function simulationResponse(simulation, answers, meta, ruleReadings = {}) {
  return {
    mode: simulation.mode,
    authoritative: false,
    disclaimer: simulation.disclaimer,
    period: simulation.period,
    assessment: assessSimulation(simulation, answers, ruleReadings),
    provenance: simulationProvenance(simulation),
    meta: { source: simulation.meta?.source, engineVersion: simulation.meta?.engineVersion, referenceDate: simulation.meta?.referenceDate, ...meta },
  };
}

export { engineUnavailableAssessment };
