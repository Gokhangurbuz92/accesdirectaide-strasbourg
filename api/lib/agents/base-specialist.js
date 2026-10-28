import { PER_PROVIDER_TIMEOUT } from './budget.js';
import { createResponse } from './dispatch.js';

export class BaseSpecialist {
  /**
* @param {{ name: any; description?: string; systemPrompt: any; responseSchema: any; tools?: never[]; timeout?: number; enabled?: boolean; requiresModel?: boolean; }} definition
*/
  constructor(definition) {
    this.definition = definition;
    if (!definition.name) throw new Error('Specialist definition must have a name');
    if (!definition.systemPrompt) throw new Error('Specialist definition must have a systemPrompt');
    if (!definition.responseSchema) throw new Error('Specialist definition must have a responseSchema');
  }

  /**
* @param {{ timeoutMs: any; deadline: number; territoryContext: any; territoryApplicabilityState: any; executionId: any; payload: any; }} dispatch
*/
  async execute(dispatch) {
    const startTime = Date.now();
    const baseTimeout = dispatch.timeoutMs || this.definition.timeout || PER_PROVIDER_TIMEOUT;
    const remainingTime = dispatch.deadline ? Math.max(0, dispatch.deadline - Date.now()) : baseTimeout;
    const timeout = Math.min(baseTimeout, remainingTime);

    // Phase 9: Inject territory context envelope into specialist prompt (FR-015)
    let systemPrompt = this.definition.systemPrompt;
    if (dispatch.territoryContext) {
      systemPrompt = `${dispatch.territoryContext}\n\n${systemPrompt}`;
    }

    // Phase 9: DETERMINISTIC server-side territory guard (pre-model)
    // If applicability state disqualifies the entity, abstain WITHOUT calling the model.
    const territoryState = dispatch.territoryApplicabilityState;
    if (territoryState === 'NOT_APPLICABLE') {
      return createResponse({
        componentName: this.definition.name,
        content: null,
        componentLatency: Date.now() - startTime,
        dispatchId: dispatch.executionId,
        routingMethod: 'DETERMINISTIC',
        modelCallCount: 0,
        abstention: true,
        safeErrorState: 'TERRITORY_NOT_APPLICABLE',
        humanApprovalRequired: false
      });
    }
    if (territoryState === 'TERRITORY_REQUIRED') {
      return createResponse({
        componentName: this.definition.name,
        content: null,
        componentLatency: Date.now() - startTime,
        dispatchId: dispatch.executionId,
        routingMethod: 'DETERMINISTIC',
        modelCallCount: 0,
        abstention: true,
        safeErrorState: 'TERRITORY_REQUIRED',
        humanApprovalRequired: false
      });
    }
    if (territoryState === 'UNKNOWN') {
      return createResponse({
        componentName: this.definition.name,
        content: null,
        componentLatency: Date.now() - startTime,
        dispatchId: dispatch.executionId,
        routingMethod: 'DETERMINISTIC',
        modelCallCount: 0,
        abstention: true,
        safeErrorState: 'TERRITORY_UNKNOWN',
        humanApprovalRequired: false
      });
    }
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Enforce: deadline from dispatch
      if (dispatch.deadline && Date.now() > dispatch.deadline) {
        return createResponse({
          componentName: this.definition.name,
          content: null,
          componentLatency: Date.now() - startTime,
          dispatchId: dispatch.executionId,
          routingMethod: 'LLM',
          modelCallCount: 0,
          safeErrorState: 'TIMEOUT_BEFORE_EXECUTION',
          humanApprovalRequired: false
        });
      }

      const { generateStructuredContent } = await import('../ai-foundation.js');
      const result = await generateStructuredContent({
        prompt: dispatch.payload,
        systemInstruction: systemPrompt,
        zodSchema: this.definition.responseSchema,
        tools: this.definition.tools || [],
        primaryProvider: process.env.AI_PRIMARY_PROVIDER,
        model: process.env.AI_PRIMARY_MODEL,
        signal: controller.signal
      });

      const latency = Date.now() - startTime;
      return createResponse({
        componentName: this.definition.name,
        content: result.content,
        componentLatency: latency,
        dispatchId: dispatch.executionId,
        routingMethod: 'LLM',
        modelCallCount: 1,
        citations: result.citations || [],
        confidence: result.confidence,
        abstention: result.abstention || false,
        humanApprovalRequired: result.humanApprovalRequired || false,
        safeErrorState: result.safeErrorState || null,
        toolsUsed: result.toolUsed ? [result.toolUsed.name] : []
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      return createResponse({
        componentName: this.definition.name,
        content: null,
        componentLatency: latency,
        dispatchId: dispatch.executionId,
        routingMethod: 'LLM',
        modelCallCount: /** @type {Error} */ (error).name === 'AbortError' ? 0 : 1,
        safeErrorState: /** @type {Error} */ (error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE',
        humanApprovalRequired: false
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
