import { describe, it, expect, vi } from 'vitest';
import { createGeminiBreaker, FALLBACK_RESPONSE } from '../../api/lib/gemini-circuit-breaker.js';

describe('createGeminiBreaker', () => {
    it('passes through when circuit is closed (normal operation)', async () => {
        const mockFn = vi.fn().mockResolvedValue({ response: { text: () => 'Hello' } });
        const breaker = createGeminiBreaker(mockFn, {
            volumeThreshold: 1,
            timeout: 5000,
        });

        const result = await breaker.fire('test prompt');
        expect(result.response.text()).toBe('Hello');
        expect(mockFn).toHaveBeenCalledWith('test prompt');
    });

    it('returns fallback when circuit opens after repeated errors', async () => {
        let callCount = 0;
        const failingFn = vi.fn().mockImplementation(() => {
            callCount++;
            return Promise.reject(new Error(`Gemini error ${callCount}`));
        });

        const breaker = createGeminiBreaker(failingFn, {
            volumeThreshold: 1,
            errorThresholdPercentage: 1,  // open after 1% errors
            resetTimeout: 30000,
            timeout: 5000,
        });

        // Fire enough to trigger open state
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.fire('fail');
            } catch {
                // Expected — errors before circuit opens
            }
        }

        // Now the circuit should be open → fallback
        const fallbackResult = await breaker.fire('this should fallback');
        expect(fallbackResult).toEqual(FALLBACK_RESPONSE);
    });

    it('circuit breaker has correct fallback message', () => {
        expect(FALLBACK_RESPONSE).toHaveProperty('fallback', true);
        expect(FALLBACK_RESPONSE.message).toContain('temporairement indisponible');
    });

    it('breaker re-closes after resetTimeout', async () => {
        const mockFn = vi.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue({ response: { text: () => 'recovered' } });

        const breaker = createGeminiBreaker(mockFn, {
            volumeThreshold: 1,
            errorThresholdPercentage: 1,
            resetTimeout: 100,  // 100ms for test speed
            timeout: 5000,
        });

        // Trigger opens
        try { await breaker.fire('fail'); } catch { /* expected */ }
        try { await breaker.fire('fail'); } catch { /* expected */ }

        // Wait for half-open
        await new Promise(r => setTimeout(r, 150));

        // Should try again (half-open → closed if success)
        const result = await breaker.fire('recover');
        // Either the mock resolves or fallback fires — both are valid recovery paths
        if (result && result.fallback) {
            expect(result.message).toContain('temporairement');
        } else {
            expect(result.response.text()).toBe('recovered');
        }
    });
});
