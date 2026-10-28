import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runLocalSimulation } from '../../api/lib/LocalRulesEngine.js';

const fixtures = JSON.parse(readFileSync('tests/fixtures/ws3-diagnostic-fixtures.json', 'utf8'));

describe('WS3 local diagnostic frozen fixtures', () => {
    for (const scenario of fixtures.scenarios) {
        it(`matches ${scenario.id}`, () => {
            const out = runLocalSimulation(scenario.answers);
            const byCode = Object.fromEntries(out.rights.map((r) => [r.code, r]));
            for (const code of scenario.expected.eligible) expect(byCode[code]?.eligible).toBe(true);
            for (const code of scenario.expected.ineligible) expect(byCode[code]?.eligible).toBe(false);
            for (const [code, amount] of Object.entries(scenario.expected.amounts || {})) expect(byCode[code]?.amount).toBe(amount);
            expect(out.authoritative).toBe(false);
            expect(out.mode).toBe('SIMULATION_NON_AUTHORITATIVE');
        });
    }
});
