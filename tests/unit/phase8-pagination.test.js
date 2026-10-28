import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parsePaginationParams } from '../../api/lib/geography/CursorPagination.js';

describe('US_10H: Cursor-Based Pagination Backward Compatibility', () => {
  it('encodes and decodes cursors compatibly', () => {
    const raw = { id: 'uuid-1234', timestamp: '2025-01-01T00:00:00Z' };
    const cursor = encodeCursor(raw, 'id');
    const decoded = decodeCursor(cursor);
    expect(decoded.key).toBe('id');
    expect(decoded.value).toBe('uuid-1234');
  });

  it('handles invalid cursors gracefully', () => {
    const decoded = decodeCursor('invalid-base64-string');
    expect(decoded).toBeNull();
  });

  it('parses pagination parameters with valid defaults', () => {
    const { limit, cursor, mode } = parsePaginationParams({ limit: '100', cursor: encodeCursor({ id: 1 }) });
    expect(limit).toBe(100);
    expect(cursor).toEqual(encodeCursor({ id: 1 }));
    expect(mode).toBe('cursor');
  });

  it('caps max limit to 100 for API stability', () => {
    const { limit } = parsePaginationParams({ limit: '500' });
    expect(limit).toBe(100);
  });
});
