/**
 * OrientationSpecialist — LLM Specialist
 *
 * Identifies relevant aid categories for a user's situation.
 * Returns structured ORIENTATION response with source references.
 * MUST NOT invent organisations, addresses, or contact details.
 * Tool: search_aides (read-only DB query).
 */

import { z } from 'zod';
import { registerComponent } from './registry.js';

const ORIENTATION_RESPONSE_SCHEMA = z.object({
  category: z.literal('ORIENTATION'),
  decisionSummary: z.string(),
  relevantCategories: z.array(z.string()),
  suggestedAides: z.array(z.object({
    title: z.string(),
    description: z.string(),
    sourceId: z.string().optional(),
    category: z.string().optional()
  })).default([]),
  nextSteps: z.array(z.string()).default([]),
  humanActionRequired: z.boolean().default(false),
  missingInformation: z.array(z.string()).default([])
});

const ORIENTATION_SYSTEM_PROMPT = `Tu es un conseiller d'orientation sociale pour AccesDirectAide.

MISSION : Identifier les aides et dispositifs pertinents pour la situation de l'utilisateur.

RÈGLES STRICTES :
1. Base tes réponses UNIQUEMENT sur les données fournies par les outils (search_aides).
2. N'invente JAMAIS d'organisme, d'adresse, de téléphone ou d'horaires.
3. Si les données sont insuffisantes, indique-le dans missingInformation.
4. Catégorise la situation parmi : EMPLOI, LOGEMENT, SANTE, FAMILLE, HANDICAP, ETUDES, MOBILITE, ENERGIE, ALIMENTATION, NUMERIQUE, JUSTICE, SENIORS.
5. Si tu n'as pas assez d'information pour orienter, mets humanActionRequired à true.
6. Cite uniquement les sourceId fournis dans les résultats d'outils.

DONNÉES FOURNIES : Uniquement via les résultats des outils search_aides.
DONNÉES INTERDITES : Toute donnée issue de ta mémoire modèle pour les faits spécifiques (organismes, adresses, montants).

FORMAT : Réponds en JSON selon le schéma demandé.`;

const SEARCH_AIDES_TOOL = {
  name: 'search_aides',
  description: 'Recherche des aides sociales dans la base de données AccesDirectAide. Vous DEVEZ fournir l\'argument "query" avec les mots-clés de recherche.',
  isReadOnly: true,
  parameters: z.object({
    query: z.string().describe('OBLIGATOIRE: Termes de recherche en français (ex: "RSA", "logement")'),
    categories: z.array(z.string()).optional().describe('Filtrer par catégories : EMPLOI, LOGEMENT, SANTE, etc.')
  }),
  execute: async (/** @type {Record<string, string | number | boolean | null | undefined>} */ args) => {
    // This will be connected to the real DB in integration
    // For now, returns a safe empty result
    return { results: [], message: 'Aucune aide trouvée pour cette recherche.' };
  }
};

import { createResponse } from './dispatch.js';

export const ORIENTATION_DEFINITION = {
  name: 'orientation',
  description: 'Orientation sociale — identifie les aides et dispositifs pertinents',
  systemPrompt: ORIENTATION_SYSTEM_PROMPT,
  responseSchema: ORIENTATION_RESPONSE_SCHEMA,
  tools: [SEARCH_AIDES_TOOL],
  timeout: 60_000,
  enabled: true,
  requiresModel: true,
  customExecutor: async (/** @type {{ executionId: string | number | boolean | null | undefined, payload: string | number | boolean | null | undefined, timeoutMs: string | number | boolean | null | undefined }} */ dispatch, /** @type {{ timeout: any; systemPrompt: any; responseSchema: any; name: any; }} */ definition) => {
    const startTime = Date.now();
    const timeoutMs = dispatch.timeoutMs || definition.timeout || 60000;
    
    // 1. Deterministic tool execution
    const toolArgs = { query: dispatch.payload };
    const toolResult = await SEARCH_AIDES_TOOL.execute(toolArgs);
    
    const toolResultContext = JSON.stringify([{
      name: 'search_aides',
      arguments: toolArgs,
      result: toolResult
    }]);
    
    const augmentedSystemPrompt = `${definition.systemPrompt}\n\nRÉSULTATS DE RECHERCHE:\n${toolResultContext}`;
    
    // 2. Single LLM call without tools
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    
    const { generateStructuredContent } = await import('../ai-foundation.js');
    const aiResult = await generateStructuredContent({
      prompt: dispatch.payload,
      systemInstruction: augmentedSystemPrompt,
      zodSchema: definition.responseSchema,
      tools: [], // Model doesn't need to select tools
      primaryProvider: process.env.AI_PRIMARY_PROVIDER,
      model: process.env.AI_PRIMARY_MODEL,
      signal: controller.signal
    });
    
    clearTimeout(timer);
    
    return createResponse({
      componentName: definition.name,
      content: aiResult.content,
      componentLatency: Date.now() - startTime,
      dispatchId: dispatch.executionId,
      routingMethod: 'LLM',
      modelCallCount: aiResult.safeErrorState ? 0 : 1, // Only 1 call!
      toolsUsed: ['search_aides'],
      safeErrorState: aiResult.safeErrorState,
      humanApprovalRequired: aiResult.content?.humanActionRequired || false
    });
  }
};

export function registerOrientation() {
  registerComponent(ORIENTATION_DEFINITION);
}

export { ORIENTATION_RESPONSE_SCHEMA, ORIENTATION_SYSTEM_PROMPT };
