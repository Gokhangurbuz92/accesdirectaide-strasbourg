import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as GeminiSDK from '@google/generative-ai';
import { generateStructuredContent } from './ai-foundation.js';

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
                response: { text: () => 'Mocked Gemini Response' }
            })
        })
    }))
}));

describe('Gate 2B-3A: Ollama Local Fallback Test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should NOT fallback to Gemini if local Ollama fails for CITIZEN', async () => {
        // Mock a fetch failure for Ollama
        global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

        const response = await generateStructuredContent({
            prompt: 'Test prompt',
            systemInstruction: undefined,
            zodSchema: undefined,
            signal: undefined,
            primaryProvider: 'ollama',
            fallbackProvider: 'gemini',
            audience: 'CITIZEN'
        });

        expect(GeminiSDK.GoogleGenerativeAI).not.toHaveBeenCalled();
        expect(response.safeErrorState).toBe('UNAVAILABLE');
    });
});
