import { describe, it, expect } from 'vitest';
import {
  searchAidesSchema,
  searchDemarchesSchema,
  searchStructuresSchema,
} from '../../api/_utils/validators.js';

/**
 * Pagination contract tests — validates schema enforcement and
 * response shape expectations for deterministic pagination.
 */

// Helper: parse and return the validated result or the ZodError
function safeParse(schema, data) {
  return schema.safeParse(data);
}

describe('Pagination contract – Validator schemas', () => {
  describe.each([
    ['searchAidesSchema', searchAidesSchema],
    ['searchDemarchesSchema', searchDemarchesSchema],
    ['searchStructuresSchema', searchStructuresSchema],
  ])('%s', (_name, schema) => {
    it('defaults page to 1 when omitted', () => {
      const result = safeParse(schema, {});
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(1);
    });

    it('defaults pageSize to 20 when omitted', () => {
      const result = safeParse(schema, {});
      expect(result.success).toBe(true);
      expect(result.data.pageSize).toBe(20);
    });

    it('clamps page 0 to validation error (min 1)', () => {
      const result = safeParse(schema, { page: 0 });
      expect(result.success).toBe(false);
      // Zod should reject page < 1
      const pageIssue = result.error.issues.find(
        (i) => i.path.includes('page')
      );
      expect(pageIssue).toBeDefined();
    });

    it('rejects negative page params (min 1)', () => {
      const result = safeParse(schema, { page: -5 });
      expect(result.success).toBe(false);
      const pageIssue = result.error.issues.find(
        (i) => i.path.includes('page')
      );
      expect(pageIssue).toBeDefined();
    });

    it('clamps limit > 50 to validation error (max 50)', () => {
      const result = safeParse(schema, { pageSize: 51 });
      expect(result.success).toBe(false);
      const pageSizeIssue = result.error.issues.find(
        (i) => i.path.includes('pageSize')
      );
      expect(pageSizeIssue).toBeDefined();
    });

    it('accepts pageSize = 50 (boundary)', () => {
      const result = safeParse(schema, { pageSize: 50 });
      expect(result.success).toBe(true);
      expect(result.data.pageSize).toBe(50);
    });

    it('accepts pageSize = 1 (lower boundary)', () => {
      const result = safeParse(schema, { pageSize: 1 });
      expect(result.success).toBe(true);
      expect(result.data.pageSize).toBe(1);
    });

    it('rejects pageSize = 0', () => {
      const result = safeParse(schema, { pageSize: 0 });
      expect(result.success).toBe(false);
    });

    it('accepts valid page and pageSize together', () => {
      const result = safeParse(schema, { page: 3, pageSize: 25 });
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(25);
    });

    it('coerces string page and pageSize to numbers', () => {
      const result = safeParse(schema, { page: '2', pageSize: '10' });
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(10);
    });

    it('limit alias: rejects limit > 50', () => {
      const result = safeParse(schema, { limit: 100 });
      expect(result.success).toBe(false);
    });

    it('limit alias: accepts limit = 50', () => {
      const result = safeParse(schema, { limit: 50 });
      expect(result.success).toBe(true);
      expect(result.data.limit).toBe(50);
    });

    it('limit alias: empty string is treated as undefined (compat)', () => {
      const result = safeParse(schema, { limit: '' });
      expect(result.success).toBe(true);
      expect(result.data.limit).toBeUndefined();
    });
  });
});

describe('Pagination response shape contract', () => {
  // This validates the expected response shape produced by handlers.
  // The schemas above validate inputs; here we define and validate the output contract.

  const paginationShape = {
    total: expect.any(Number),
    page: expect.any(Number),
    limit: expect.any(Number),
    totalPages: expect.any(Number),
    hasNext: expect.any(Boolean),
  };

  function buildPagination({ total, page, limit }) {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(50, Math.max(1, limit || 20));
    const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;
    return {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasNext: safePage * safeLimit < total,
    };
  }

  it('has the required pagination shape keys', () => {
    const pagination = buildPagination({ total: 100, page: 1, limit: 20 });
    expect(pagination).toEqual(paginationShape);
    expect(pagination).toHaveProperty('total');
    expect(pagination).toHaveProperty('page');
    expect(pagination).toHaveProperty('limit');
    expect(pagination).toHaveProperty('totalPages');
    expect(pagination).toHaveProperty('hasNext');
  });

  it('empty result returns correct pagination', () => {
    const pagination = buildPagination({ total: 0, page: 1, limit: 20 });
    expect(pagination).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
    });
  });

  it('page 0 is clamped to 1', () => {
    const pagination = buildPagination({ total: 50, page: 0, limit: 20 });
    expect(pagination.page).toBe(1);
  });

  it('negative page is clamped to 1', () => {
    const pagination = buildPagination({ total: 50, page: -3, limit: 20 });
    expect(pagination.page).toBe(1);
  });

  it('limit > 50 is clamped to 50', () => {
    const pagination = buildPagination({ total: 100, page: 1, limit: 200 });
    expect(pagination.limit).toBe(50);
  });

  it('page beyond total returns hasNext = false', () => {
    const pagination = buildPagination({ total: 10, page: 5, limit: 20 });
    expect(pagination.hasNext).toBe(false);
    expect(pagination.totalPages).toBe(1);
  });

  it('hasNext is true when more pages exist', () => {
    const pagination = buildPagination({ total: 100, page: 1, limit: 20 });
    expect(pagination.hasNext).toBe(true);
    expect(pagination.totalPages).toBe(5);
  });

  it('hasNext is false on last page', () => {
    const pagination = buildPagination({ total: 100, page: 5, limit: 20 });
    expect(pagination.hasNext).toBe(false);
  });

  it('totalPages computes correctly for exact divisions', () => {
    const pagination = buildPagination({ total: 60, page: 1, limit: 20 });
    expect(pagination.totalPages).toBe(3);
  });

  it('totalPages rounds up for non-exact divisions', () => {
    const pagination = buildPagination({ total: 61, page: 1, limit: 20 });
    expect(pagination.totalPages).toBe(4);
  });
});
