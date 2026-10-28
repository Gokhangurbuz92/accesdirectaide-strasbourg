/**
 * PKG-6 / N14 latency — the local provider asks qwen3 NOT to run its hidden thinking pass (measured: 16-23 s with it, 3-4 s without on the evaluation prompts;
 * evaluation R5: p95 6.7 s, max 6.9 s vs R2 24.0 / 27.5 s). A caller may still opt in explicitly. The request stays on loopback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../api/lib/ai-provider.js';

afterEach(() => vi.unstubAllGlobals());
const bodyOf = async (opts) => {
  const f = vi.fn(async () => ({ ok: true, json: async () => ({ message: { content: '{"points":["Un point de test."]}' } }) }));
  vi.stubGlobal('fetch', f);
  await new OllamaProvider('http://127.0.0.1:11434').generateStructured({ prompt: 'p', schema: { type: 'object' }, model: 'qwen3:8b', maxRetries: 0, ...opts });
  expect(String(f.mock.calls[0][0])).toBe('http://127.0.0.1:11434/api/chat');
  return JSON.parse(f.mock.calls[0][1].body);
};
describe('PKG-6 / N14 qwen3 thinking off by default', () => {
  it('sends think:false unless asked', async () => { expect((await bodyOf({})).think).toBe(false); });
  it('an explicit opt-in is honoured', async () => { expect((await bodyOf({ think: true })).think).toBe(true); });
});
