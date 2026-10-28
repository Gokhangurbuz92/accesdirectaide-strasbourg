// @ts-nocheck
/**
 * Phase 9 — Cursor Pagination Utility
 * Bounded cursor-based pagination with backward compatibility.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Parse pagination params from request query.
 * Supports cursor-based (preferred) and offset (backward compatible).
 * @param {object} query - req.query
 * @returns {{ limit: number, cursor: string|null, offset: number|null, mode: 'cursor'|'offset' }}
 */
export function parsePaginationParams(query = {}) {
  const rawLimit = parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (query.cursor) {
    return { limit, cursor: query.cursor, offset: null, mode: 'cursor' };
  }

  if (query.offset !== undefined) {
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    return { limit, cursor: null, offset, mode: 'offset' };
  }

  return { limit, cursor: null, offset: null, mode: 'cursor' };
}

/**
 * Encode a cursor from a sort key (e.g., id + createdAt).
 * @param {object} item - The last item in the current page
 * @param {string} sortKey - The field to use as cursor key (default: 'id')
 * @returns {string}
 */
export function encodeCursor(item, sortKey = 'id') {
  if (!item || !item[sortKey]) return null;
  // @ts-ignore
  return Buffer.from(JSON.stringify({ k: sortKey, v: item[sortKey] })).toString('base64url');
}

/**
 * Decode a cursor string.
 * @param {string} cursor
 * @returns {{ key: string, value: string } | null}
 */
export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { key: decoded.k, value: decoded.v };
  } catch {
    return null;
  }
}

/**
 * Build a paginated response envelope.
 * @param {Array} items - The items to return
 * @param {number} limit - The page size
 * @param {string} sortKey - The sort key used for cursor encoding
 * @returns {{ data: Array, pagination: { limit: number, nextCursor: string|null, hasMore: boolean }}}
 */
export function buildPaginatedResponse(items, limit, sortKey = 'id') {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? encodeCursor(pageItems[pageItems.length - 1], sortKey) : null;

  return {
    data: pageItems,
    pagination: {
      limit,
      nextCursor,
      hasMore
    }
  };
}

export default { parsePaginationParams, encodeCursor, decodeCursor, buildPaginatedResponse, MAX_LIMIT, DEFAULT_LIMIT };
