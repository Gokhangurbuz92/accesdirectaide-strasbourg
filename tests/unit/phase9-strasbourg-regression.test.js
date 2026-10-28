import { describe, it, expect } from 'vitest';
import { evaluateApplicability } from '../../api/lib/geography/ApplicabilityEngine.js';
import { resolveQPVFromFixtures } from '../../api/lib/geography/QPVAdapter.js';
import pagination from '../../api/lib/geography/CursorPagination.js';
import { filterByApplicability, buildTerritoryContextEnvelope } from '../../api/lib/geography/TerritorySearchFilter.js';

const { parsePaginationParams, encodeCursor, decodeCursor, buildPaginatedResponse, MAX_LIMIT } = pagination;

/**
 * Phase 9 — Strasbourg Pilot Regression (T025/SC-011)
 * Validates that existing Strasbourg-centric functionality remains intact
 * after the national geography architecture is applied.
 */
describe('Phase 9 — Strasbourg Pilot Regression (T025/SC-011)', () => {
  const FRANCE = 'fr-country';
  const GRAND_EST = 'grand-est-44';
  const BAS_RHIN = 'bas-rhin-67';
  const STRASBOURG = 'strasbourg-67482';

  const typeMap = new Map([
    [FRANCE, 'COUNTRY'],
    [GRAND_EST, 'REGION'],
    [BAS_RHIN, 'DEPARTEMENT'],
    [STRASBOURG, 'COMMUNE']
  ]);

  const strasbourgHierarchy = [STRASBOURG, BAS_RHIN, GRAND_EST, FRANCE];

  it('Strasbourg user sees national benefits', () => {
    const rules = [{ territoryId: FRANCE, isExclusion: false }];
    expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
  });

  it('Strasbourg user sees Grand Est benefits', () => {
    const rules = [{ territoryId: GRAND_EST, isExclusion: false }];
    expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
  });

  it('Strasbourg user sees Bas-Rhin benefits', () => {
    const rules = [{ territoryId: BAS_RHIN, isExclusion: false }];
    expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
  });

  it('Strasbourg user sees Strasbourg-local benefits', () => {
    const rules = [{ territoryId: STRASBOURG, isExclusion: false }];
    expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
  });

  it('QPV fixtures for Strasbourg (Hautepierre/Neuhof) resolve correctly', () => {
    const hautepierre = resolveQPVFromFixtures('QP067001');
    expect(hautepierre).not.toBeNull();
    expect(hautepierre.commune).toBe('67482');

    const neuhof = resolveQPVFromFixtures('QP067002');
    expect(neuhof).not.toBeNull();
    expect(neuhof.commune).toBe('67482');
  });

  it('search filter excludes non-Strasbourg local benefit for Strasbourg user', () => {
    const candidates = [
      {
        id: 'national-1',
        applicabilityRules: [{ territoryId: FRANCE, isExclusion: false }]
      },
      {
        id: 'bordeaux-local',
        applicabilityRules: [{ territoryId: 'bordeaux-33063', isExclusion: false }]
      }
    ];

    const result = filterByApplicability(candidates, strasbourgHierarchy, typeMap);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].id).toBe('national-1');
    expect(result.excluded).toBe(1);
  });

  it('territory context envelope builds correctly for Strasbourg', () => {
    const envelope = buildTerritoryContextEnvelope(
      { commune: '67482', departement: '67', region: 'Grand Est' },
      'APPLICABLE'
    );
    expect(envelope).toContain('67482');
    expect(envelope).toContain('Grand Est');
    expect(envelope).toContain('APPLICABLE');
  });

  it('pagination utility handles bounded limits', () => {
    const params = parsePaginationParams({ limit: '500' });
    expect(params.limit).toBe(MAX_LIMIT); // Capped at 100
  });

  it('cursor encoding/decoding round-trips', () => {
    const cursor = encodeCursor({ id: 'test-123' });
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded.value).toBe('test-123');
  });

  it('paginated response correctly signals hasMore', () => {
    const items = Array.from({ length: 26 }, (_, i) => ({ id: `item-${i}` }));
    const result = buildPaginatedResponse(items, 25);
    expect(result.data).toHaveLength(25);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).not.toBeNull();
  });
});
