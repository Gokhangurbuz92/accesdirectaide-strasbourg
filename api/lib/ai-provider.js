// @ts-nocheck
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import Sentry from '../_utils/sentryServer.js';

export class ModelProvider {
  async generateText(/** @type {string | number | boolean | null | undefined} */ options) { throw new Error('Not implemented'); }
  async generateStructured(options) { throw new Error('Not implemented'); }
  async healthCheck() { throw new Error('Not implemented'); }
}

export class GeminiProvider extends ModelProvider {
  /**
   * @param {string | undefined} apiKey
   */
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  async healthCheck() {
    return !!this.apiKey;
  }

  _mapJsonSchemaToGemini(/** @type {string | number | boolean | null | undefined} */ jsonSchema) {
    if (!jsonSchema) return undefined;
    const mapType = (/** @type {string | number | boolean | null | undefined} */ type) => {
      switch (type) {
        case 'string': return SchemaType.STRING;
        case 'number': 
        case 'integer': return SchemaType.NUMBER;
        case 'boolean': return SchemaType.BOOLEAN;
        case 'array': return SchemaType.ARRAY;
        case 'object': return SchemaType.OBJECT;
        default: return SchemaType.STRING;
      }
    };
    const convert = (schema) => {
      if (!schema) return undefined;
      const result = { type: mapType(schema.type) };
      if (schema.description) result.description = schema.description;
      if (schema.enum) result.enum = schema.enum;
      if (schema.type === 'object' && schema.properties) {
        result.properties = {};
        for (const [key, val] of Object.entries(schema.properties)) {
          result.properties[key] = convert(val);
        }
        if (schema.required) result.required = schema.required;
      }
      if (schema.type === 'array' && schema.items) {
        result.items = convert(schema.items);
      }
      return result;
    };
    return convert(jsonSchema);
  }

  // @ts-ignore
  async generateStructured({ messages, prompt, schema, systemInstruction, model = 'gemini-1.5-flash', tools = [], signal, maxRetries = 2, timeoutMs = 120000, contextPolicy = {} }) {
    if (!this.genAI) throw new Error('GeminiProvider not configured (missing API key)');
    
    // Central Provider Policy Enforcement
    const { AIProviderPolicy, PROVIDER, AUDIENCE } = await import('./ai-policy.js');
    const audience = contextPolicy.audience || AUDIENCE.PROFESSIONAL;
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience });
    if (!policy.allowed) {
      throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }

    return Sentry.startSpan({ name: 'gemini.generateStructured', op: 'ai.generation' }, async (span) => {
      span?.setAttribute('ai.model', model);
      let attempts = 0;
      while (attempts <= maxRetries) {
        try {
          const geminiModel = this.genAI.getGenerativeModel({
            model,
            systemInstruction,
            tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: this._mapJsonSchemaToGemini(schema)
            }
          });

          const actualPrompt = prompt || (messages && messages[messages.length - 1].content) || '';
          
          const result = await Sentry.startSpan({ name: 'gemini.generateContent', op: 'http.client' }, () => 
            geminiModel.generateContent(actualPrompt)
          );
          
          const text = result.response.text();
          const usage = result.response.usageMetadata || {};
          
          /**
           * @type {{ name: string; arguments: object; }[]}
           */
          let functionCalls = [];
          const fnCallResult = result.response.functionCalls && result.response.functionCalls();
          if (fnCallResult && fnCallResult.length > 0) {
             functionCalls = fnCallResult.map(fc => ({ name: fc.name, arguments: fc.args }));
          }

          span?.setAttribute('ai.usage.prompt_tokens', usage.promptTokenCount || 0);
          span?.setAttribute('ai.usage.completion_tokens', usage.candidatesTokenCount || 0);

          return {
            content: text ? JSON.parse(text) : null,
            toolCalls: functionCalls,
            usage: {
              promptTokens: usage.promptTokenCount || 0,
              completionTokens: usage.candidatesTokenCount || 0
            }
          };
        } catch (err) {
          attempts++;
          if (attempts > maxRetries || (/** @type {Error} */ (err).name === 'AbortError')) throw err;
        }
      }
    });
  }
}

export class OllamaProvider extends ModelProvider {
  constructor(baseUrl = 'http://127.0.0.1:11434') {
    super();
    this.baseUrl = baseUrl;
  }

  async healthCheck() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  // @ts-ignore
  async generateStructured({ messages, prompt, schema, systemInstruction, model = 'qwen2.5', tools = [], signal, maxRetries = 2, timeoutMs = 120000, contextPolicy = {}, think = false, options }) {
    // Central Provider Policy Enforcement
    const { AIProviderPolicy, PROVIDER, AUDIENCE } = await import('./ai-policy.js');
    const audience = contextPolicy.audience || AUDIENCE.PROFESSIONAL;
    const locality = AIProviderPolicy.classifyLocality(this.baseUrl);
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.OLLAMA, audience, locality });
    if (!policy.allowed) {
      throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }

    return Sentry.startSpan({ name: 'ollama.generateStructured', op: 'ai.generation' }, async (span) => {
      span?.setAttribute('ai.model', model);
      let attempts = 0;
      
      const ollamaTools = tools.length > 0 ? tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      })) : undefined;

      let chatMessages = messages || [];
      if (!messages) {
        if (systemInstruction) chatMessages.push({ role: 'system', content: systemInstruction });
        chatMessages.push({ role: 'user', content: prompt });
      }

      while (attempts <= maxRetries) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          if (signal) signal.addEventListener('abort', () => controller.abort());

          const body = {
            model,
            messages: chatMessages,
            stream: false
          };
          if (schema) body.format = schema;
          if (ollamaTools) body.tools = ollamaTools;
          // Ollama runtime options (num_ctx, temperature…) — the background verification texts need a context large enough for a whole official fiche
          if (options && typeof options === 'object') body.options = options;
          // PKG-6 / N14 latency: qwen3 runs a hidden « thinking » pass before every answer unless told not to (measured on the evaluation prompts: 16-23 s with it,
          // 3-4 s without, same structured answer). The 30 s contract needs it off; a caller may still ask for it explicitly (think: true).
          if (think !== undefined) body.think = Boolean(think);

          const response = await Sentry.startSpan({ name: 'ollama.fetch', op: 'http.client' }, () => 
            fetch(`${this.baseUrl}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: controller.signal
            })
          );
          
          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`OllamaProvider error: ${response.statusText}`);
          }

          const data = await response.json();
          
          let toolCalls = [];
          let content = null;
          if (data.message) {
            if (data.message.tool_calls) {
              toolCalls = data.message.tool_calls.map(tc => tc.function);
            } else if (data.message.content) {
              try {
                 content = JSON.parse(data.message.content);
              } catch (e) {
                 content = { raw: data.message.content };
              }
            }
          }

          span?.setAttribute('ai.usage.prompt_tokens', data.prompt_eval_count || 0);
          span?.setAttribute('ai.usage.completion_tokens', data.eval_count || 0);

          return {
             content,
             toolCalls,
             message: data.message,
             usage: {
               promptTokens: data.prompt_eval_count || 0,
               completionTokens: data.eval_count || 0
             }
          };
        } catch (err) {
          attempts++;
          if (attempts > maxRetries || /** @type {Error} */ (err).name === 'AbortError') throw err;
        }
      }
    });
  }
}
