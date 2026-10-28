import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Gate 2B-3A: OpenFisca Safety', () => {
    /**
* @type {NodeJS.ProcessEnv}
*/
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('production + public prototype: BLOCKED', async () => {
        process.env.NODE_ENV = 'production';
        process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
        process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE = 'false';
        await expect(import('./openfiscaClient.js')).rejects.toThrow('OPENFISCA_PROTOTYPE_ENDPOINT_FORBIDDEN_IN_PRODUCTION');
    });

    it('production + public prototype + opt-in=true: STILL BLOCKED', async () => {
        process.env.NODE_ENV = 'production';
        process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
        process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE = 'true';
        await expect(import('./openfiscaClient.js')).rejects.toThrow('OPENFISCA_PROTOTYPE_ENDPOINT_FORBIDDEN_IN_PRODUCTION');
    });

    it('development + prototype + true: ALLOWED', async () => {
        process.env.NODE_ENV = 'development';
        process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
        process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE = 'true';
        const module = await import('./openfiscaClient.js');
        expect(module).toBeDefined();
    });

    it('development + prototype + false: BLOCKED', async () => {
        process.env.NODE_ENV = 'development';
        process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
        process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE = 'false';
        await expect(import('./openfiscaClient.js')).rejects.toThrow('OPENFISCA_PROTOTYPE_ENDPOINT_BLOCKED');
    });

    it('development + prototype + unset: BLOCKED', async () => {
        process.env.NODE_ENV = 'development';
        process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
        delete process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE;
        await expect(import('./openfiscaClient.js')).rejects.toThrow('OPENFISCA_PROTOTYPE_ENDPOINT_BLOCKED');
    });

    it('production + controlled endpoint: ACCEPTED', async () => {
        process.env.NODE_ENV = 'production';
        process.env.OPENFISCA_URL = 'https://private.openfisca.internal.net';
        process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE = 'false';
        const module = await import('./openfiscaClient.js');
        expect(module).toBeDefined();
    });

    it('direct account identifiers: 0', async () => {
        const { buildTestCase } = await import('./openfiscaMapping.js');
        const diagnosticInput = {
            userId: '123-uuid',
            email: 'test@example.com',
            phone: '0600000000',
            name: 'Jean Dupont',
            birthDate: '1990-01-01',
            income: { salary: 1500 }
        };
        const payload = /** @type {{ individus: Record<string, { date_naissance: { ETERNITY: string } }> }} */ (buildTestCase(diagnosticInput));
        const person = payload.individus['ind_1'];
        expect(person.date_naissance.ETERNITY).toBe('1990-01-01');
        
        const strPayload = JSON.stringify(payload).toLowerCase();
        expect(strPayload).not.toContain('test@example.com');
        expect(strPayload).not.toContain('0600000000');
        expect(strPayload).not.toContain('jean dupont');
        expect(strPayload).not.toContain('123-uuid');
    });
});
