import { describe, it, expect, vi } from 'vitest';

vi.mock('../_utils/auth.js', () => ({
    requireProAuth: /** @template Handler @param {Handler} handler */ (handler) => handler,
    requireProStructureContext: () => ({ structureId: 1, userId: 1, role: 'PRO' })
}));

vi.mock('../../src/db/index.ts', () => {
    return {
        db: {
            query: {
                SharedDiagnostic: {
                    findFirst: vi.fn().mockResolvedValue({ id: 'test-share', results: {} })
                }
            }
        }
    };
});
vi.mock('../../src/db/index.js', () => {
    return {
        db: {
            query: {
                SharedDiagnostic: {
                    findFirst: vi.fn().mockResolvedValue({ id: 'test-share', results: {} })
                }
            }
        }
    };
});
vi.mock('../../../src/db/index.ts', () => {
    return {
        db: {
            query: {
                SharedDiagnostic: {
                    findFirst: vi.fn().mockResolvedValue({ id: 'test-share', results: {} })
                }
            }
        }
    };
});
vi.mock('../../../src/db/index.js', () => {
    return {
        db: {
            query: {
                SharedDiagnostic: {
                    findFirst: vi.fn().mockResolvedValue({ id: 'test-share', results: {} })
                }
            }
        }
    };
});

// RC5: the handler resolves the dossier through the structure-grant helper (SQL covered by tests/integration/rc5-dossier-authz-db.test.js); here its outcome is scripted.
const access = vi.hoisted(() => /** @type {{ result: { status: string, shared?: any, grant?: any } }} */ ({ result: { status: 'ok', shared: { id: 'test-share', results: { rights: [] } }, grant: { purposes: 'PURP-06,PURP-05' } } }));
vi.mock('../_utils/share-access.js', async (orig) => ({ ...(await orig()), resolveDossierForStructure: async () => access.result }));
const gemini = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/gemini.js', async (orig) => { const real = /** @type {any} */ (await orig()); return { ...real, generateText: async (/** @type {any[]} */ ...a) => { gemini.calls += 1; return real.generateText(...a); } }; });

// PKG-6 / R17 overlay (owner decision 2026-10-21, R17_LOCAL_SYNTHESIS_OVERLAY_V1.md): the synthesis uses the LOCAL model only. The local model is replaced by a
// scripted « unavailable » answer here (no network, no database write); Gemini keeps its counter and must never be reached.
vi.mock('../lib/ai-foundation.js', async (orig) => ({ ...(/** @type {any} */ (await orig())), generateStructuredContent: async () => ({ content: null, model: 'qwen3:8b', provider: 'ollama', safeErrorState: 'UNAVAILABLE' }) }));
import dossierHandler from '../_handlers/pro/dossier-synthesis.js';

describe('Gate 2B-3A: Dossier Synthesis Test', () => {
    it('R17 (was: 403 IA_BLOCKED_PENDING_REVIEW for Gemini): with the citizen consent the LOCAL model is asked; when it is unavailable the answer is an honest 503 and Gemini is never reached', async () => {
        const req = {
            method: 'POST',
            user: { role: 'pro', structureId: 1 },
            body: { shareId: 'test-share' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        // fixture only (R17 overlay): one synthetic orientation item, with the citizen's AI consent — an empty dossier is refused before any model call
        access.result = { status: 'ok', shared: { id: 'test-share', results: { assessment: { items: [{ code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', missingFacts: [], whoToAsk: 'votre CAF' }] } } }, grant: { purposes: 'PURP-06,PURP-05' } };
        await dossierHandler(req, res);
        
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'AI_LOCAL_UNAVAILABLE' }));
        expect(gemini.calls).toBe(0);
    });

    const call = async () => {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        await dossierHandler({ method: 'POST', user: { role: 'pro', structureId: 1 }, body: { shareId: 'test-share' } }, res);
        return res;
    };

    it('RC5: no grant / unknown id -> 404, expired -> 410, citizen did not agree to PURP-05 for this organization -> 403; the external AI provider is never reached in these cases', async () => {
        gemini.calls = 0;
        const shared = { id: 'test-share', results: { rights: [] } };
        access.result = { status: 'not_found' };
        let r = await call(); expect(r.status).toHaveBeenCalledWith(404);
        access.result = { status: 'expired', shared, grant: { purposes: 'PURP-06,PURP-05' } };
        r = await call(); expect(r.status).toHaveBeenCalledWith(410);
        for (const purposes of ['PURP-06', '', undefined, 'PURP-05x', 'PURP-050']) {   // sharing alone, nothing, malformed: never unlocks the external provider
            access.result = { status: 'ok', shared, grant: { purposes } };
            r = await call(); expect(r.status).toHaveBeenCalledWith(403); expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'AI_CONSENT_REQUIRED' }));
        }
        expect(gemini.calls).toBe(0);
        access.result = { status: 'ok', shared, grant: { purposes: 'PURP-06,PURP-05' } };
    });
});
