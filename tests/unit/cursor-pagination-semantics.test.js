import { describe, it, expect } from 'vitest';
import { parsePaginationParams, encodeCursor, decodeCursor, buildPaginatedResponse } from '../../api/lib/geography/CursorPagination.js';

describe('CursorPagination Semantics', () => {
  it('A. limit > MAX_LIMIT is actually clamped', () => {
    const p = parsePaginationParams({ limit: '9999' });
    expect(p.limit).toBeLessThanOrEqual(100);
  });
  
  it('B. page 1 returning > limit produces a nextCursor', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const res = buildPaginatedResponse(items, 2, 'id');
    expect(res.pagination.nextCursor).toBeTruthy();
    expect(typeof res.pagination.nextCursor).toBe('string');
  });
  
  it('C. using nextCursor produces continuation rather than the same page', () => {
    // This is implicit in the handler, but we can verify encode/decode contract.
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const res = buildPaginatedResponse(items, 2, 'id');
    const decoded = decodeCursor(res.pagination.nextCursor);
    expect(decoded.value).toBe('2');
  });

  it('D. invalid cursor follows the documented contract', () => {
    const decoded = decodeCursor('invalid_cursor_string');
    expect(decoded).toBeNull();
  });
  
  it('E. legacy offset/page remains compatible where promised', () => {
    const p = parsePaginationParams({ offset: '10', limit: '10' });
    expect(p.mode).toBe('offset');
    expect(p.offset).toBe(10);
  });
});
