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

        expect(scrubbed.user.id).toBe('[MASQUÉ-RGPD]');
        expect(scrubbed.user.email).toBe('[REDACTED]');
        expect(scrubbed.user.phone).toBe('[REDACTED]');
        expect(scrubbed.request.headers.authorization).toBe('[REDACTED]');
        expect(scrubbed.request.headers.cookie).toBe('[REDACTED]');
        expect(scrubbed.request.headers['set-cookie']).toBe('[REDACTED]');
        
        expect(scrubbed.request.data.password).toBe('[REDACTED]');
        expect(scrubbed.request.data.passwordHash).toBe('[REDACTED]');
        expect(scrubbed.request.data.apiKey).toBe('[REDACTED]');
        expect(scrubbed.request.data.accessToken).toBe('[REDACTED]');
        expect(scrubbed.request.data.refreshToken).toBe('[REDACTED]');
        expect(scrubbed.request.data.prompt).toBe('[REDACTED]');
        expect(scrubbed.request.data.response).toBe('[REDACTED]');
        expect(scrubbed.request.data.health).toBe('[REDACTED]');
        expect(scrubbed.request.data.disability).toBe('[REDACTED]');
        expect(scrubbed.request.data.NIR).toBe('[REDACTED]');
        expect(scrubbed.request.data.IBAN).toBe('[REDACTED]');

        expect(scrubbed.extra.diagnostic).toBe('[REDACTED]');
        expect(scrubbed.contexts.sharedDiagnostic).toBe('[REDACTED]');
        
        expect(scrubbed.tags.email).toBe('[REDACTED]');
        expect(scrubbed.breadcrumbs[0].data.password).toBe('[REDACTED]');
    });

    it('should scrub sensitive AI prompts from breadcrumbs', () => {
        const rawBreadcrumb = {
            category: 'console',
            message: 'Sending prompt to Gemini: diagnostic usager tres difficile',
            data: { someData: 'yes' }
        };

        const scrubbed = sanitizeSentryBreadcrumb(rawBreadcrumb);

        expect(scrubbed.message).toBe('[REDACTED SENSITIVE BREADCRUMB]');
        expect(scrubbed.data).toBeUndefined();
    });
});
