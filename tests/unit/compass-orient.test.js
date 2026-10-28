import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';

/**
 * Boussole Sociale — Unit Tests (Phase 3 — Intelligence Souveraine)
 *
 * Tests keyword extraction, territory detection, FTS query building,
 * sensitive data blocking, démarche context, metadata validation,
 * and anti-hallucination response structure.
 */

// ── Keyword extraction (mirrors orient.js logic) ──
const STOPWORDS = new Set([
    'je', 'suis', 'une', 'les', 'des', 'pour', 'dans', 'mon', 'mes', 'moi',
    'qui', 'que', 'quoi', 'est', 'sont', 'avec', 'par', 'sur', 'pas', 'plus',
    'tout', 'tous', 'quel', 'très', 'bien', 'fait', 'être', 'avoir', 'faire',
    'cette', 'chez', 'comment', 'aide', 'aider', 'besoin', 'cherche', 'trouver',
    'puis', 'aussi', 'mais', 'donc', 'car', 'comme', 'elle', 'nous', 'vous',
]);

function extractKeywords(message) {
    return message
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// ── Territory detection (mirrors orient.js logic) ──
const CITY_MAP = {
    strasbourg: '67', mulhouse: '68', colmar: '68', paris: '75',
    lyon: '69', marseille: '13', toulouse: '31', bordeaux: '33',
    lille: '59', nantes: '44', nice: '06', montpellier: '34',
    rennes: '35', grenoble: '38', dijon: '21', metz: '57',
};

function detectTerritory(message) {
    const cp = message.match(/\b(\d{5})\b/);
    if (cp) return { code_postal: cp[1], departement: cp[1].slice(0, 2) };

    const dep = message.match(/\bdépartement\s*(\d{2})\b/i) || message.match(/\b(\d{2})\b/);
    if (dep && Number(dep[1]) >= 1 && Number(dep[1]) <= 95) return { departement: dep[1] };

    const lower = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [city, dept] of Object.entries(CITY_MAP)) {
        if (lower.includes(city)) return { departement: dept, ville: city };
    }
    return null;
}

// ── FTS Query Builder (Phase 3) ──
function buildTsQuery(keywords) {
    if (!keywords || keywords.length === 0) return '';
    return keywords
        .map((k) => k.replace(/[^\w\u00C0-\u024F]/g, ''))
        .filter((k) => k.length > 0)
        .join(' | ');
}

// ── Sensitive data patterns ──
const NIR_RE = /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/;
const IBAN_FR_RE = /\bFR\s?\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{3}\b/i;
const CB_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
const SENSITIVE_PATTERNS = [NIR_RE, IBAN_FR_RE, CB_RE];

function containsSensitiveData(text) {
    return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

// ── Response structure validation ──
function validateOrientResponse(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.answer !== 'string' || !data.answer) return false;
    if (!Array.isArray(data.suggestions)) return false;
    if (!Array.isArray(data.links)) return false;
    return true;
}

// ── Anti-hallucination: validate links reference real slugs ──
function validateLinksIntegrity(links, knownSlugs) {
    if (!Array.isArray(links)) return false;
    return links.every((link) => {
        if (!link.url || typeof link.url !== 'string') return false;
        // Extract slug from URL
        const match = link.url.match(/^\/(aides|structures|demarches)\/(.+)$/);
        if (!match) return true; // Non-slug URLs (e.g. /annuaire?q=...) are OK
        return knownSlugs.includes(match[2]);
    });
}

// ── Metadata structure validation ──
function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return false;
    if (typeof metadata.links_count !== 'number') return false;
    if (typeof metadata.territory !== 'string') return false;
    if (!Array.isArray(metadata.keywords)) return false;
    if (typeof metadata.model !== 'string') return false;
    return true;
}

// ==========================================================================
// TESTS — Sprint 1-2 (Original 16 tests)
// ==========================================================================

describe('Boussole Sociale — Keyword Extraction', () => {
    it('should extract meaningful keywords from a citizen question', () => {
        const keywords = extractKeywords("J'ai besoin d'aide pour mon loyer à Strasbourg");
        expect(keywords).toContain('loyer');
        expect(keywords).toContain('strasbourg');
        expect(keywords).not.toContain('aide'); // stopword
        expect(keywords).not.toContain('mon');  // stopword
    });

    it('should filter short words (< 3 chars)', () => {
        const keywords = extractKeywords('Je suis un RSA');
        expect(keywords).not.toContain('un');
        expect(keywords).not.toContain('je');
        expect(keywords).toContain('rsa');
    });

    it('should normalize accented characters', () => {
        const keywords = extractKeywords('démarche administrative à Montréal');
        expect(keywords).toContain('demarche');
        expect(keywords).toContain('administrative');
        expect(keywords).toContain('montreal');
    });

    it('should return empty for stop-words-only input', () => {
        const keywords = extractKeywords('je suis une pour dans mon');
        expect(keywords).toEqual([]);
    });
});

describe('Boussole Sociale — Territory Detection', () => {
    it('should detect 5-digit postal code', () => {
        const result = detectTerritory('Je vis au 67000');
        expect(result).toEqual({ code_postal: '67000', departement: '67' });
    });

    it('should detect city name: Strasbourg → 67', () => {
        const result = detectTerritory("aide au logement à Strasbourg");
        expect(result).toEqual({ departement: '67', ville: 'strasbourg' });
    });

    it('should detect city name: Marseille → 13', () => {
        const result = detectTerritory("trouver une assistante sociale à Marseille");
        expect(result).toEqual({ departement: '13', ville: 'marseille' });
    });

    it('should detect city name: Lyon → 69', () => {
        const result = detectTerritory("RSA Lyon");
        expect(result).toEqual({ departement: '69', ville: 'lyon' });
    });

    it('should return null for no territorial info', () => {
        const result = detectTerritory("comment demander le RSA");
        expect(result).toBeNull();
    });

    it('should prefer postal code over city name', () => {
        const result = detectTerritory("aide 75001 Paris");
        expect(result?.departement).toBe('75');
        expect(result?.code_postal).toBe('75001');
    });

    it('should detect Mulhouse → 68', () => {
        const result = detectTerritory("aide alimentaire à Mulhouse");
        expect(result).toEqual({ departement: '68', ville: 'mulhouse' });
    });
});

