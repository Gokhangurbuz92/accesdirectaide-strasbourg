/**
 * EligibilitySpecialist — LLM Specialist
 *
 * Understands user situation, identifies candidate benefits, collects missing facts.
 * NEVER computes definitive eligibility without a deterministic engine.
 * Statuses: UNKNOWN, POSSIBLE, MISSING_INFORMATION, DETERMINISTIC_CHECK_REQUIRED.
 * NEVER invents income, family composition, amounts, or thresholds.
 */

import { z } from 'zod';
import { registerComponent } from './registry.js';

const ELIGIBILITY_STATUS = z.enum([
  'UNKNOWN', 'POSSIBLE', 'MISSING_INFORMATION', 'DETERMINISTIC_CHECK_REQUIRED'
]);

const ELIGIBILITY_RESPONSE_SCHEMA = z.object({
  category: z.literal('ELIGIBILITY'),
  decisionSummary: z.string(),
  eligibilityStatus: ELIGIBILITY_STATUS,
  candidateBenefits: z.array(z.object({
    name: z.string(),
    status: ELIGIBILITY_STATUS,
    conditions: z.array(z.string()).default([]),
    sourceId: z.string().optional(),
    missingFacts: z.array(z.string()).default([])
  })).default([]),
  missingInformation: z.array(z.string()).default([]),
  humanActionRequired: z.boolean().default(true), // Default to requiring human review
  limitations: z.string().default('Aucun moteur de calcul déterministe (OpenFisca) n\'est connecté. Les résultats sont indicatifs uniquement.')
});

const ELIGIBILITY_SYSTEM_PROMPT = `Tu es un assistant d'éligibilité pour AccesDirectAide.

MISSION : Aider les utilisateurs à comprendre quels droits sociaux pourraient leur correspondre.

RÈGLES ABSOLUES — SÉCURITÉ ÉLIGIBILITÉ :
1. Tu ne CALCULES JAMAIS l'éligibilité de manière définitive.
2. Tu ne DÉCLARES JAMAIS "vous êtes éligible" sans preuve déterministe.
3. Tu n'INVENTES JAMAIS de revenus, de composition familiale, de montants ou de seuils.
4. Tu n'INFÈRES JAMAIS de conditions légales manquantes.
5. Tu utilises UNIQUEMENT les statuts : UNKNOWN, POSSIBLE, MISSING_INFORMATION, DETERMINISTIC_CHECK_REQUIRED.

CE QUE TU PEUX FAIRE :
- Comprendre la situation décrite
- Identifier les aides candidates (status: POSSIBLE)
- Lister les informations manquantes (missingFacts)
- Expliquer les conditions générales d'après les sources fournies
- Recommander de consulter l'organisme compétent

LIMITATION EXPLICITE :
Aucun moteur de calcul déterministe (OpenFisca) n'est connecté.
Tes réponses sont indicatives. L'utilisateur doit vérifier auprès de l'organisme concerné.

FORMAT : Réponds en JSON selon le schéma demandé.`;

const LOOKUP_AIDE_CONDITIONS_TOOL = {
  name: 'lookup_aide_conditions',
  description: 'Consulte les conditions d\'une aide spécifique dans la base de données AccesDirectAide.',
  isReadOnly: true,
  parameters: z.object({
    aideSlug: z.string().describe('Identifiant de l\'aide à consulter')
  }),
  execute: async (/** @type {string | number | boolean | null | undefined} */ args) => {
    return { conditions: [], message: 'Conditions non trouvées pour cette aide.' };
  }
};

export const ELIGIBILITY_DEFINITION = {
  name: 'eligibility',
  description: 'Éligibilité — guidance indicative sur les droits sociaux possibles',
  systemPrompt: ELIGIBILITY_SYSTEM_PROMPT,
  responseSchema: ELIGIBILITY_RESPONSE_SCHEMA,
  tools: [LOOKUP_AIDE_CONDITIONS_TOOL],
  timeout: 60_000,
  enabled: true,
  requiresModel: true
};

export function registerEligibility() {
  registerComponent(ELIGIBILITY_DEFINITION);
}

export { ELIGIBILITY_RESPONSE_SCHEMA, ELIGIBILITY_SYSTEM_PROMPT, ELIGIBILITY_STATUS };
