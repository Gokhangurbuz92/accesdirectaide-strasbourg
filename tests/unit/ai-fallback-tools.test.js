import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateStructuredContent } from '../../api/lib/ai-foundation.js';

describe('AI Foundation - Tool Loop and Fallback Security', () => {
  const tools = [
    {
      name: 'read_tool',
      description: 'Read only',
      parameters: z.object({ id: z.string() }),
      isReadOnly: true,
      execute: async (args) => ({ result: 'read ok' })
    },
    {
      name: 'write_tool',
      description: 'Writes data',
      parameters: z.object({ id: z.string() }),
      isReadOnly: false,
      execute: async (args) => ({ result: 'write ok' })
    }
  ];

  it('fallback path rejects non-read-only tool', async () => {
    // Mock fetch for Ollama (primary) to fail
    let fetchCount = 0;
    global.fetch = async (url, options) => {
      fetchCount++;
      if (fetchCount === 1) {
         throw new Error("Primary failed"); // Trigger fallback
      }
      // Fallback response: model calls a write tool
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'write_tool', arguments: '{"id":"1"}' } }]
          }
        })
      };
    };

    const res = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools,
      primaryProvider: 'ollama',
      fallbackProvider: 'ollama' // mock fallback uses fetch too
    });
    
    expect(res.safeErrorState).toBe('UNAVAILABLE');
    expect(res.provider).toBe('ollama');
  });

  it('fallback path rejects unknown tool', async () => {
    let fetchCount = 0;
    global.fetch = async (url, options) => {
      fetchCount++;
      if (fetchCount === 1) throw new Error("Primary failed");
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'unknown_tool', arguments: '{"id":"1"}' } }]
          }
        })
      };
    };

    const res = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools,
      primaryProvider: 'ollama',
      fallbackProvider: 'ollama'
    });
    
    expect(res.safeErrorState).toBe('UNAVAILABLE');
  });

  it('fallback path rejects invalid args', async () => {
    let fetchCount = 0;
    global.fetch = async (url, options) => {
      fetchCount++;
      if (fetchCount === 1) throw new Error("Primary failed");
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'read_tool', arguments: '{"wrong":"1"}' } }]
          }
        })
      };
    };

    const res = await generateStructuredContent({
      prompt: 'test',
      zodSchema: z.object({ ok: z.boolean() }),
      tools,
      primaryProvider: 'ollama',
      fallbackProvider: 'ollama'
    });
    
    expect(res.safeErrorState).toBe('UNAVAILABLE');
  });
});
