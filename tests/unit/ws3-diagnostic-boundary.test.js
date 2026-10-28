import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync('api/_handlers/diagnostic.js', 'utf8');

describe('WS3 diagnostic mode boundary', () => {
    it('defaults to authoritative mode and requires explicit simulation mode', () => {
        expect(source).toContain("const mode = body.mode || 'AUTHORITATIVE_MODE';");
        expect(source).toContain("if (mode === 'SIMULATION_MODE')");
        expect(source).toContain('runLocalSimulation(answers)');
    });

    it('keeps authoritative OpenFisca failure fail-closed', () => {
        expect(source).toContain("error: 'OPENFISCA_UNAVAILABLE'");
        expect(source).toContain('return res.status(503).json({');
        expect(source).toContain('AUTHORITATIVE_MODE remains fail-closed');
        const simulationIndex = source.indexOf("if (mode === 'SIMULATION_MODE')");
        const healthIndex = source.indexOf('let engineUp = false;');
        expect(simulationIndex).toBeGreaterThan(-1);
        expect(healthIndex).toBeGreaterThan(simulationIndex);
        const authoritativeSection = source.slice(healthIndex, source.indexOf('// Build OpenFisca test case', healthIndex));
        expect(authoritativeSection).not.toContain('runLocalSimulation');
        expect(authoritativeSection).toContain('OPENFISCA_UNAVAILABLE');
    });

    it('does not mutate OpenFisca adapter implementation', () => {
        // DTA S1D (normative test change, explained): the handler loads the OpenFisca adapter lazily (dynamic import, only on the AUTHORITATIVE / trace paths) so that the explicit local
        // SIMULATION_MODE no longer depends on OpenFisca's environment; it still calls the same adapter functions in the same way, and the adapter itself is byte-identical (hash-pinned below).
        expect(source).toContain("import('../lib/openfiscaClient.js')");
        expect(source).toContain('const result = await (await openfisca()).calculate(situation);');
        expect(createHash('sha256').update(readFileSync('api/lib/openfiscaClient.js')).digest('hex')).toBe('af908bc574df28e634786913c9635f9ecccf2c731da8f66e6bae35860ea1c7f1');
    });
});
