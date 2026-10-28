/**
 * ProcedureSpecialist — LLM Specialist
 *
 * Retrieves and explains step-by-step procedures from trusted structured content.
 * MUST NOT invent deadlines, documents, forms, authorities, or legal conditions.
 * If data is stale/unavailable: ABSTAIN or require verification.
 */

import { z } from 'zod';
import { registerComponent } from './registry.js';

const PROCEDURE_RESPONSE_SCHEMA = z.object({
  category: z.literal('PROCEDURE'),
  decisionSummary: z.string(),
  procedureTitle: z.string(),
  steps: z.array(z.object({
    stepNumber: z.number(),
    description: z.string(),
    organism: z.string().optional(),
    sourceId: z.string().optional()
  })).default([]),
  requiredDocuments: z.array(z.string()).default([]),
  competentOrganism: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
  humanActionRequired: z.boolean().default(false),
  dataAvailability: z.enum(['AVAILABLE', 'PARTIAL', 'MISSING', 'STALE']).default('AVAILABLE')
});

const PROCEDURE_SYSTEM_PROMPT = `Tu es un expert en démarches administratives françaises pour AccesDirectAide.

MISSION : Expliquer les procédures administratives étape par étape.

RÈGLES STRICTES :
1. Base tes réponses UNIQUEMENT sur les données fournies par les outils (search_procedures).
2. N'invente JAMAIS de délais, de formulaires, de documents requis, d'autorités compétentes ou de conditions légales.
3. Si les données sont insuffisantes ou périmées, indique dataAvailability: 'MISSING' ou 'STALE'.
4. Cite les sourceId fournis par les outils.
5. Numérote les étapes clairement.
6. Si la procédure implique des critères d'éligibilité, ne les calcule pas — indique simplement de consulter l'organisme compétent.

FORMAT : Réponds en JSON selon le schéma demandé.`;

const SEARCH_PROCEDURES_TOOL = {
  name: 'search_procedures',
  description: 'Recherche des procédures administratives dans la base de données AccesDirectAide. Vous DEVEZ fournir l\'argument "query" avec les termes de la recherche.',
  isReadOnly: true,
  parameters: z.object({
    query: z.string().describe('OBLIGATOIRE: Termes de recherche pour la procédure (ex: "renouvellement titre de séjour")')
  }),
  execute: async (/** @type {Record<string, string | number | boolean | null | undefined>} */ args) => {
    return { procedures: [], message: 'Aucune procédure trouvée.' };
  }
};

import { createResponse } from './dispatch.js';

export const PROCEDURE_DEFINITION = {
  name: 'procedure',
  description: 'Procédures administratives — explications étape par étape',
  systemPrompt: PROCEDURE_SYSTEM_PROMPT,
  responseSchema: PROCEDURE_RESPONSE_SCHEMA,
  tools: [SEARCH_PROCEDURES_TOOL],
  timeout: 60_000,
  enabled: true,
  requiresModel: true,
  customExecutor: async (/** @type {{ executionId: string | number | boolean | null | undefined, payload: string | number | boolean | null | undefined, timeoutMs: string | number | boolean | null | undefined }} */ dispatch, /** @type {{ timeout: any; systemPrompt: any; responseSchema: any; name: any; }} */ definition) => {
    const startTime = Date.now();
    const timeoutMs = dispatch.timeoutMs || definition.timeout || 60000;
    
    // 1. Deterministic tool execution
    const t0 = Date.now();
    const toolArgs = { query: dispatch.payload };
    const toolResult = await SEARCH_PROCEDURES_TOOL.execute(toolArgs);
    const t1 = Date.now();
    const sourceRetrievalMs = t1 - t0;
    
    const toolResultContext = JSON.stringify([{
      name: 'search_procedures',
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
    const t2 = Date.now();
    const finalModelMs = t2 - t1; // This includes Zod validation in ai-foundation
    
    clearTimeout(timer);
    
    const totalMs = Date.now() - startTime;
    console.log(`\n--- PROCEDURE PROFILING ---`);
    console.log(`SOURCE_RETRIEVAL_MS: ${sourceRetrievalMs}ms`);
    console.log(`FINAL_MODEL_MS (incl Zod): ${finalModelMs}ms`);
    console.log(`TOTAL_MS: ${totalMs}ms`);
    console.log(`MODEL_CALL_COUNT: 1`);
    console.log(`TOOL_CALL_COUNT: 1 (Deterministic)`);
    console.log(`---------------------------\n`);
    
    return createResponse({
      componentName: definition.name,
      content: aiResult.content,
      componentLatency: totalMs,
      dispatchId: dispatch.executionId,
      routingMethod: 'LLM',
      modelCallCount: aiResult.safeErrorState ? 0 : 1, // Only 1 call!
      toolsUsed: ['search_procedures'],
      safeErrorState: aiResult.safeErrorState,
      humanApprovalRequired: aiResult.content?.humanActionRequired || false
    });
  }
};

export function registerProcedure() {
  registerComponent(PROCEDURE_DEFINITION);
}

export { PROCEDURE_RESPONSE_SCHEMA, PROCEDURE_SYSTEM_PROMPT };
