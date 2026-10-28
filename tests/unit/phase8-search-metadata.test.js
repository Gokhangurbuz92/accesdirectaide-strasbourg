import { describe, it, expect } from 'vitest';
import { buildSearchMetadata, filterByTerritory, freshnessRankAdjustment } from '../../api/lib/services/search-metadata.js';

describe('Phase 8 Search Metadata', () => {
  describe('buildSearchMetadata', () => {
    it('produces complete object', () => {
      const meta = buildSearchMetadata({
        sourceId: 'src1',
        documentId: 'doc1',
        section: 'sec',
        territory: 'FR',
        authority: 'CAF',
        capabilities: ['cap1'],
        effectiveDate: '2023-01-01',
        sourceUpdatedAt: '2023-02-01',
        retrievedAt: '2023-03-01',
        freshnessState: 'FRESH',
        contentHash: 'hash',
        version: 'v1',
        url: 'http://example.com'
      });

      expect(meta.sourceId).toBe('src1');
      expect(meta.documentId).toBe('doc1');
      expect(meta.section).toBe('sec');
      expect(meta.territory).toBe('FR');
      expect(meta.authority).toBe('CAF');
      expect(meta.capabilities).toEqual(['cap1']);
      expect(meta.effectiveDate).toBe('2023-01-01');
      expect(meta.sourceUpdatedAt).toBe('2023-02-01');
      expect(meta.retrievedAt).toBe('2023-03-01');
      expect(meta.freshnessState).toBe('FRESH');
      expect(meta.contentHash).toBe('hash');
      expect(meta.version).toBe('v1');
      expect(meta.url).toBe('http://example.com');
      expect(meta.language).toBe('fr');
    });

    it('applies defaults', () => {
      const meta = buildSearchMetadata({ sourceId: 'src', documentId: 'doc' });
      expect(meta.language).toBe('fr');
      expect(meta.freshnessState).toBe('UNKNOWN');
      expect(meta.retrievedAt).toBeDefined();
    });
  });

  describe('filterByTerritory', () => {
    it('passes national results always', () => {
      const results = [{ id: 1, territory: null }, { id: 2 }];
      const filtered = filterByTerritory(results, 'FR-67');
      expect(filtered.length).toBe(2);
    });

    it('passes matching territory', () => {
      const results = [{ id: 1, territory: 'FR-67' }, { id: 2, territory: 'FR-75' }];
      const filtered = filterByTerritory(results, 'FR-67');
      expect(filtered).toEqual([{ id: 1, territory: 'FR-67' }]);
    });

    it('filters out non-matching territory', () => {
      const results = [{ id: 1, territory: 'FR-67' }];
      const filtered = filterByTerritory(results, 'FR-75');
      expect(filtered).toEqual([]);
    });

    it('passes parent territory', () => {
      const results = [{ id: 1, territory: 'FR' }];
      const filtered = filterByTerritory(results, 'FR-67');
      expect(filtered).toEqual([{ id: 1, territory: 'FR' }]);
    });
    
    it('returns all results if queryTerritory is missing', () => {
        const results = [{ id: 1, territory: 'FR-67' }];
        const filtered = filterByTerritory(results);
        expect(filtered).toEqual(results);
    });
  });

  describe('freshnessRankAdjustment', () => {
    it('is 0 for FRESH', () => {
      expect(freshnessRankAdjustment('FRESH')).toBe(0);
    });

    it('is negative for STALE/EXPIRED', () => {
      expect(freshnessRankAdjustment('STALE')).toBeLessThan(0);
      expect(freshnessRankAdjustment('EXPIRED')).toBeLessThan(0);
      expect(freshnessRankAdjustment('BROKEN')).toBeLessThan(0);
    });
  });
});
