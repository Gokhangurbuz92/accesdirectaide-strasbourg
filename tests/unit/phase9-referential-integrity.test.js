import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateTerritoryLabelHistory,
  validateTerritoryRelation,
  validateApplicability,
  validateStructureServiceArea
} from '../../api/lib/geography/validation.js';
import { db } from '../../src/db/index.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            return Promise.resolve([]); // Always resolve empty array (not found) for tests
          })
        }))
      }))
    }))
  }
}));

describe('Referential Integrity Validation (Application-managed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dangling applicability rejected', async () => {
    await expect(validateApplicability({ entityId: 'e1', territoryId: 't1' }))
      .rejects.toThrow('Referential integrity violation: territory t1 does not exist');
  });

  it('dangling relation source rejected', async () => {
    await expect(validateTerritoryRelation({ sourceId: 's1', targetId: 't1' }))
      .rejects.toThrow('Referential integrity violation: territory s1 does not exist');
  });

  it('dangling relation target rejected', async () => {
    db.select.mockImplementationOnce(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 's1' }]) }) })
    }));
    // Second call for targetId fails
    await expect(validateTerritoryRelation({ sourceId: 's1', targetId: 't1' }))
      .rejects.toThrow('Referential integrity violation: territory t1 does not exist');
  });

  it('dangling structure service area rejected', async () => {
    await expect(validateStructureServiceArea({ structureId: 's1', serviceType: 'DEPARTMENTAL', territoryId: 't1' }))
      .rejects.toThrow('Referential integrity violation: territory t1 does not exist');
  });

  it('valid references accepted', async () => {
    // Mock found for all
    db.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'valid_id' }]) }) })
    }));
    await expect(validateTerritoryLabelHistory({ territoryId: 't1' })).resolves.toBe(true);
    await expect(validateTerritoryRelation({ sourceId: 's1', targetId: 't1' })).resolves.toBe(true);
    await expect(validateApplicability({ territoryId: 't1' })).resolves.toBe(true);
    await expect(validateStructureServiceArea({ serviceType: 'NATIONAL' })).resolves.toBe(true);
  });
  
  it('dangling label history rejected', async () => {
    // Return to default not-found mock for this test
    db.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) })
    }));
    await expect(validateTerritoryLabelHistory({ territoryId: 't1' }))
      .rejects.toThrow('Referential integrity violation: territory t1 does not exist');
  });
});
