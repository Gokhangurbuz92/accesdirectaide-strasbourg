// @ts-nocheck
/**
 * Phase 9 — Territory Search Filter
 * Adds territory applicability pre-filtering to search pipelines.
 * Filters BEFORE FTS/pgvector ranking to prevent cross-territory leakage.
 */
import { evaluateApplicability } from './ApplicabilityEngine.js';
import logger from '../../_utils/logger.js';

/**
 * Filter search results by territorial applicability BEFORE ranking.
 *
 * @param {Array} candidates - Raw search candidates (each must have an `applicabilityRules` field)
 * @param {string[]} userTerritoryIds - User's resolved territory hierarchy IDs
 * @param {Map<string, string>} territoryTypeMap - Map of territoryId -> type
 * @returns {{ filtered: Array, excluded: number, territoryRequired: number }}
 */
export function filterByApplicability(candidates, userTerritoryIds, territoryTypeMap) {
  if (!candidates || candidates.length === 0) {
    return { filtered: [], excluded: 0, territoryRequired: 0 };
  }

  const filtered = [];
  let excluded = 0;
  let territoryRequired = 0;

  for (const candidate of candidates) {
    const rules = candidate.applicabilityRules || [];
    const state = evaluateApplicability(rules, userTerritoryIds, territoryTypeMap);

    if (state === 'APPLICABLE' || state === 'UNKNOWN') {
      filtered.push({ ...candidate, _applicabilityState: state });
    } else if (state === 'TERRITORY_REQUIRED') {
      territoryRequired++;
      // NOT included in results — require user territory first
    } else {
      excluded++;
    }
  }

  if (excluded > 0) {
    logger.info(`[TerritoryFilter] Excluded ${excluded} candidates by applicability, ${territoryRequired} require territory`);
  }

  return { filtered, excluded, territoryRequired };
}

/**
 * Build the deterministic territory context envelope for RAG/Specialist prompts.
 * LLMs receive this as part of the SourceEnvelope and must NOT override it.
 *
 * @param {object} resolvedTerritory - The user's resolved territory context
 * @param {string} applicabilityState - 'APPLICABLE' | 'NOT_APPLICABLE' | 'TERRITORY_REQUIRED' | 'UNKNOWN'
 * @returns {string}
 */
export function buildTerritoryContextEnvelope(resolvedTerritory, applicabilityState) {
  if (!resolvedTerritory) {
    return `[TERRITORY CONTEXT: NONE — TERRITORY_REQUIRED for local content. National content only.]`;
  }

  const parts = [
    `[TERRITORY CONTEXT]`,
    `State: ${applicabilityState}`,
    // @ts-ignore
    resolvedTerritory.commune ? `Commune: ${resolvedTerritory.commune}` : null,
    // @ts-ignore
    resolvedTerritory.departement ? `Département: ${resolvedTerritory.departement}` : null,
    // @ts-ignore
    resolvedTerritory.region ? `Région: ${resolvedTerritory.region}` : null,
    // @ts-ignore
    resolvedTerritory.epci ? `EPCI: ${resolvedTerritory.epci}` : null,
    `[DO NOT infer territorial eligibility beyond this context. If state is not APPLICABLE, abstain.]`,
    `[/TERRITORY CONTEXT]`
  ].filter(Boolean);

  return parts.join('\n');
}

export default { filterByApplicability, buildTerritoryContextEnvelope };
