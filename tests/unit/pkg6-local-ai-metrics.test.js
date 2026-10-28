import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { toMetricRow, recordLocalAiEvent, _setLocalMetricsSink } from '../../api/lib/local-ai-metrics.js';

const chat = readFileSync(new URL('../../api/_handlers/assistant/chat.js', import.meta.url), 'utf8');

describe('PKG-6 / A14 D21 local-model metrics', () => {
  afterEach(() => _setLocalMetricsSink(null));

  it('stores only declared outcomes and reason codes: free text becomes "other", a non-model event has latency 0', () => {
    expect(toMetricRow({ feature: 'assistant', outcome: 'answered', model: 'qwen3:8b', latencyMs: 1234.7, usage: { promptTokens: 10, completionTokens: 5 } }))
      .toEqual({ type: 'assistant.answered', model: 'qwen3:8b', promptTokens: 10, completionTokens: 5, totalTokens: 15, latencyMs: 1234, success: true, circuitBreakerOpen: false, errorMessage: null });
    expect(toMetricRow({ feature: 'assistant', outcome: 'error', reason: 'Mon adresse est 3 rue X', model: 'qwen3:8b' }).errorMessage).toBe('other');
    expect(toMetricRow({ feature: 'assistant', outcome: 'blocked', reason: 'prompt_injection_blocked', latencyMs: 50 })).toMatchObject({ model: 'none', latencyMs: 0, errorMessage: 'prompt_injection_blocked' });
    expect(toMetricRow({ feature: 'assistant', outcome: 'answered', model: 'gemini 2.0 <script>' }).model).toBe('none');
    expect(toMetricRow({ feature: 'gemini', outcome: 'answered' })).toBeNull();
    expect(toMetricRow({ feature: 'assistant', outcome: 'whatever' })).toBeNull();
  });

  it('recording never throws, even when storage fails', async () => {
    const seen = [];
    _setLocalMetricsSink(async (r) => { seen.push(r); throw new Error('db down'); });
    expect(() => recordLocalAiEvent({ feature: 'falc', outcome: 'drafted', model: 'qwen3:8b' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.map((r) => r.type)).toEqual(['falc.drafted']);
  });

  it('the citizen assistant records every outcome through the local module only (never the Gemini metrics)', () => {
    expect(chat).toContain("from '../../lib/local-ai-metrics.js'");
    for (const o of ['answered', 'abstained', 'blocked', 'error']) expect(chat).toContain(`outcome: '${o}'`);
    expect(chat).not.toMatch(/recordLocalAiEvent\([^)]*(trimmedMessage|message|content\.answer|verifiedRecords)/);
  });
});
