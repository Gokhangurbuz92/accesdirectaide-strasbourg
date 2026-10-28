export const MAX_MODEL_CALLS_INTERACTIVE = 2;
export const MAX_TOOL_CALLS = 3;
export const MAX_AGENT_HOPS = 1;
export const GLOBAL_TIMEOUT = 90_000; // 90 seconds
export const PER_PROVIDER_TIMEOUT = 60_000; // 45 seconds
export const MAX_RETRIES = 1;
export const DETERMINISTIC_ROUTING_CONFIDENCE_THRESHOLD = 0.8;
export const DEFAULT_FRESHNESS_TTL_DAYS = 90;

export class BudgetTracker {
  constructor() {
    this.modelCalls = 0;
    this.toolCalls = 0;
    this.agentHops = 0;
    this.startTime = Date.now();
  }
  
  canCallModel() { 
    return this.modelCalls < MAX_MODEL_CALLS_INTERACTIVE; 
  }
  
  canCallTool() { 
    return this.toolCalls < MAX_TOOL_CALLS; 
  }
  
  canHop() { 
    return this.agentHops < MAX_AGENT_HOPS; 
  }
  
  isExpired() { 
    return (Date.now() - this.startTime) > GLOBAL_TIMEOUT; 
  }
  
  recordModelCall() { 
    this.modelCalls++; 
  }
  
  recordToolCall() { 
    this.toolCalls++; 
  }
  
  recordHop() { 
    this.agentHops++; 
  }
  
  getSummary() { 
    return { 
      modelCalls: this.modelCalls, 
      toolCalls: this.toolCalls, 
      agentHops: this.agentHops, 
      elapsedMs: Date.now() - this.startTime 
    }; 
  }
}
