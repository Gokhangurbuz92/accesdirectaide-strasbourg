import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/DiagnosticPage.jsx', 'utf8');
const disclaimer = "Cette simulation est indicative et non-opposable. Seule une instruction officielle par l&apos;organisme compétent (CAF, CPAM, Département) a valeur légale.";

describe('WS3 diagnostic UI contract', () => {
    it('requests explicit simulation mode', () => {
        expect(source).toContain("mode: 'SIMULATION_MODE'");
        expect(source).toContain('householdSize: Number(situation.householdSize) || 1');
        expect(source).toContain("territory: situation.zipCode || ''");
    });

    it('exposes non-authoritative status and disclaimer accessibly', () => {
        expect(source).toContain('data-testid="simulation-mode-badge"');
        expect(source).toContain('role="status"');
        expect(source).toContain('aria-live="polite"');
        expect(source).toContain('Simulation locale — indicative et non-opposable');
        expect(source).toContain(disclaimer);
        expect(source).toContain('role="alert"');
        expect(source).toContain('aria-live="assertive"');
    });

    it('keeps explicit form labels for core diagnostic inputs', () => {
        for (const id of ['diag-birthdate', 'diag-salary', 'diag-unemployment', 'diag-rent', 'diag-charges', 'diag-household', 'diag-employment', 'diag-zip']) {
            expect(source).toContain(`htmlFor="${id}"`);
            expect(source).toContain(`id="${id}"`);
        }
    });
});
