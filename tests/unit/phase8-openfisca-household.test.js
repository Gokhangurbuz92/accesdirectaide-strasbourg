import { describe, it, expect } from 'vitest';
import { buildTestCase, getCurrentPeriod } from '../../api/lib/openfiscaMapping.js';
import { RIGHTS_CATALOG } from '../../api/lib/openfiscaRightsCatalog.js';

describe('OpenFisca Mapping - Household model', () => {
    const period = getCurrentPeriod();
    const outputVariables = RIGHTS_CATALOG.map(r => r.variable);
    
    it('handles single adult (existing behavior preserved)', () => {
        const answers = {
            birthDate: '1980-05-15',
            statut: 'emploi',
            income: { salary: 1500 }
        };
        const result = buildTestCase(answers, period);
        
        expect(result.individus.ind_1).toBeDefined();
        expect(result.individus.ind_1.date_naissance.ETERNITY).toBe('1980-05-15');
        expect(result.individus.ind_2).toBeUndefined();
        
        expect(result.familles.fam_1.parents).toEqual(['ind_1']);
        expect(result.familles.fam_1.enfants).toEqual([]);
        
        expect(result.menages.men_1.personne_de_reference).toEqual(['ind_1']);
        expect(result.menages.men_1.conjoint).toEqual([]);
        expect(result.menages.men_1.enfants).toEqual([]);
        
        expect(result.foyers_fiscaux.foy_1.declarants).toEqual(['ind_1']);
        expect(result.foyers_fiscaux.foy_1.personnes_a_charge).toEqual([]);
        
        // Verify new benefit variables
        expect(result.familles.fam_1.af).toBeDefined();
        expect(result.familles.fam_1.cf).toBeDefined();
        expect(result.familles.fam_1.asf).toBeDefined();
    });

    it('handles couple (2 adults, 0 children)', () => {
        const answers = {
            situation_familiale: 'couple'
        };
        const result = buildTestCase(answers, period);
        
        expect(result.individus.ind_1).toBeDefined();
        expect(result.individus.ind_2).toBeDefined();
        
        expect(result.familles.fam_1.parents).toEqual(['ind_1', 'ind_2']);
        expect(result.familles.fam_1.enfants).toEqual([]);
        
        expect(result.menages.men_1.conjoint).toEqual(['ind_2']);
    });
    
    it('handles single parent + 2 children', () => {
        const answers = {
            nombre_enfants: 2
        };
        const result = buildTestCase(answers, period);
        
        expect(result.individus.ind_1).toBeDefined();
        expect(result.individus.ind_2).toBeUndefined();
        expect(result.individus.enfant_1).toBeDefined();
        expect(result.individus.enfant_2).toBeDefined();
        
        expect(result.familles.fam_1.parents).toEqual(['ind_1']);
        expect(result.familles.fam_1.enfants).toEqual(['enfant_1', 'enfant_2']);
    });
    
    it('handles couple + 3 children', () => {
        const answers = {
            has_conjoint: true,
            nombre_enfants: 3
        };
        const result = buildTestCase(answers, period);
        
        expect(result.familles.fam_1.parents).toEqual(['ind_1', 'ind_2']);
        expect(result.familles.fam_1.enfants).toEqual(['enfant_1', 'enfant_2', 'enfant_3']);
    });
    
    it('handles children with specific ages/dates', () => {
        const answers = {
            enfants: [
                { date_naissance: '2010-05-10' },
                { age: 5 }
            ]
        };
        const result = buildTestCase(answers, period);
        
        expect(result.individus.enfant_1.date_naissance.ETERNITY).toBe('2010-05-10');
        
        const currentYear = parseInt(period.substring(0, 4), 10);
        expect(result.individus.enfant_2.date_naissance.ETERNITY).toBe(`${currentYear - 5}-01-01`);
    });
    
    it('includes all rights catalog variables in output', () => {
        const answers = {};
        const result = buildTestCase(answers, period);
        
        // R14 (real engine): a person-level output (AAH, ASS) is asked on each adult, every other one on the family
        outputVariables.forEach(v => {
            if (['ass', 'aah'].includes(v)) expect(result.individus.ind_1[v]).toEqual({ [period]: null });
            else expect(result.familles.fam_1[v]).toEqual({ [period]: null });
        });
    });
});
