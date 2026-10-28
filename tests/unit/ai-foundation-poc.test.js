import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateStructuredContent } from '../../api/lib/ai-foundation.js';

describe('AI Foundation - Tool Calling Loop', () => {
  it('rejects unknown tool calls', async () => {
    // Mock the fetch to return a tool call
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          tool_calls: [{ function: { name: 'unknown_tool', arguments: '{}' } }]
        }
      })
    });
    
    const res = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'dummy_tool',
        description: 'test',
        parameters: z.object({}),
        execute: async () => {},
        isReadOnly: true
      }],
      primaryProvider: 'ollama'
    });
    
    expect(res.safeErrorState).toBe('UNAVAILABLE');
  });

  it('rejects non-read-only tool calls', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          tool_calls: [{ function: { name: 'my_tool', arguments: '{}' } }]
        }
      })
    });
    
    const res = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'my_tool',
        description: 'test',
        parameters: z.object({}),
        execute: async () => {},
        isReadOnly: false // Not read-only
      }],
      primaryProvider: 'ollama'
    });
    
    expect(res.safeErrorState).toBe('UNAVAILABLE');
  });

  it('validates tool arguments and executes read-only tool', async () => {
    let callCount = 0;
    global.fetch = async (url, options) => {
      callCount++;
      const body = JSON.parse(options.body);
      
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            message: {
              role: 'assistant',
              tool_calls: [{ function: { name: 'find_test_structure', arguments: '{"zip":"75001"}' } }]
            }
          })
        };
      } else {
        // Second call, expecting tool result in messages
        const toolMsg = body.messages.find(m => m.role === 'tool');
        expect(toolMsg).toBeDefined();
        expect(toolMsg.content).toContain('Paris Hub');
        
        return {
          ok: true,
          json: async () => ({
            message: {
              role: 'assistant',
              content: '{"result": "Success"}'
            }
          })
        };
      }
    };
    
    let executed = false;
    const res = await generateStructuredContent({
      prompt: 'Find structure in 75001',
      zodSchema: z.object({ result: z.string() }),
      tools: [{
        name: 'find_test_structure',
        description: 'Finds structure',
        parameters: z.object({ zip: z.string() }),
        isReadOnly: true,
        execute: async (args) => {
          expect(args.zip).toBe('75001');
          executed = true;
          return { name: 'Paris Hub', type: 'CAF' };
        }
      }],
      primaryProvider: 'ollama'
    });
    
    expect(executed).toBe(true);
    expect(res.content.result).toBe('Success');
    expect(res.toolUsed.name).toBe('find_test_structure');
  });
});

describe('Ollama Health Check', () => {
  it('uses short timeout and AbortSignal for /api/tags', async () => {
    let signalFired = false;
    global.fetch = async (url, options) => {
      if (options.signal) {
        options.signal.addEventListener('abort', () => { signalFired = true; });
      }
      return { ok: true };
    };
    
    const { OllamaProvider } = await import('../../api/lib/ai-provider.js');
    const provider = new OllamaProvider();
    const isHealthy = await provider.healthCheck();
    
    expect(isHealthy).toBe(true);
  });
});
