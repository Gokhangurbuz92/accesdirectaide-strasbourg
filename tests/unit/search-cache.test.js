import { describe, it, expect } from 'vitest';
import { hashParams, CACHE_TTL_SECONDS, CACHE_PREFIX } from '../../api/lib/search-cache.js';

describe('search-cache', () => {
    describe('hashParams', () => {
        it('produces consistent hashes for same params', () => {
            const params = { query: 'logement', category: 'LOGEMENT' };
            expect(hashParams(params)).toBe(hashParams(params));
        });

        it('produces same hash regardless of key order', () => {
            const a = { query: 'logement', category: 'LOGEMENT' };
            const b = { category: 'LOGEMENT', query: 'logement' };
            expect(hashParams(a)).toBe(hashParams(b));
        });

        it('produces different hashes for different params', () => {
            const a = { query: 'logement' };
            const b = { query: 'emploi' };
            expect(hashParams(a)).not.toBe(hashParams(b));
        });

        it('returns a 16-character hex string', () => {
            const hash = hashParams({ query: 'test' });
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('handles complex params with arrays and nulls', () => {
            const params = {
                query: 'aide logement',
                category: null,
                situations: ['etudiant', 'jeune'],
                geoScope: 'national',
                limit: 10,
            };
            const hash = hashParams(params);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
            expect(hashParams(params)).toBe(hash); // stable
        });
    });

    describe('constants', () => {
        it('has 5-minute TTL', () => {
            expect(CACHE_TTL_SECONDS).toBe(300);
        });

        it('has correct prefix', () => {
            expect(CACHE_PREFIX).toBe('search:');
        });
    });
});
