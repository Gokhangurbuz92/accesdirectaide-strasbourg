import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, test, expect } from 'vitest';
import { buildTestCase, parseResults, getCurrentPeriod } from '../../api/lib/openfiscaMapping.js';
import { RIGHTS_CATALOG, getOutputVariables } from '../../api/lib/openfiscaRightsCatalog.js';

// =========================================================================
// buildTestCase
// =========================================================================
describe('buildTestCase', () => {
    const period = '2026-02';

    test('returns correct structure with all four entity groups', () => {
        const situation = buildTestCase({ birthDate: '1992-06-15' }, period);
        expect(situation).toHaveProperty('individus.ind_1');
        expect(situation).toHaveProperty('familles.fam_1');
        expect(situation).toHaveProperty('menages.men_1');
        expect(situation).toHaveProperty('foyers_fiscaux.foy_1');
    });

    test('maps birth date as ETERNITY', () => {
        const situation = buildTestCase({ birthDate: '1992-06-15' }, period);
        expect(situation.individus.ind_1.date_naissance).toEqual({ ETERNITY: '1992-06-15' });
    });

    test('maps wizard statut "emploi" to OpenFisca activite "actif"', () => {
        const situation = buildTestCase({ statut: 'emploi' }, period);
        expect(situation.individus.ind_1.activite).toEqual({ [period]: 'actif' });
    });

    test('maps wizard statut "chomage" to OpenFisca activite "chomeur"', () => {
        const situation = buildTestCase({ statut: 'chomage' }, period);
        expect(situation.individus.ind_1.activite).toEqual({ [period]: 'chomeur' });
    });

    test('maps wizard statut "etudiant" to OpenFisca activite "etudiant"', () => {
        const situation = buildTestCase({ statut: 'etudiant' }, period);
        expect(situation.individus.ind_1.activite).toEqual({ [period]: 'etudiant' });
    });

    test('maps wizard statut "hebergement" to OpenFisca activite "inactif"', () => {
        const situation = buildTestCase({ statut: 'hebergement' }, period);
        expect(situation.individus.ind_1.activite).toEqual({ [period]: 'inactif' });
    });

    test('maps income fields correctly', () => {
        const situation = buildTestCase({
            income: { salary: 1200, unemployment: 500 },
        }, period);
        // R14 (real engine): the declared monthly situation is given for the month and the 24 months before it (RSA / housing aid read past months)
        expect(situation.individus.ind_1.salaire_net[period]).toBe(1200); expect(Object.keys(situation.individus.ind_1.salaire_net)).toHaveLength(25);
        expect(situation.individus.ind_1.chomage_net[period]).toBe(500); expect(situation.individus.ind_1.salaire_imposable[period]).toBe(1200);
    });

    test('defaults income to 0 when not provided', () => {
        const situation = buildTestCase({}, period);
        expect(Object.values(situation.individus.ind_1.salaire_net).every((v) => v === 0)).toBe(true);
        expect(Object.values(situation.individus.ind_1.chomage_net).every((v) => v === 0)).toBe(true);
    });

    test('maps housing fields correctly', () => {
        const situation = buildTestCase({
            housing: { rent: 520, charges: 50, status: 'tenant' },
        }, period);
        const menage = situation.menages.men_1;
        expect(menage.loyer).toEqual({ [period]: 520 });
        expect(menage.charges_locatives).toEqual({ [period]: 50 });
        expect(menage.statut_occupation_logement).toEqual({ [period]: 'locataire_vide' });
    });

    test('maps housing status "tenant_hlm" to "locataire_hlm"', () => {
        const situation = buildTestCase({
            housing: { status: 'tenant_hlm' },
        }, period);
        expect(situation.menages.men_1.statut_occupation_logement).toEqual({ [period]: 'locataire_hlm' });
    });

    test('maps housing status "owner" to "proprietaire"', () => {
        const situation = buildTestCase({
            housing: { status: 'owner' },
        }, period);
        expect(situation.menages.men_1.statut_occupation_logement).toEqual({ [period]: 'proprietaire' });
    });

    test('maps housing status "homeless" to "non_renseigne" (R14: « sans_domicile » is not a value the engine knows — the whole request was refused)', () => {
        const situation = buildTestCase({
            housing: { status: 'homeless' },
        }, period);
        expect(situation.menages.men_1.statut_occupation_logement).toEqual({ [period]: 'non_renseigne' });
    });

    test('defaults unknown housing status to "non_renseigne"', () => {
        const situation = buildTestCase({
            housing: { status: 'unknown_value' },
        }, period);
        expect(situation.menages.men_1.statut_occupation_logement).toEqual({ [period]: 'non_renseigne' });
    });

    test('uses depcom when provided', () => {
        const situation = buildTestCase({ depcom: '67482' }, period);
        expect(situation.menages.men_1.depcom).toEqual({ [period]: '67482' });
    });

    test('never sends a postal code as a commune code (R14): no depcom without an INSEE code', () => {
        const situation = buildTestCase({ territory: '67000' }, period);
        expect(situation.menages.men_1.depcom).toBeUndefined();
    });

    test('sets null for output variables in famille (triggers computation)', () => {
        const situation = buildTestCase({}, period);
        const famille = situation.familles.fam_1;
        expect(famille.rsa).toEqual({ [period]: null });
        expect(famille.ppa).toEqual({ [period]: null });
        expect(famille.apl).toEqual({ [period]: null });
        expect(famille.aide_logement).toEqual({ [period]: null });
    });

    test('menage has correct entity references', () => {
        const situation = buildTestCase({}, period);
        const menage = situation.menages.men_1;
        expect(menage.personne_de_reference).toEqual(['ind_1']);
        expect(menage.conjoint).toEqual([]);
        expect(menage.enfants).toEqual([]);
    });

    test('foyer_fiscal has correct entity references', () => {
        const situation = buildTestCase({}, period);
        const ff = situation.foyers_fiscaux.foy_1;
        expect(ff.declarants).toEqual(['ind_1']);
        expect(ff.personnes_a_charge).toEqual([]);
    });
});

