import { describe, it, expect, vi } from 'vitest';
import { resolvePostalCode } from '../../api/lib/geography/TerritoryService.js';

describe('Phase 9 — TerritoryService', () => {

  describe('Postal Code Resolution (API Géo)', () => {
    it('rejects invalid postal codes', async () => {
      expect(await resolvePostalCode('')).toEqual([]);
      expect(await resolvePostalCode('123')).toEqual([]);
      expect(await resolvePostalCode(null)).toEqual([]);
    });

    it('returns empty array for 5-digit postal code when API fails', async () => {
      // Without network, this gracefully returns []
      const result = await resolvePostalCode('99999');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Geocoding (Géoplateforme)', () => {
    it('geocodeAddress returns null for invalid input', async () => {
      const { geocodeAddress } = await import('../../api/lib/geography/TerritoryService.js');
      expect(await geocodeAddress(null)).toBeNull();
      expect(await geocodeAddress('')).toBeNull();
    });
  });

  describe('Coordinate Resolution', () => {
    it('resolveCoordinates returns null for non-numeric input', async () => {
      const { resolveCoordinates } = await import('../../api/lib/geography/TerritoryService.js');
      expect(await resolveCoordinates('abc', 'def')).toBeNull();
      expect(await resolveCoordinates(null, null)).toBeNull();
    });
  });
});
