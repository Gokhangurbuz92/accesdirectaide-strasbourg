import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import {
  parseQueryParams,
  getActiveFilters,
  hasActiveFilters,
  SCHEMAS
} from '../../src/lib/queryState.js';

describe('queryState utilities', () => {
  describe('parseQueryParams', () => {
    it('should parse string parameters', () => {
      const searchParams = new URLSearchParams('q=test&theme=logement');
      const schema = {
        q: { type: 'string', default: '' },
        theme: { type: 'string', default: '' },
      };
      
      const result = parseQueryParams(searchParams, schema);
      
      expect(result.q).toBe('test');
      expect(result.theme).toBe('logement');
    });

    it('should parse number parameters', () => {
      const searchParams = new URLSearchParams('page=3');
      const schema = {
        page: { type: 'number', default: 1 },
      };
      
      const result = parseQueryParams(searchParams, schema);
      
      expect(result.page).toBe(3);
      expect(typeof result.page).toBe('number');
    });

    it('should handle invalid numbers with default', () => {
      const searchParams = new URLSearchParams('page=invalid');
      const schema = {
        page: { type: 'number', default: 1 },
      };
      
      const result = parseQueryParams(searchParams, schema);
      
      expect(result.page).toBe(1);
    });

    it('should parse boolean parameters', () => {
      const searchParams = new URLSearchParams('urgent=true');
      const schema = {
        urgent: { type: 'boolean', default: false },
      };
      
      const result = parseQueryParams(searchParams, schema);
      
      expect(result.urgent).toBe(true);
    });

    it('should use defaults for missing parameters', () => {
      const searchParams = new URLSearchParams('');
      const schema = {
        q: { type: 'string', default: '' },
        page: { type: 'number', default: 1 },
      };
      
      const result = parseQueryParams(searchParams, schema);
      
      expect(result.q).toBe('');
      expect(result.page).toBe(1);
    });
  });

  describe('getActiveFilters', () => {
    it('should return only non-empty filters', () => {
      const params = {
        q: 'test',
        theme: '',
        page: 2,
        situation: 'famille',
      };
      
      const active = getActiveFilters(params, ['page']);
      
      expect(active).toEqual({
        q: 'test',
        situation: 'famille',
      });
    });

    it('should exclude specified keys', () => {
      const params = {
        q: 'test',
        page: 2,
        pageSize: 12,
      };
      
      const active = getActiveFilters(params, ['page', 'pageSize']);
      
      expect(active).toEqual({
        q: 'test',
      });
    });
  });

  describe('hasActiveFilters', () => {
    it('should return true when filters are active', () => {
      const params = {
        q: 'test',
        page: 1,
      };
      
      expect(hasActiveFilters(params, ['page'])).toBe(true);
    });

    it('should return false when no filters are active', () => {
      const params = {
        q: '',
        page: 1,
      };
      
      expect(hasActiveFilters(params, ['page'])).toBe(false);
    });
  });

  describe('SCHEMAS', () => {
    it('should have schema for aides', () => {
      expect(SCHEMAS.aides).toBeDefined();
      expect(SCHEMAS.aides.q).toEqual({ type: 'string', default: '' });
      expect(SCHEMAS.aides.page).toEqual({ type: 'number', default: 1 });
    });

    it('should have schema for demarches', () => {
      expect(SCHEMAS.demarches).toBeDefined();
      expect(SCHEMAS.demarches.category).toBeDefined();
    });

    it('should have schema for structures', () => {
      expect(SCHEMAS.structures).toBeDefined();
      expect(SCHEMAS.structures.type).toBeDefined();
    });

    it('should have schema for actualites', () => {
      expect(SCHEMAS.actualites).toBeDefined();
      expect(SCHEMAS.actualites.categorie).toBeDefined();
    });
  });
});
