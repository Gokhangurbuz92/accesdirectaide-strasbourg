/**
 * PKG-6 / D17 N14 — the citizen assistant explains, it never decides: an answer promising eligibility is replaced by an abstention before the person sees it;
 * the person's assessment can be given READ-ONLY (it reaches the model as assessmentReadOnly and is never returned or changed); a malformed assessment is refused.
 * Retrieval and the local model are mocked (no database, no network); the guards, prompt building and post-validation are the real handler code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ aides: vi.fn(), generate: vi.fn() }));
vi.mock('../../api/_utils/logger.js', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1') }));
vi.mock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: mocks.aides }));
vi.mock('../../api/lib/search-query.js', () => ({ searchDemarches: vi.fn().mockResolvedValue({ items: [] }), searchStructures: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock('../../api/lib/ai-foundation.js', () => ({ generateCitizenLocalStructuredContent: mocks.generate, generateCitizenLocalQueryEmbedding: vi.fn().mockResolvedValue({ embedding: Array.from({ length: 768 }, (_, i) => (i ? 0 : 1)), embeddingModel: 'nomic-embed-text' }) }));
vi.mock('../../api/lib/geography/AssistantTerritoryResolver.js', () => ({ resolveAssistantTerritory: vi.fn().mockResolvedValue({ status: 'RESOLVED', territory: { id: 't', type: 'COMMUNE', officialCode: '67482', label: 'Strasbourg', territoryIds: ['t'] } }) }));

import handler from '../../api/_handlers/assistant/chat.js';

const record = { id: 'n14-aide', slug: 'n14-aide', titre: 'Aide au logement (fictive)', summary_falc: 'Aide pour payer le loyer. Demande à la CAF.', provenance: { sourceUrl: 'https://www.caf.fr/n14', verifiedAt: '2026-10-01' }, sourceUrl: 'https://www.caf.fr/n14', verifiedAt: '2026-10-01' };
const call = async (body) => { const out = { statusCode: 200, body: null }; out.status = (c) => { out.statusCode = c; return out; }; out.json = (b) => { out.body = b; return out; }; await handler({ method: 'POST', body, headers: {}, requestId: 'n14' }, out); return out; };
const answerWith = (text) => mocks.generate.mockImplementation(async ({ prompt }) => { const ids = JSON.parse(prompt).verifiedRecords.map((r) => r.sourceId); return { content: { answer: text, citedSourceIds: ids.slice(0, 1), abstain: false } }; });

beforeEach(() => { vi.clearAllMocks(); mocks.aides.mockResolvedValue({ items: [record] }); });

describe('PKG-6 N14: the assistant never decides eligibility', () => {
  it('a model answer promising eligibility is never shown (abstention eligibility_claim_blocked)', async () => {
    answerWith('Oui, vous avez droit à cette aide, demandez-la à la CAF.');
    const r = await call({ message: 'Ai-je droit à l’aide au logement ?', context: { territory: 'Strasbourg' } });
    expect(r.statusCode).toBe(200); expect(r.body.abstention).toBe(true); expect(r.body.meta.reason).toBe('eligibility_claim_blocked');
    expect(JSON.stringify(r.body)).not.toMatch(/vous avez droit/i);
  });
  it('an explanation with sources passes; the assessment is given read-only and never returned', async () => {
    answerWith('Selon la fiche, cette aide aide à payer le loyer ; la demande se fait auprès de la CAF.');
    const assessment = [{ rightId: 'apl', state: 'A_VERIFIER' }];
    const r = await call({ message: 'Comment demander l’aide au logement ?', context: { territory: 'Strasbourg', assessment } });
    expect(r.body.abstention).not.toBe(true); expect(r.body.citations.length).toBe(1);
    const prompt = JSON.parse(mocks.generate.mock.calls[0][0].prompt);
    expect(prompt.assessmentReadOnly).toEqual(assessment);
    expect(mocks.generate.mock.calls[0][0].systemInstruction).toMatch(/ne les modifie jamais/);
    expect(r.body).not.toHaveProperty('assessment'); expect(r.body).not.toHaveProperty('state');
    expect(assessment).toEqual([{ rightId: 'apl', state: 'A_VERIFIER' }]);
  });
  it('a malformed assessment is refused before retrieval', async () => {
    const r = await call({ message: 'Bonjour', context: { territory: 'Strasbourg', assessment: [{ rightId: 'x', state: { eligible: true } }] } });
    expect(r.statusCode).toBe(400); expect(mocks.aides).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
});
