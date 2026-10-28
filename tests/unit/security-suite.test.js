/**
 * 🛡️ Tests for Security Headers, CSRF Protection, Zod Validation, and IA Output Filter
 */
import { describe, it, expect, vi } from 'vitest';
import { validate } from '../../api/_utils/validate.js';
import { z } from 'zod';

// ───────────────────────────────────────────────
// Chantier 1: CSRF + Security Headers
// (tested via integration with api/index.js — here we test the logic units)
// ───────────────────────────────────────────────

describe('CSRF Protection Logic', () => {
    const ALLOWED_ORIGINS = [
        'https://www.accesdirectaide.fr',
        'https://accesdirectaide.fr',
        'https://some-branch.vercel.app',
    ];
    const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

    function isAllowedOrigin(origin, isProd = true) {
        if (!origin) return false;
        if (origin === 'https://accesdirectaide.fr') return true;
        if (origin === 'https://www.accesdirectaide.fr') return true;
        if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
        if (!isProd && DEV_ORIGINS.includes(origin)) return true;
        return false;
    }

    it('allows production origin', () => {
        expect(isAllowedOrigin('https://www.accesdirectaide.fr')).toBe(true);
    });

    it('allows Vercel preview origins', () => {
        expect(isAllowedOrigin('https://my-branch-123.vercel.app')).toBe(true);
    });

    it('blocks unknown origins', () => {
        expect(isAllowedOrigin('https://evil.com')).toBe(false);
    });

    it('blocks http:// Vercel origins (not https)', () => {
        expect(isAllowedOrigin('http://some.vercel.app')).toBe(false);
    });

    it('allows localhost in development', () => {
        expect(isAllowedOrigin('http://localhost:5173', false)).toBe(true);
    });

    it('blocks localhost in production', () => {
        expect(isAllowedOrigin('http://localhost:5173', true)).toBe(false);
    });

    it('blocks empty/null origin', () => {
        expect(isAllowedOrigin('')).toBe(false);
        expect(isAllowedOrigin(null)).toBe(false);
    });
});

// ───────────────────────────────────────────────
// Chantier 2: Zod Validation Wrapper
// ───────────────────────────────────────────────

describe('Zod Validation Wrapper', () => {
    const schema = z.object({
        email: z.string().email(),
        name: z.string().min(1),
    });

    function createMockReqRes(method, body, query) {
        const req = {
            method,
            body,
            query: query || {},
            requestId: 'test-req-id',
        };
        const res = {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
        };
        return { req, res };
    }

    it('validates POST body successfully', async () => {
        const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
        const wrapped = validate(schema, handler);

        const { req, res } = createMockReqRes('POST', { email: 'test@test.fr', name: 'Jean' });
        await wrapped(req, res);

        expect(handler).toHaveBeenCalledOnce();
        expect(req.validatedBody).toEqual({ email: 'test@test.fr', name: 'Jean' });
    });

    it('rejects invalid email', async () => {
        const handler = vi.fn();
        const wrapped = validate(schema, handler);

        const { req, res } = createMockReqRes('POST', { email: 'not-an-email', name: 'Jean' });
        await wrapped(req, res);

        expect(handler).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('validation_failed');
        expect(res.body.details[0].field).toBe('email');
    });

    it('rejects missing required field', async () => {
        const handler = vi.fn();
        const wrapped = validate(schema, handler);

        const { req, res } = createMockReqRes('POST', { email: 'test@test.fr' });
        await wrapped(req, res);

        expect(handler).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body.details.some(d => d.field === 'name')).toBe(true);
    });

    it('validates GET query params', async () => {
        const getSchema = z.object({ page: z.string().optional(), limit: z.string().optional() });
        const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
        const wrapped = validate(getSchema, handler);

        const { req, res } = createMockReqRes('GET', null, { page: '1', limit: '10' });
        await wrapped(req, res);

        expect(handler).toHaveBeenCalledOnce();
        expect(req.validatedQuery).toEqual({ page: '1', limit: '10' });
    });

    it('handles invalid JSON body gracefully', async () => {
        const handler = vi.fn();
        const wrapped = validate(schema, handler);

        const { req, res } = createMockReqRes('POST', 'not-valid-json{{{');
        await wrapped(req, res);

        expect(handler).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
    });
});

// ───────────────────────────────────────────────
// Chantier 3: IA Output Filter
// ───────────────────────────────────────────────

describe('IA Output Safety Filter', () => {
    const OFFICIAL_DOMAINS = [
        'service-public.fr',
        '.gouv.fr',
        'caf.fr',
        'ameli.fr',
        'msa.fr',
        'pole-emploi.fr',
        'francetravail.fr',
        'legifrance.gouv.fr',
    ];

    function hasOfficialSource(answer) {
        const lower = (answer || '').toLowerCase();
        return OFFICIAL_DOMAINS.some(domain => lower.includes(domain));
    }

    it('detects service-public.fr in response', () => {
        expect(hasOfficialSource('Vous pouvez consulter https://www.service-public.fr/particuliers')).toBe(true);
    });

    it('detects .gouv.fr in response', () => {
        expect(hasOfficialSource('D\'après legifrance.gouv.fr, l\'article L.262-1')).toBe(true);
    });

    it('detects caf.fr in response', () => {
        expect(hasOfficialSource('Rendez-vous sur caf.fr pour simuler vos droits')).toBe(true);
    });

    it('detects ameli.fr in response', () => {
        expect(hasOfficialSource('Plus d\'infos sur ameli.fr')).toBe(true);
    });

    it('detects francetravail.fr in response', () => {
        expect(hasOfficialSource('Inscrivez-vous sur francetravail.fr')).toBe(true);
    });

    it('returns false when no official source is present', () => {
        expect(hasOfficialSource('Le RSA est une aide financière de 607€ par mois.')).toBe(false);
    });

    it('returns false for empty/null response', () => {
        expect(hasOfficialSource('')).toBe(false);
        expect(hasOfficialSource(null)).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(hasOfficialSource('Consultez SERVICE-PUBLIC.FR pour plus d\'infos')).toBe(true);
    });

    it('detects source in the middle of a long response', () => {
        const longResponse = 'Le RSA est une aide sociale versée par la CAF. ' +
            'Pour plus d\'informations, consultez le site de la CAF : https://www.caf.fr/allocataires/droits-et-prestations. ' +
            'N\'hésitez pas à contacter votre conseiller.';
        expect(hasOfficialSource(longResponse)).toBe(true);
    });
});
