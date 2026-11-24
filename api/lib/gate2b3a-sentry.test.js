import { describe, it, expect } from 'vitest';
import { sanitizeSentryEvent, sanitizeSentryBreadcrumb } from '../_utils/sentryServer.js';

describe('Gate 2B-3A: Real Sentry Privacy Tests', () => {
    it('should strip PII and sensitive data from comprehensive Sentry event', () => {
        const rawEvent = {
            user: {
                id: '123',
                email: 'test@example.com',
                phone: '0600000000',
                ip_address: '192.168.1.1'
            },
            request: {
                url: 'https://example.com/api',
                headers: {
                    'authorization': 'Bearer token',
                    'cookie': 'session=abc',
                    'set-cookie': 'abc=def',
                },
                data: { 
                    password: 'abc',
                    passwordHash: 'def',
                    apiKey: '123',
                    accessToken: '456',
                    refreshToken: '789',
                    prompt: 'system prompt',
                    response: 'system response',
                    health: 'good',
                    disability: 'yes',
                    NIR: '123456789012345',
                    IBAN: 'FR76'
                }
            },
            extra: { 
                diagnostic: { NIR: '123', health: 'bad', nested: { email: 'x@x.com' } }
            },
            contexts: {
                sharedDiagnostic: { prompt: 'hey', response: 'ho', user: { phone: '123' } }
            },
            tags: {
                email: 'tag@example.com'
            },
            breadcrumbs: [
                { data: { password: '123' } }
            ]
        };

        const scrubbed = sanitizeSentryEvent(rawEvent);

        // R5-S1 (stricter than before): identity, request body, cookies and every header except user-agent are deleted, not masked
        expect(scrubbed.user).toBeUndefined();
        expect(scrubbed.request).toEqual({ url: 'https://example.com/api' });
        for (const v of ['test@example.com', '0600000000', '192.168.1.1', 'Bearer token', 'session=abc', '123456789012345', 'system prompt']) expect(JSON.stringify(scrubbed)).not.toContain(v);

        expect(scrubbed.extra.diagnostic).toBe('[REDACTED]');
        expect(scrubbed.contexts.sharedDiagnostic).toBe('[REDACTED]');
        
        expect(scrubbed.tags.email).toBe('[REDACTED]');
        expect(scrubbed.breadcrumbs[0].data.password).toBe('[REDACTED]');   // a breadcrumb without category: data redacted by key
    });

    it('should scrub sensitive AI prompts from breadcrumbs', () => {
        const rawBreadcrumb = {
            category: 'console',
            message: 'Sending prompt to Gemini: diagnostic usager tres difficile',
            data: { someData: 'yes' }
        };

        // R5-S1: console breadcrumbs are dropped altogether (they may print anything)
        expect(sanitizeSentryBreadcrumb(rawBreadcrumb)).toBeNull();
    });
});
