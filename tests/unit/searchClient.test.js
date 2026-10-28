import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetSearchClientForTests, searchAides } from '../../src/lib/searchClient.js';

describe('searchClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetSearchClientForTests();
  });

  afterEach(() => {
    __resetSearchClientForTests();
    vi.unstubAllGlobals();
  });

  it('calls /api/search and normalizes successful payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'aid-1',
              slug: 'apl-etudiant-strasbourg',
              title: 'APL étudiant à Strasbourg',
              description: 'Aide au logement.',
              category: 'logement',
              score: 0.42,
            },
          ],
          total: 1,
          message: null,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await searchAides({
      query: '  loyer étudiant Strasbourg  ',
      category: 'logement',
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      query: 'loyer étudiant Strasbourg',
      category: 'logement',
      limit: 5,
    });
    expect(response.meta.total).toBe(1);
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        id: 'aid-1',
        slug: 'apl-etudiant-strasbourg',
        title: 'APL étudiant à Strasbourg',
        category: 'logement',
      })
    );
  });

  it('includes optional situations and geoScope in payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          total: 0,
          message: 'not found',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    await searchAides({
      query: 'aide logement',
      situations: [' etudiant ', 'senior'],
      geoScope: '  NATIONAL  ',
      limit: 10,
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      query: 'aide logement',
      limit: 10,
      situations: ['etudiant', 'senior'],
      geoScope: 'NATIONAL',
    });
  });

  it('aborts the previous request when a new one starts', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [],
            total: 0,
            message: 'not found',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const firstRequest = searchAides({ query: 'premiere requete', limit: 5 });
    await Promise.resolve();
    const secondRequest = searchAides({ query: 'deuxieme requete', limit: 5 });

    await expect(firstRequest).rejects.toMatchObject({ name: 'AbortError' });
    await expect(secondRequest).resolves.toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({ total: 0 }),
      })
    );
  });

  it('throws a readable error when HTTP status is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Internal server error',
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(searchAides({ query: 'aide logement', limit: 10 })).rejects.toThrow('Internal server error');
  });
});
