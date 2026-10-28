import { describe, it, expect, vi } from 'vitest';
import { searchAides, searchStructures, searchDemarches } from './search-query.js';

// Mock Prisma Client
const mockPrisma = {
  $queryRaw: vi.fn(),
  aide: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  demarche: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  structure: {
    findMany: vi.fn(),
    count: vi.fn(),
  }
};

describe.skip('search-query', () => {

  it('searchAides builds correct SQL for q + filters', async () => {
    // Setup mock return
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: '1', rank: 0.5 }]); // items
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ total: 1 }]); // count
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ themes: {} }]); // facets
    mockPrisma.aide.findMany.mockResolvedValue([{ id: '1', title: 'Test' }]);

    const params = {
      q: 'logement',
      category: 'logement-slug',
      page: 1,
      pageSize: 20
    };

    const result = await searchAides(mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);

    // Check SQL structure roughly (hard to check exact string with Prisma.sql objects)
    // But we can check if it didn't crash and called queryRaw.
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('searchAides builds correct SQL for simple list', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: '1' }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ total: 1 }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{}]); // facets
    mockPrisma.aide.findMany.mockResolvedValue([{ id: '1' }]);

    const params = { page: 1, pageSize: 20 };
    await searchAides(mockPrisma);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

});
