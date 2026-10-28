import { z } from "zod";
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchDemarches, searchStructures } from '../../api/lib/search-query.js';
import { db } from '../../src/db/index.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ total: '0' }] }),
    query: {
      Demarche: { findMany: vi.fn().mockResolvedValue([]) },
      Structure: { findMany: vi.fn().mockResolvedValue([]) }
    }
  }
}));

describe('Search Applicability Pre-Filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searchDemarches applies territoryFilter via Applicability table (FR-014)', async () => {
    await searchDemarches({ territoryFilter: { userTerritoryIds: ['t1', 't2'] } });
    
    expect(db.execute).toHaveBeenCalled();
    const sqlArg = JSON.stringify(db.execute.mock.calls[0][0]);
    
    expect(sqlArg).toContain('PROCEDURE');
    expect(sqlArg).toContain('is_exclusion');
    expect(sqlArg).toContain('territory_id');
  });

  it('searchStructures applies territoryFilter via StructureServiceArea (FR-010)', async () => {
    await searchStructures({ territoryFilter: { userTerritoryIds: ['t3'] } });
    
    expect(db.execute).toHaveBeenCalled();
    const sqlArg = JSON.stringify(db.execute.mock.calls[0][0]);
    
    expect(sqlArg).toContain('StructureServiceArea');
    expect(sqlArg).toContain('NATIONAL');
    expect(sqlArg).toContain('territory_id');
  });
});

  it('searchDemarches with no territory hides local procedures (FR-014)', async () => {
    db.execute.mockClear();
    await searchDemarches({});
    
    expect(db.execute).toHaveBeenCalled();
    const sqlArg = JSON.stringify(db.execute.mock.calls[0][0]);
    
    // Should contain the NOT EXISTS exclusion for local procedures
    expect(sqlArg).toContain('PROCEDURE');
    expect(sqlArg).toContain('is_exclusion = false');
  });

  it('searchStructures with no territory hides local structures (FR-010)', async () => {
    db.execute.mockClear();
    await searchStructures({});
    
    expect(db.execute).toHaveBeenCalled();
    const sqlArg = JSON.stringify(db.execute.mock.calls[0][0]);
    
    // Should contain the restriction to NATIONAL
    expect(sqlArg).toContain('StructureServiceArea');
    expect(sqlArg).toContain('NATIONAL');
  });
