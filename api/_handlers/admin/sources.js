// @ts-nocheck
import { listSources } from '../../lib/ingestion/SourceRegistry.js';
import { parsePaginationParams, buildPaginatedResponse } from '../../lib/geography/CursorPagination.js';
import { requireAdminAuth } from '../../_utils/auth.js';

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sources = await listSources();
    
    // Phase 9: Cursor-based pagination with backward compatibility (FR-016)
    const pagination = parsePaginationParams(req.query);
    
    if (pagination.mode === 'cursor' && pagination.cursor === null && pagination.offset === null) {
      // No pagination requested — return all for backward compatibility
      return res.status(200).json({ sources, count: sources.length });
    }
    
    // Apply pagination
    let startIdx = 0;
    if (pagination.mode === 'offset' && pagination.offset !== null) {
      startIdx = pagination.offset;
    } else if (pagination.mode === 'cursor' && pagination.cursor) {
      const { decodeCursor } = await import('../../lib/geography/CursorPagination.js');
      const decoded = decodeCursor(pagination.cursor);
      if (decoded && decoded.key === 'id') {
        const foundIdx = sources.findIndex(s => s.id === decoded.value);
        if (foundIdx !== -1) {
          startIdx = foundIdx + 1;
        }
      }
    }
    
    const pageItems = sources.slice(startIdx, startIdx + pagination.limit + 1);
    const result = buildPaginatedResponse(pageItems, pagination.limit);
    
    return res.status(200).json({
      sources: result.data,
      count: sources.length,
      pagination: result.pagination
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export default requireAdminAuth(handler);
