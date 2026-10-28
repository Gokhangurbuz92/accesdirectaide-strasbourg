import { describe, it, expect, vi } from 'vitest';
import { AIProviderPolicy, PROVIDER, AUDIENCE, LOCALITY } from './ai-policy.js';
import { mask } from './logger.js';
import { redactValue } from '../_utils/redact.js';

describe('Gate 2B-3A: AIProviderPolicy Enforcement', () => {
    it('should block Gemini for CITIZEN audience', () => {
        const policy = AIProviderPolicy.evaluate({provider: PROVIDER.GEMINI, audience: AUDIENCE.CITIZEN});
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe('AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE');
    });

    it('should block Gemini for PUBLIC audience', () => {
        const policy = AIProviderPolicy.evaluate({provider: PROVIDER.GEMINI, audience: AUDIENCE.PUBLIC});
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe('AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE');
    });

    it('should block Gemini for PROFESSIONAL audience pending review', () => {
        const policy = AIProviderPolicy.evaluate({provider: PROVIDER.GEMINI, audience: AUDIENCE.PROFESSIONAL});
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe('BLOCKED_PENDING_PROVIDER_REVIEW');
    });

    it('should allow OLLAMA for any audience', () => {
        const policy = AIProviderPolicy.evaluate({provider: PROVIDER.OLLAMA, audience: AUDIENCE.CITIZEN, locality: LOCALITY.LOCAL_LOOPBACK});
        expect(policy.allowed).toBe(true);
    });

    it('should block unknown providers', () => {
        const policy = AIProviderPolicy.evaluate({provider: 'OPENAI', audience: AUDIENCE.CITIZEN});
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe('UNKNOWN_PROVIDER_DENIED');
    });
});

describe('Gate 2B-3A: Logger & Redaction', () => {
    it('should redact NIR, IBAN, prompt, dossier from redactValue', () => {
        const payload = {
            nir: '1 90 12 34 567 890 12',
            iban: 'FR76 1234 5678 9012 3456 7890 123',
            prompt: 'Explain this to me',
            dossier: 'sensitive medical info',
            diagnostic: 'some json'
        };
        const redacted = redactValue(payload);
        expect(redacted).toMatchObject({ nir: '[REDACTED]' });
        expect(redacted).toMatchObject({ iban: '[REDACTED]' });
        expect(redacted).toMatchObject({ prompt: '[REDACTED]' });
        expect(redacted).toMatchObject({ dossier: '[REDACTED]' });
        expect(redacted).toMatchObject({ diagnostic: '[REDACTED]' });
    });

    it('should redact password and auth tokens in logger mask', () => {
        const data = { password: 'my-secret-password', cookie: 'session=123', email: 'test@example.com' };
        const masked = mask(data);
        expect(masked.password).toBe('[REDACTED]');
        expect(masked.cookie).toBe('[REDACTED]');
        expect(masked.email).toBe('t***@example.com');
    });
});
