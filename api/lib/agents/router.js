// @ts-nocheck
import { classifyIntent } from '../services/classification.js';
import { validateCitations, detectSourceConflicts } from '../services/official-sources.js';
import { createDispatch, createResponse } from './dispatch.js';
import { getComponent, hasComponent } from './registry.js';
import {
  BudgetTracker,
  MAX_MODEL_CALLS_INTERACTIVE,
  GLOBAL_TIMEOUT,
  PER_PROVIDER_TIMEOUT,
  DETERMINISTIC_ROUTING_CONFIDENCE_THRESHOLD
} from './budget.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// Classification schema for LLM fallback
const ClassificationSchema = z.object({
  intent: z.enum(['ORIENTATION', 'ELIGIBILITY', 'PROCEDURE', 'DOCUMENT', 'FALC', 'SAFETY_ABSTENTION']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional()
});

// Intent to specialist mapping
const INTENT_TO_SPECIALIST = {
  ORIENTATION: 'orientation',
  ELIGIBILITY: 'eligibility',
  PROCEDURE: 'procedure',
  DOCUMENT: 'document',
  FALC: 'falc'
};

export class ADARouter {
  constructor(options = {}) {
    this.name = 'ada-router';
  }

  /**
   * Route a user request to the appropriate specialist.
   * @param {{ prompt: string, requestId?: string, sourceEnvelope?: Array }} request
   * @returns {Promise<import('./dispatch.js').AgentResponse>}
   */
  async route(request) {
    const requestId = request.requestId || randomUUID();
    const budget = new BudgetTracker();
    const routeStartTime = Date.now();

    // Trace metadata (sanitized — no raw prompt)
    const trace = {
      requestId,
      route: null,
      routeReason: null,
      routingConfidence: 0,
      usedAIForRouting: false,
      modelCallCount: 0,
      routingLatencyMs: 0,
      totalLatencyMs: 0
    };

    try {
      // Step 1: Deterministic classification
      const classification = classifyIntent(request.prompt);
      trace.routingConfidence = classification.confidence;

      let selectedIntent = classification.intent;
      let routeReason = `deterministic:${classification.matchedKeywords.join(',')}`;
      let usedAI = false;

      // Step 2: If deterministic confidence is too low AND not safety abstention, use LLM fallback
      if (classification.confidence < DETERMINISTIC_ROUTING_CONFIDENCE_THRESHOLD && classification.intent !== 'SAFETY_ABSTENTION') {
        if (budget.canCallModel()) {
          try {
            const { generateStructuredContent } = await import('../ai-foundation.js');
            const llmClassification = await generateStructuredContent({
              prompt: request.prompt,
              systemInstruction: `Tu es un routeur de requêtes pour AccesDirectAide. Classifie l'intention de l'utilisateur parmi:
- ORIENTATION: recherche d'aides, de conseils, d'orientation générale
- ELIGIBILITY: questions sur les droits, l'éligibilité, les conditions
- PROCEDURE: questions sur les démarches, les étapes, les formulaires  
- DOCUMENT: questions sur un document reçu, une lettre, une notification
- FALC: demande de simplification de texte
- SAFETY_ABSTENTION: requête dangereuse, hors périmètre, ou incompréhensible

Réponds en JSON.`,
              zodSchema: ClassificationSchema,
              tools: [],
              signal: AbortSignal.timeout(PER_PROVIDER_TIMEOUT)
            });

            budget.recordModelCall();
            usedAI = true;

            if (llmClassification.content && !llmClassification.safeErrorState) {
              selectedIntent = llmClassification.content.intent;
              trace.routingConfidence = llmClassification.content.confidence || 0.7;
              routeReason = `llm:${selectedIntent}`;
            }
          } catch (error) {
            // LLM classification failed — stick with deterministic result
            routeReason = `deterministic_fallback:${error.message}`;
          }
        }
      }

      trace.route = selectedIntent;
      trace.routeReason = routeReason;
      trace.usedAIForRouting = usedAI;
      trace.routingLatencyMs = Date.now() - routeStartTime;

      // Step 3: Handle SAFETY_ABSTENTION
      if (selectedIntent === 'SAFETY_ABSTENTION') {
        return createResponse({
          componentName: this.name,
          content: null,
          componentLatency: Date.now() - routeStartTime,
          dispatchId: requestId,
          routingMethod: usedAI ? 'LLM' : 'DETERMINISTIC',
          modelCallCount: budget.modelCalls,
          abstention: true,
          humanApprovalRequired: true,
          safeErrorState: null
        });
      }

      // Step 4: Resolve specialist
      const specialistName = INTENT_TO_SPECIALIST[selectedIntent];
      if (!specialistName || !hasComponent(specialistName)) {
        return createResponse({
          componentName: this.name,
          content: null,
          componentLatency: Date.now() - routeStartTime,
          dispatchId: requestId,
          routingMethod: usedAI ? 'LLM' : 'DETERMINISTIC',
          modelCallCount: budget.modelCalls,
          abstention: true,
          humanApprovalRequired: true,
          safeErrorState: `NO_SPECIALIST_FOR_INTENT:${selectedIntent}`
        });
      }

      // Step 5: Budget check for specialist model call
      if (!budget.canCallModel()) {
        return createResponse({
          componentName: this.name,
          content: null,
          componentLatency: Date.now() - routeStartTime,
          dispatchId: requestId,
          routingMethod: usedAI ? 'LLM' : 'DETERMINISTIC',
          modelCallCount: budget.modelCalls,
          safeErrorState: 'MODEL_CALL_BUDGET_EXCEEDED'
        });
      }

      if (budget.isExpired()) {
        return createResponse({
          componentName: this.name,
          content: null,
          componentLatency: Date.now() - routeStartTime,
          dispatchId: requestId,
          routingMethod: usedAI ? 'LLM' : 'DETERMINISTIC',
          modelCallCount: budget.modelCalls,
          safeErrorState: 'GLOBAL_TIMEOUT_EXCEEDED'
        });
      }

      // Step 6: Create dispatch and execute specialist
      budget.recordHop();
      const specialist = getComponent(specialistName);

      const deadline = budget.startTime + GLOBAL_TIMEOUT;
      const remainingTime = Math.max(0, deadline - Date.now());
      const specialistTimeout = Math.min(specialist.timeout || PER_PROVIDER_TIMEOUT, remainingTime);

      const dispatch = createDispatch({
        requestId,
        userIntent: selectedIntent,
        executionId: trace.executionId,
        deadline: deadline,
        sourceComponent: this.name,
        targetComponent: specialistName,
        payload: request.prompt,
        sourceEnvelope: request.sourceEnvelope || [],
        toolPermissions: (specialist.tools || []).map(t => t.name),
        timeoutMs: specialistTimeout
      });

      // Execute specialist if it requires a model
      let specialistResponse;
      if (specialist.requiresModel !== false) {
        if (typeof specialist.customExecutor === 'function') {
          specialistResponse = await specialist.customExecutor(dispatch, specialist);
        } else {
          // Dynamic import of BaseSpecialist to avoid circular deps
          const { BaseSpecialist } = await import('./base-specialist.js');
          const agent = new BaseSpecialist(specialist);
          specialistResponse = await agent.execute(dispatch);
        }
        
        if (specialistResponse.modelCallCount) {
          for (let i=0; i < specialistResponse.modelCallCount; i++) {
            budget.recordModelCall();
          }
        } else {
          budget.recordModelCall();
        }
      } else {
        // Deterministic component — no model call
        specialistResponse = createResponse({
          componentName: specialistName,
          content: null,
          componentLatency: 0,
          dispatchId: dispatch.executionId,
          routingMethod: 'DETERMINISTIC',
          modelCallCount: 0
        });
      }

      // Step 7: Post-process — citation validation
      if (specialistResponse.citations && specialistResponse.citations.length > 0 && request.sourceEnvelope) {
        const { valid, rejected } = validateCitations(specialistResponse.citations, request.sourceEnvelope);
        specialistResponse = { ...specialistResponse, citations: valid };
        if (rejected.length > 0) {
          trace.rejectedCitations = rejected;
        }
      }

      // Step 8: Check source conflicts
      if (request.sourceEnvelope && request.sourceEnvelope.length > 0) {
        const conflicts = detectSourceConflicts(request.sourceEnvelope);
        if (conflicts.hasConflict) {
          specialistResponse = {
            ...specialistResponse,
            sourceConflict: true,
            humanApprovalRequired: true
          };
        }
      }

      // Finalize trace
      trace.modelCallCount = budget.modelCalls;
      trace.totalLatencyMs = Date.now() - routeStartTime;

      // Return enriched response
      return {
        ...specialistResponse,
        modelCallCount: budget.modelCalls,
        componentLatency: Date.now() - routeStartTime,
        traceMetadata: trace
      };

    } catch (error) {
      trace.totalLatencyMs = Date.now() - routeStartTime;

      return createResponse({
        componentName: this.name,
        content: null,
        componentLatency: Date.now() - routeStartTime,
        dispatchId: requestId,
        routingMethod: trace.usedAIForRouting ? 'LLM' : 'DETERMINISTIC',
        modelCallCount: budget.modelCalls,
        safeErrorState: error.message
      });
    }
  }
}

/**
 * Check if the AI subsystem is available.
 * @returns {Promise<boolean>}
 */
export async function isAIAvailable() {
  try {
    const { OllamaProvider } = await import('../ai-provider.js');
    const provider = new OllamaProvider(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    return await provider.healthCheck();
  } catch {
    return false;
  }
}
