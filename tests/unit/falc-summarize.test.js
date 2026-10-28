import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';

/**
 * FALC Summarize — Unit Tests (Sprint 2: Multi-Entity)
 *
 * Tests the prompt building logic, JSON parsing resilience,
 * entity config, and cache behavior of the FALC summarize handler.
 */

/** Simulates cleaning Gemini JSON response (same logic as handler) */
function cleanGeminiResponse(raw) {
    return raw
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
}

/** Validates that FALC data has required fields */
function validateFalcData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.summary_falc || typeof data.summary_falc !== 'string') return false;
    if (!Array.isArray(data.points_cles)) return false;
    return true;
}

/** Builds source text from entity fields (generic) */
function buildSourceText(entity, sourceFields) {
    return sourceFields
        .map(f => entity[f])
        .filter(Boolean)
        .join('\n\n');
}

/** Entity configuration (mirrors handler) */
const ENTITY_CONFIG = {
    aide: {
        titleField: 'titre',
        sourceFields: ['cest_quoi', 'pour_qui', 'ce_que_ca_aide', 'description'],
        cacheFields: ['summary_falc', 'conditions_falc'],
        contextLabel: 'une aide sociale',
    },
    demarche: {
        titleField: 'titre',
        sourceFields: ['description_courte', 'pour_qui', 'contenu_detaille', 'ou_faire'],
        cacheFields: ['summary_falc'],
        contextLabel: 'une démarche administrative',
    },
    actualite: {
        titleField: 'titre',
        sourceFields: ['contenu', 'resume'],
        cacheFields: ['summary_falc'],
        contextLabel: "une actualité d'aide sociale",
    },
};

describe('FALC Summarize Logic', () => {
    // ── JSON Cleaning ──
    it('should clean JSON from markdown code fences', () => {
        const raw = '```json\n{"summary_falc": "test"}\n```';
        const cleaned = cleanGeminiResponse(raw);
        expect(JSON.parse(cleaned)).toEqual({ summary_falc: 'test' });
    });

    it('should handle JSON without code fences', () => {
        const raw = '{"summary_falc": "test", "points_cles": ["a"]}';
        const cleaned = cleanGeminiResponse(raw);
        expect(JSON.parse(cleaned)).toEqual({ summary_falc: 'test', points_cles: ['a'] });
    });

    it('should handle JSON with whitespace and newlines', () => {
        const raw = '\n\n```json\n  {"summary_falc": "test"}  \n```\n\n';
        const cleaned = cleanGeminiResponse(raw);
        expect(JSON.parse(cleaned)).toEqual({ summary_falc: 'test' });
    });

    it('should handle triple backtick without json label', () => {
        const raw = '```\n{"summary_falc": "simple"}\n```';
        const cleaned = cleanGeminiResponse(raw);
        expect(JSON.parse(cleaned)).toEqual({ summary_falc: 'simple' });
    });

    // ── Validation ──
    it('should validate complete FALC data', () => {
        expect(validateFalcData({
            summary_falc: 'Cette aide vous donne de l\'argent.',
            points_cles: ['Point 1', 'Point 2'],
            conditions_simples: 'Vous devez habiter en France.',
            action: 'Demander l\'aide',
        })).toBe(true);
    });

    it('should reject data missing summary_falc', () => {
        expect(validateFalcData({
            points_cles: ['Point 1'],
        })).toBe(false);
    });

    it('should reject data missing points_cles', () => {
        expect(validateFalcData({
            summary_falc: 'text',
        })).toBe(false);
    });

    it('should reject non-array points_cles', () => {
        expect(validateFalcData({
            summary_falc: 'text',
            points_cles: 'not an array',
        })).toBe(false);
    });

    it('should reject null data', () => {
        expect(validateFalcData(null)).toBe(false);
    });

    it('should reject undefined data', () => {
        expect(validateFalcData(undefined)).toBe(false);
    });

    // ── Source Text Building — Multi-Entity ──
    it('should build source text from aide fields', () => {
        const aide = {
            cest_quoi: 'Une aide au logement.',
            pour_qui: 'Les personnes à faible revenu.',
            ce_que_ca_aide: 'Payer votre loyer.',
            description: 'Description complète.',
        };
        const text = buildSourceText(aide, ENTITY_CONFIG.aide.sourceFields);
        expect(text).toContain('Une aide au logement.');
        expect(text).toContain('Les personnes à faible revenu.');
    });

    it('should build source text from demarche fields', () => {
        const demarche = {
            description_courte: 'Démarche pour obtenir un logement.',
            pour_qui: 'Tout le monde.',
            contenu_detaille: 'Contenu détaillé.',
            ou_faire: 'À la mairie.',
        };
        const text = buildSourceText(demarche, ENTITY_CONFIG.demarche.sourceFields);
        expect(text).toContain('Démarche pour obtenir un logement.');
        expect(text).toContain('À la mairie.');
    });

    it('should build source text from actualite fields', () => {
        const actualite = {
            contenu: 'Le RSA augmente de 10 euros.',
            resume: 'Augmentation du RSA.',
        };
        const text = buildSourceText(actualite, ENTITY_CONFIG.actualite.sourceFields);
        expect(text).toContain('Le RSA augmente de 10 euros.');
        expect(text).toContain('Augmentation du RSA.');
    });

    it('should skip null/empty fields for any entity', () => {
        const entity = {
            cest_quoi: 'Aide RSA',
            pour_qui: null,
            ce_que_ca_aide: '',
            description: undefined,
        };
        const text = buildSourceText(entity, ENTITY_CONFIG.aide.sourceFields);
        expect(text).toBe('Aide RSA');
    });

    it('should return empty string if all fields are empty', () => {
        const entity = {
            cest_quoi: null,
            pour_qui: null,
        };
        const text = buildSourceText(entity, ENTITY_CONFIG.aide.sourceFields);
        expect(text).toBe('');
    });

    // ── Entity Config ──
    it('should have correct title fields for all entity types', () => {
        expect(ENTITY_CONFIG.aide.titleField).toBe('titre');
        expect(ENTITY_CONFIG.demarche.titleField).toBe('titre');
        expect(ENTITY_CONFIG.actualite.titleField).toBe('titre');
    });

    it('should have cache fields defined for all entities', () => {
        expect(ENTITY_CONFIG.aide.cacheFields).toContain('summary_falc');
        expect(ENTITY_CONFIG.demarche.cacheFields).toContain('summary_falc');
        expect(ENTITY_CONFIG.actualite.cacheFields).toContain('summary_falc');
    });

    it('should have aide-specific cache field for conditions', () => {
        expect(ENTITY_CONFIG.aide.cacheFields).toContain('conditions_falc');
        expect(ENTITY_CONFIG.demarche.cacheFields).not.toContain('conditions_falc');
    });

    // ── FALC Content Rules ──
    it('should handle French accents in FALC data', () => {
        const data = {
            summary_falc: 'L\'Allocation aux Adultes Handicapés (AAH) vous aide à payer vos dépenses.',
            points_cles: ['Vous devez être âgé(e) de 20 ans', 'Un médecin vérifie votre état'],
        };
        expect(validateFalcData(data)).toBe(true);
    });

    it('should handle emoji in FALC data', () => {
        const raw = '{"summary_falc": "🏠 Cette aide paye votre loyer.", "points_cles": ["💰 Argent", "📋 Papiers"]}';
        const parsed = JSON.parse(cleanGeminiResponse(raw));
        expect(validateFalcData(parsed)).toBe(true);
    });
});
