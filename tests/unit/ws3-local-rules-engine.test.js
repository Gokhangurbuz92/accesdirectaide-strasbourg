import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    LOCAL_SIMULATION_DISCLAIMER,
    LOCAL_SIMULATION_FIXTURE,
    LOCAL_SIMULATION_MODE,
    runLocalSimulation,
} from '../../api/lib/LocalRulesEngine.js';

const fixtures = JSON.parse(readFileSync('tests/fixtures/ws3-diagnostic-fixtures.json', 'utf8'));

describe('WS3 LocalRulesEngine', () => {
    it('is deterministic for every frozen fixture', () => {
        for (const scenario of fixtures.scenarios) {
            expect(runLocalSimulation(scenario.answers)).toEqual(runLocalSimulation(scenario.answers));
        }
    });

    it('always identifies itself as non-authoritative', () => {
        const out = runLocalSimulation(fixtures.scenarios[0].answers);
        expect(out.mode).toBe(LOCAL_SIMULATION_MODE);
        expect(out.mode).toBe('SIMULATION_NON_AUTHORITATIVE');
        expect(out.authoritative).toBe(false);
        expect(out.disclaimer).toBe(LOCAL_SIMULATION_DISCLAIMER);
        expect(out.scenarioFixture).toBe(LOCAL_SIMULATION_FIXTURE);
        expect(out.meta.remoteCallUsed).toBe(false);
    });

    it('covers RSA, APL and FAJ Strasbourg', () => {
        const codes = runLocalSimulation(fixtures.scenarios[1].answers).rights.map((r) => r.code);
        expect(codes).toEqual(['rsa', 'apl', 'faj-strasbourg']);
    });

    it('fails closed for malformed or negative input', () => {
        expect(() => runLocalSimulation(null)).toThrow(/answers is required/);
        expect(() => runLocalSimulation({ birthDate: 'bad-date' })).toThrow(/birthDate/);
        expect(() => runLocalSimulation({ birthDate: '1990-01-01', income: { salary: -1 } })).toThrow(/non-negative/);
    });
});
