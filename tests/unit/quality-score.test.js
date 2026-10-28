import { describe, it, expect } from 'vitest';
import { computeQualityScore } from '../../api/lib/quality-score.js';

describe('computeQualityScore', () => {
    it('returns 100 for a complete aide', () => {
        const aide = {
            titre: 'Aide personnalisée au logement',
            description: 'Cette aide est destinée aux personnes en difficulté pour payer leur loyer ou les mensualités de leur prêt immobilier.',
            source_url: 'https://aides-territoires.beta.gouv.fr/aides/123',
            organisme: 'CAF',
            theme: 'LOGEMENT',
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(100);
        expect(result.details.every(d => d.met)).toBe(true);
    });

    it('returns 80 for aide without titre (or short titre)', () => {
        const aide = {
            titre: 'Court',  // < 10 chars
            description: 'Cette aide est destinée aux personnes en difficulté pour payer leur loyer.',
            source_url: 'https://example.com/aide',
            organisme: 'CAF',
            theme: 'LOGEMENT',
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(80);
        expect(result.details.find(d => d.criterion === 'titre').met).toBe(false);
    });

    it('returns 0 for an empty aide', () => {
        const result = computeQualityScore({});
        expect(result.score).toBe(0);
        expect(result.details.every(d => !d.met)).toBe(true);
    });

    it('returns 0 for null/undefined input', () => {
        expect(computeQualityScore(null).score).toBe(0);
        expect(computeQualityScore(undefined).score).toBe(0);
    });

    it('returns 60 for aide with only titre + description + organisme', () => {
        const aide = {
            titre: 'Aide personnalisée au logement',
            description: 'Description assez longue pour dépasser les cinquante caractères nécessaires.',
            organisme: 'CAF',
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(60);
    });

    it('handles alternative field names (title, summary_falc, providerName)', () => {
        const aide = {
            title: 'Allocation de solidarité spécifique',
            summary_falc: 'L\'ASS est une aide pour les demandeurs d\'emploi qui ont épuisé leurs droits au chômage.',
            source_url: 'https://www.service-public.fr/particuliers/vosdroits/F12484',
            providerName: 'Pôle Emploi',
            categories: ['EMPLOI'],
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(100);
    });

    it('rejects relative source URLs', () => {
        const aide = {
            titre: 'Aide au logement étudiant',
            description: 'Aide pour les étudiants en difficulté pour payer leur loyer universitaire.',
            source_url: '/aides/aide-logement-etudiant',  // relative!
            organisme: 'CROUS',
            theme: 'LOGEMENT',
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(80);
        expect(result.details.find(d => d.criterion === 'source_url').met).toBe(false);
    });

    it('handles array themes', () => {
        const aide = {
            titre: 'Aide multi-thème longue pour test',
            description: 'Description très longue ici pour pouvoir valider correctement cette aide.',
            source_url: 'https://example.com/aide',
            organisme: 'Région IDF',
            categories: ['LOGEMENT', 'EMPLOI'],
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(100);
    });

    it('empty array for theme counts as missing', () => {
        const aide = {
            titre: 'Aide au logement test ok',
            description: 'Description longue ici pour tester le score de qualité des aides ingérées.',
            source_url: 'https://example.com/aide',
            organisme: 'CAF',
            categories: [],
        };

        const result = computeQualityScore(aide);
        expect(result.score).toBe(80);
        expect(result.details.find(d => d.criterion === 'theme').met).toBe(false);
    });

    it('returns breakdown details for each criterion', () => {
        const result = computeQualityScore({});
        expect(result.details).toHaveLength(5);
        expect(result.details.map(d => d.criterion)).toEqual([
            'titre', 'description', 'source_url', 'organisme', 'theme',
        ]);
    });
});
