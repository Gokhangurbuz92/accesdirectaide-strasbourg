import { describe, it, expect } from 'vitest';
import { SCOPE, resolveScope, getDisplayTerritory, normalizeTerritoryInput } from '../../api/lib/territory-helpers.js';

describe('territory-helpers', () => {
  describe('SCOPE', () => {
    it('exposes all four territory scopes', () => {
      expect(SCOPE.NATIONAL).toBe('NATIONAL');
      expect(SCOPE.REGIONAL).toBe('REGIONAL');
      expect(SCOPE.DEPARTMENTAL).toBe('DEPARTMENTAL');
      expect(SCOPE.COMMUNAL).toBe('COMMUNAL');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(SCOPE)).toBe(true);
    });
  });

  describe('resolveScope', () => {
    it('returns explicit territory_scope when valid', () => {
      expect(resolveScope({ territory_scope: 'REGIONAL' })).toBe('REGIONAL');
      expect(resolveScope({ territory_scope: 'COMMUNAL' })).toBe('COMMUNAL');
    });

    it('ignores invalid territory_scope and falls back', () => {
      expect(resolveScope({ territory_scope: 'INVALID', department_codes: ['67'] })).toBe('DEPARTMENTAL');
    });

    it('falls back to COMMUNAL from insee_codes', () => {
      expect(resolveScope({ insee_codes: ['67482'] })).toBe('COMMUNAL');
    });

    it('falls back to DEPARTMENTAL from department_codes', () => {
      expect(resolveScope({ department_codes: ['67', '68'] })).toBe('DEPARTMENTAL');
    });

    it('falls back to DEPARTMENTAL from legacy departements', () => {
      expect(resolveScope({ departements: ['75'] })).toBe('DEPARTMENTAL');
    });

    it('falls back to REGIONAL from region_codes', () => {
      expect(resolveScope({ region_codes: ['grand-est'] })).toBe('REGIONAL');
    });

    it('falls back to NATIONAL from legacy territoires with national', () => {
      expect(resolveScope({ territoires: ['National'] })).toBe('NATIONAL');
    });

    it('falls back to NATIONAL from empty legacy territoires', () => {
      expect(resolveScope({ territoires: [] })).toBe('NATIONAL');
    });

    it('falls back to DEPARTMENTAL from non-empty legacy territoires', () => {
      expect(resolveScope({ territoires: ['Alsace'] })).toBe('DEPARTMENTAL');
    });

    it('defaults to NATIONAL when no fields present', () => {
      expect(resolveScope({})).toBe('NATIONAL');
    });
  });

  describe('getDisplayTerritory', () => {
    it('returns "France entière" for NATIONAL scope', () => {
      expect(getDisplayTerritory({ territory_scope: 'NATIONAL' })).toBe('France entière');
    });

    it('returns region codes for REGIONAL scope', () => {
      expect(getDisplayTerritory({ territory_scope: 'REGIONAL', region_codes: ['grand-est', 'bretagne'] })).toBe('grand-est, bretagne');
    });

    it('returns "Régional" when REGIONAL but no codes', () => {
      expect(getDisplayTerritory({ territory_scope: 'REGIONAL', region_codes: [] })).toBe('Régional');
    });

    it('returns department codes for DEPARTMENTAL scope', () => {
      expect(getDisplayTerritory({ territory_scope: 'DEPARTMENTAL', department_codes: ['67'] })).toBe('Département 67');
    });

    it('pluralizes "Départements" when multiple codes', () => {
      expect(getDisplayTerritory({ territory_scope: 'DEPARTMENTAL', department_codes: ['67', '68'] })).toBe('Départements 67, 68');
    });

    it('returns INSEE codes for COMMUNAL scope', () => {
      expect(getDisplayTerritory({ territory_scope: 'COMMUNAL', insee_codes: ['67482'] })).toBe('67482');
    });

    it('returns "Communal" when COMMUNAL but no codes', () => {
      expect(getDisplayTerritory({ territory_scope: 'COMMUNAL', insee_codes: [] })).toBe('Communal');
    });

    it('falls back to "France entière" for empty item', () => {
      expect(getDisplayTerritory({})).toBe('France entière');
    });
  });

  describe('normalizeTerritoryInput', () => {
    it('returns NATIONAL for null/undefined/empty', () => {
      expect(normalizeTerritoryInput(null)).toEqual({ scope: 'NATIONAL', codes: [] });
      expect(normalizeTerritoryInput(undefined)).toEqual({ scope: 'NATIONAL', codes: [] });
      expect(normalizeTerritoryInput('')).toEqual({ scope: 'NATIONAL', codes: [] });
    });

    it('returns NATIONAL for "national" (case-insensitive)', () => {
      expect(normalizeTerritoryInput('national')).toEqual({ scope: 'NATIONAL', codes: [] });
      expect(normalizeTerritoryInput('National')).toEqual({ scope: 'NATIONAL', codes: [] });
    });

    it('returns NATIONAL for "france" (case-insensitive)', () => {
      expect(normalizeTerritoryInput('france')).toEqual({ scope: 'NATIONAL', codes: [] });
      expect(normalizeTerritoryInput('France')).toEqual({ scope: 'NATIONAL', codes: [] });
    });

    it('returns DEPARTMENTAL for 2-digit dept code', () => {
      expect(normalizeTerritoryInput('67')).toEqual({ scope: 'DEPARTMENTAL', codes: ['67'] });
      expect(normalizeTerritoryInput('75')).toEqual({ scope: 'DEPARTMENTAL', codes: ['75'] });
    });

    it('returns DEPARTMENTAL for 3-digit dept code (overseas)', () => {
      expect(normalizeTerritoryInput('971')).toEqual({ scope: 'DEPARTMENTAL', codes: ['971'] });
    });

    it('returns COMMUNAL for 5-digit INSEE code', () => {
      expect(normalizeTerritoryInput('67482')).toEqual({ scope: 'COMMUNAL', codes: ['67482'] });
      expect(normalizeTerritoryInput('75056')).toEqual({ scope: 'COMMUNAL', codes: ['75056'] });
    });

    it('returns DEPARTMENTAL with raw value for city name', () => {
      expect(normalizeTerritoryInput('Strasbourg')).toEqual({ scope: 'DEPARTMENTAL', codes: ['Strasbourg'] });
    });

    it('trims whitespace', () => {
      expect(normalizeTerritoryInput('  67  ')).toEqual({ scope: 'DEPARTMENTAL', codes: ['67'] });
    });
  });
});
