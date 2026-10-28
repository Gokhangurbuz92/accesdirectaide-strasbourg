/**
 * R13 (D17 / D23) — the local model is constrained by the REAL JSON Schema of the expected answer. With zod 4, zod-to-json-schema 3.x returned an empty schema
 * ({ $ref, definitions: { target: {} } }): Ollama got no constraint, qwen3:8b answered free text or « -1.0 », and every citizen question in the LAB ended in
 * « service indisponible ». The provider is mocked; the schema handed to it is the one under test.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const seen = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../api/lib/ai-provider.js', () => {
  class OllamaProvider { async generateStructured(args) { seen.calls.push(args); return { content: { answer: 'Selon la fiche, la demande se fait auprès de la CAF.', citedSourceIds: ['aide:apl'], abstain: false }, usage: {} }; } }
  class GeminiProvider { async generateStructured() { throw new Error('no cloud in tests'); } }
  return { OllamaProvider, GeminiProvider };
});

const { providerJsonSchema, generateCitizenLocalStructuredContent } = await import('../../api/lib/ai-foundation.js');
const Grounded = z.object({ answer: z.string().min(1).max(3500), citedSourceIds: z.array(z.string()).max(8), abstain: z.boolean() });

describe('R13: the model receives the answer schema, not an empty one', () => {
  it('providerJsonSchema keeps types, bounds and required keys, closes the object, drops the draft marker', () => {
    const s = providerJsonSchema(Grounded);
    expect(s).toMatchObject({ type: 'object', required: ['answer', 'citedSourceIds', 'abstain'], additionalProperties: false,
      properties: { answer: { type: 'string', minLength: 1, maxLength: 3500 }, citedSourceIds: { type: 'array', maxItems: 8, items: { type: 'string' } }, abstain: { type: 'boolean' } } });
    expect(s).not.toHaveProperty('$schema'); expect(s).not.toHaveProperty('$ref');
  });
  it('the citizen path hands that schema to the local provider (format) and validates the answer with the zod schema', async () => {
    seen.calls.length = 0;
    const out = await generateCitizenLocalStructuredContent({ prompt: '{}', systemInstruction: 'x', zodSchema: Grounded, tools: [] });
    expect(out.safeErrorState).toBeNull(); expect(out.content.citedSourceIds).toEqual(['aide:apl']);
    expect(seen.calls[0].schema).toEqual(providerJsonSchema(Grounded));
    expect(Object.keys(seen.calls[0].schema.properties)).toEqual(['answer', 'citedSourceIds', 'abstain']);
  });
});