// =========================================================================
// parseResults
// =========================================================================
describe('parseResults', () => {
    const period = '2026-02';

    const mockResponse = {
        familles: {
            fam_1: {
                rsa: { '2026-02': 564.78 },
                ppa: { '2026-02': 0 },
                apl: { '2026-02': 135.50 },
                aide_logement: { '2026-02': 135.50 },
            },
        },
    };

    test('returns array with one entry per catalog item', () => {
        const rights = parseResults(mockResponse, period);
        expect(rights).toHaveLength(RIGHTS_CATALOG.length);
    });

    test('RSA is marked as eligible with correct amount', () => {
        const rights = parseResults(mockResponse, period);
        const rsa = rights.find((r) => r.code === 'rsa');
        expect(rsa.eligible).toBe(true);
        expect(rsa.amount).toBe(564.78);
    });

    test('Prime activité (ppa) is marked as not eligible when amount is 0', () => {
        const rights = parseResults(mockResponse, period);
        const ppa = rights.find((r) => r.code === 'prime_activite');
        expect(ppa.eligible).toBe(false);
        expect(ppa.amount).toBe(0);
    });

    test('APL is marked as eligible with correct amount', () => {
        const rights = parseResults(mockResponse, period);
        const apl = rights.find((r) => r.code === 'apl');
        expect(apl.eligible).toBe(true);
        expect(apl.amount).toBe(135.50);
    });

    test('eligible rights have explainEligible text', () => {
        const rights = parseResults(mockResponse, period);
        const rsa = rights.find((r) => r.code === 'rsa');
        expect(rsa.explain).toBe(RIGHTS_CATALOG[0].explainEligible);
    });

    test('non-eligible rights have explainNotEligible text', () => {
        const rights = parseResults(mockResponse, period);
        const ppa = rights.find((r) => r.code === 'prime_activite');
        expect(ppa.explain).toBe(RIGHTS_CATALOG[1].explainNotEligible);
    });

    test('eligible rights have FALC eligible text', () => {
        const rights = parseResults(mockResponse, period);
        const rsa = rights.find((r) => r.code === 'rsa');
        expect(rsa.explain_falc).toBe(RIGHTS_CATALOG[0].explainFalcEligible);
    });

    test('eligible rights have next_steps', () => {
        const rights = parseResults(mockResponse, period);
        const rsa = rights.find((r) => r.code === 'rsa');
        expect(rsa.next_steps.length).toBeGreaterThan(0);
    });

    test('non-eligible rights have empty next_steps', () => {
        const rights = parseResults(mockResponse, period);
        const ppa = rights.find((r) => r.code === 'prime_activite');
        expect(ppa.next_steps).toEqual([]);
    });

    test('handles missing familles gracefully', () => {
        const rights = parseResults({}, period);
        expect(rights).toHaveLength(RIGHTS_CATALOG.length);
        rights.forEach((r) => {
            expect(r.eligible).toBe(false);
            expect(r.amount).toBe(0);
        });
    });

    test('rounds amounts to 2 decimal places', () => {
        const response = {
            familles: {
                fam_1: {
                    rsa: { '2026-02': 564.789999 },
                    ppa: { '2026-02': 0 },
                    apl: { '2026-02': 0 },
                    aide_logement: { '2026-02': 0 },
                },
            },
        };
        const rights = parseResults(response, period);
        const rsa = rights.find((r) => r.code === 'rsa');
        expect(rsa.amount).toBe(564.79);
    });
});

// =========================================================================
// RIGHTS_CATALOG
// =========================================================================
describe('RIGHTS_CATALOG', () => {
    test('every catalog item has required fields', () => {
        RIGHTS_CATALOG.forEach((right) => {
            expect(right).toHaveProperty('code');
            expect(right).toHaveProperty('variable');
            expect(right).toHaveProperty('label');
            expect(right).toHaveProperty('category');
            expect(right).toHaveProperty('explainEligible');
            expect(right).toHaveProperty('explainNotEligible');
            expect(right).toHaveProperty('explainFalcEligible');
            expect(right).toHaveProperty('explainFalcNotEligible');
            expect(right).toHaveProperty('nextSteps');
        });
    });

    test('prime_activite uses ppa variable (NOT prime_activite)', () => {
        const pa = RIGHTS_CATALOG.find((r) => r.code === 'prime_activite');
        expect(pa.variable).toBe('ppa');
    });

    test('getOutputVariables returns unique variable names', () => {
        const vars = getOutputVariables();
        expect(vars).toContain('rsa');
        expect(vars).toContain('ppa');
        expect(vars).toContain('apl');
        expect(vars).toContain('aide_logement');
    });
});

// =========================================================================
// getCurrentPeriod
// =========================================================================
describe('getCurrentPeriod', () => {
    test('returns string in YYYY-MM format', () => {
        const period = getCurrentPeriod();
        expect(period).toMatch(/^\d{4}-\d{2}$/);
    });
});
