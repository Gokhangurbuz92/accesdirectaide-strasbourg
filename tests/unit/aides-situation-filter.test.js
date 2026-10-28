// @vitest-environment jsdom
import { vi } from 'vitest';
vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { listAides, invalidateListAidesCache } from '../../src/lib/api/endpoints.ts';
import { useAidesListing } from '../../src/lib/hooks/useAidesListing.ts';

const EMPTY = { items: [], pagination: { page: 1, limit: 20, pageSize: 20, total: 0, totalPages: 0, hasNext: false }, facets: null };

function stubFetch() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    calls.push(String(typeof input === 'string' ? input : input.url));
    return new Response(JSON.stringify(EMPTY), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

describe('life-situation filter reaches GET /api/aides (backend: api/lib/search-query.js)', () => {
  beforeEach(() => { invalidateListAidesCache(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('listAides forwards `situation` as a query parameter', async () => {
    const calls = stubFetch();
    await listAides({ situation: 'logement-urgence', page: 1, pageSize: 20 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0], 'http://localhost').searchParams.get('situation')).toBe('logement-urgence');
  });

  it('listAides omits `situation` when it is not set', async () => {
    const calls = stubFetch();
    await listAides({ page: 1, pageSize: 20 });
    expect(new URL(calls[0], 'http://localhost').searchParams.has('situation')).toBe(false);
  });

  it('useAidesListing sends situation (and not territoire) when only a situation is selected', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useAidesListing({
      q: '', theme: '', urgent: undefined, sort: 'quality', page: 1, pageSize: 20, situation: 'perte-emploi', territoire: undefined,
    }));
    await waitFor(() => expect(result.current.status).toBe('success'));
    const u = new URL(calls[0], 'http://localhost');
    expect(u.searchParams.get('situation')).toBe('perte-emploi');
    expect(u.searchParams.has('territoire')).toBe(false);
  });

  it('useAidesListing keeps territoire independent of situation', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useAidesListing({
      q: '', theme: '', urgent: undefined, sort: 'quality', page: 1, pageSize: 20, situation: 'perte-emploi', territoire: 'strasbourg',
    }));
    await waitFor(() => expect(result.current.status).toBe('success'));
    const u = new URL(calls[0], 'http://localhost');
    expect(u.searchParams.get('situation')).toBe('perte-emploi');
    expect(u.searchParams.get('territoire')).toBe('strasbourg');
  });
});
