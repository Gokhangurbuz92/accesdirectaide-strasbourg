/**
 * Tool Contract — Zod Parse Correctness Tests
 *
 * Proves the canonical tool executor always passes the ZOD-PARSED value
 * to execute(), never the raw model output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { generateStructuredContent } from '../../api/lib/ai-foundation.js';

function mockOllamaToolCall(toolName, rawArgs) {
  let callCount = 0;
  global.fetch = async (_url, options) => {
    callCount++;
    if (callCount === 1) {
      // Stage 1: model returns a tool call
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: toolName, arguments: JSON.stringify(rawArgs) } }]
          }
        })
      };
    } else {
      // Stage 2: model returns structured JSON
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: '{"ok": true}'
          }
        })
      };
    }
  };
}

describe('Tool Contract — Zod Parse Correctness', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  // A. Unknown/unexpected fields stripped by Zod strict object
  it('strips unknown fields before execute() when using z.object (default strip)', async () => {
    let receivedArgs = null;
    const schema = z.object({ query: z.string() });

    mockOllamaToolCall('test_tool', { query: '69001', injected: 'bad', __proto_pollute: 'x' });

    await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'test_tool',
        description: 'test',
        parameters: schema,
        isReadOnly: true,
        execute: async (args) => { receivedArgs = args; return { done: true }; }
      }],
      primaryProvider: 'ollama'
    });

    expect(receivedArgs).toEqual({ query: '69001' });
    expect(receivedArgs).not.toHaveProperty('injected');
    expect(receivedArgs).not.toHaveProperty('__proto_pollute');
  });

  // B. Zod defaults are applied before execute()
  it('applies Zod defaults before execute()', async () => {
    let receivedArgs = null;
    const schema = z.object({
      query: z.string(),
      limit: z.number().default(10)
    });

    // Model sends only { query: "test" } — no limit
    mockOllamaToolCall('test_tool', { query: 'test' });

    await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'test_tool',
        description: 'test',
        parameters: schema,
        isReadOnly: true,
        execute: async (args) => { receivedArgs = args; return { done: true }; }
      }],
      primaryProvider: 'ollama'
    });

    expect(receivedArgs).toEqual({ query: 'test', limit: 10 });
  });

  // C. Zod transforms/coercions are reflected in execute()
  it('applies Zod transforms before execute()', async () => {
    let receivedArgs = null;
    const schema = z.object({
      query: z.string().trim().toLowerCase()
    });

    mockOllamaToolCall('test_tool', { query: '  PARIS  ' });

    await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'test_tool',
        description: 'test',
        parameters: schema,
        isReadOnly: true,
        execute: async (args) => { receivedArgs = args; return { done: true }; }
      }],
      primaryProvider: 'ollama'
    });

    expect(receivedArgs).toEqual({ query: 'paris' });
  });

  // D. Invalid values never reach execute()
  it('rejects invalid args — execute() never called', async () => {
    let executeCalled = false;
    const schema = z.object({ query: z.string() }); // query is required

    mockOllamaToolCall('test_tool', { wrong_field: 123 }); // missing required 'query'

    const result = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'test_tool',
        description: 'test',
        parameters: schema,
        isReadOnly: true,
        execute: async () => { executeCalled = true; return {}; }
      }],
      primaryProvider: 'ollama'
    });

    expect(executeCalled).toBe(false);
    expect(result.safeErrorState).toBe('UNAVAILABLE');
  });

  // E. toolUsed.arguments records the validated canonical args, not raw model output
  it('records validated args in toolUsed.arguments, not raw model args', async () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().default(5)
    });

    // Model sends extra fields + missing default
    mockOllamaToolCall('test_tool', { query: '75001', extra: 'junk' });

    const result = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools: [{
        name: 'test_tool',
        description: 'test',
        parameters: schema,
        isReadOnly: true,
        execute: async (args) => args
      }],
      primaryProvider: 'ollama'
    });

    expect(result.toolUsed).toBeDefined();
    expect(result.toolUsed.arguments).toEqual({ query: '75001', limit: 5 });
    expect(result.toolUsed.arguments).not.toHaveProperty('extra');
  });
});