describe('Boussole Sociale — Sensitive Data Blocking', () => {
    it('should detect NIR (social security number)', () => {
        expect(containsSensitiveData('Mon numéro est 1 85 05 67 123 456 78')).toBe(true);
    });

    it('should detect IBAN FR', () => {
        expect(containsSensitiveData('Mon IBAN est FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    });

    it('should detect credit card number', () => {
        expect(containsSensitiveData('Ma carte est 4111 1111 1111 1111')).toBe(true);
    });

    it('should NOT flag normal messages', () => {
        expect(containsSensitiveData("J'ai besoin d'aide pour mon loyer")).toBe(false);
    });
});

describe('Boussole Sociale — Response Validation', () => {
    it('should validate a complete orient response', () => {
        expect(validateOrientResponse({
            answer: "Voici les aides disponibles pour votre situation.",
            suggestions: ["En savoir plus sur l'APL", "Trouver un travailleur social"],
            links: [{ title: 'APL', url: '/aides/apl', type: 'aide' }],
        })).toBe(true);
    });

    it('should reject response without answer', () => {
        expect(validateOrientResponse({
            suggestions: [],
            links: [],
        })).toBe(false);
    });

    it('should reject non-object response', () => {
        expect(validateOrientResponse(null)).toBe(false);
        expect(validateOrientResponse('string')).toBe(false);
    });

    it('should reject response without suggestions array', () => {
        expect(validateOrientResponse({
            answer: 'test',
            links: [],
        })).toBe(false);
    });

    it('should reject response without links array', () => {
        expect(validateOrientResponse({
            answer: 'test',
            suggestions: [],
        })).toBe(false);
    });

    it('should validate fallback response structure', () => {
        expect(validateOrientResponse({
            answer: 'Je rencontre une difficulté technique.',
            suggestions: ['Quelles sont les aides au logement ?'],
            links: [],
        })).toBe(true);
    });
});

// ==========================================================================
// TESTS — Phase 3 (10 new tests for FTS, Démarches, metadata, anti-hallucination)
// ==========================================================================

describe('Boussole Sociale — FTS Query Builder', () => {
    it('should build OR-joined tsquery from keywords', () => {
        const query = buildTsQuery(['logement', 'rsa', 'caf']);
        expect(query).toBe('logement | rsa | caf');
    });

    it('should return empty string for no keywords', () => {
        expect(buildTsQuery([])).toBe('');
        expect(buildTsQuery(null)).toBe('');
    });

    it('should strip special characters from keywords', () => {
        const query = buildTsQuery(['l\'aide', 'RSA-socle']);
        expect(query).toBe('laide | RSAsocle');
    });
});

describe('Boussole Sociale — Démarche Context', () => {
    it('should extract keywords relevant to démarches', () => {
        const keywords = extractKeywords("comment renouveler ma carte vitale ?");
        expect(keywords).toContain('renouveler');
        expect(keywords).toContain('carte');
        expect(keywords).toContain('vitale');
    });

    it('should handle multi-word démarche queries', () => {
        const keywords = extractKeywords("demande allocation logement familiale");
        expect(keywords).toContain('demande');
        expect(keywords).toContain('allocation');
        expect(keywords).toContain('logement');
        expect(keywords).toContain('familiale');
    });
});

describe('Boussole Sociale — Anti-Hallucination (Links Integrity)', () => {
    it('should validate links that reference known slugs', () => {
        const knownSlugs = ['apl-aide-logement', 'rsa-revenu-solidarite', 'caf-strasbourg'];
        const links = [
            { title: 'APL', url: '/aides/apl-aide-logement', type: 'aide' },
            { title: 'CAF Strasbourg', url: '/structures/caf-strasbourg', type: 'structure' },
        ];
        expect(validateLinksIntegrity(links, knownSlugs)).toBe(true);
    });

    it('should reject links with fabricated slugs', () => {
        const knownSlugs = ['apl-aide-logement'];
        const links = [
            { title: 'Fake Aid', url: '/aides/fake-aide-inventee', type: 'aide' },
        ];
        expect(validateLinksIntegrity(links, knownSlugs)).toBe(false);
    });

    it('should accept non-slug URLs (annuaire, view?id=)', () => {
        const knownSlugs = [];
        const links = [
            { title: 'CAF', url: '/annuaire?q=CAF', type: 'structure' },
        ];
        expect(validateLinksIntegrity(links, knownSlugs)).toBe(true);
    });
});

describe('Boussole Sociale — Metadata Validation', () => {
    it('should validate enriched metadata structure', () => {
        expect(validateMetadata({
            links_count: 3,
            territory: '67',
            keywords: ['logement', 'strasbourg'],
            model: 'gemini-2.5-flash-preview-05-20',
            aides_count: 2,
            structures_count: 1,
            demarches_count: 0,
        })).toBe(true);
    });

    it('should reject metadata without model string', () => {
        expect(validateMetadata({
            links_count: 0,
            territory: 'national',
            keywords: [],
        })).toBe(false);
    });
});
