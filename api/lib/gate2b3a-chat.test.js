import { describe, it, expect, vi } from 'vitest';
import { chatWithRulePack } from './gemini.js';
import * as GeminiSDK from '@google/generative-ai';

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
                response: { text: () => 'Mocked Gemini Response', usageMetadata: {} }
            })
        })
    }))
}));

describe('Gate 2B-3A: Public / Citizen Chat Test', () => {
    it('should NOT call Gemini SDK and must fallback locally when audience is CITIZEN', async () => {
        process.env.GEMINI_API_KEY = 'synthetic-key-must-not-override';
        const response = await chatWithRulePack('Je cherche une aide au logement');
        
        expect(response.answer).toContain('actuellement désactivé');
        expect(GeminiSDK.GoogleGenerativeAI).not.toHaveBeenCalled();
    });
});
