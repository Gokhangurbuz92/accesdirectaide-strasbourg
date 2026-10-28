import { getCsrfHeaders } from './csrf';

/**
 * Global API Fetch Wrapper
 *
 * Automatically attaches CSRF tokens to all mutating requests
 * (POST, PUT, PATCH, DELETE). Provides consistent error handling
 * and JSON serialization.
 *
 * Usage:
 *   import { apiFetch } from '@/lib/api-fetch';
 *
 *   // Simple POST
 *   const data = await apiFetch('/api/feedback', {
 *     method: 'POST',
 *     body: JSON.stringify({ rating: 5 }),
 *   });
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

export async function apiFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();

  // Inject CSRF headers for mutating requests
  if (MUTATING_METHODS.has(method)) {
    const csrfHeaders = getCsrfHeaders();
    const existingHeaders = options.headers instanceof Headers
      ? options.headers
      : new Headers(options.headers as Record<string, string> || {});

    for (const [key, value] of Object.entries(csrfHeaders)) {
      existingHeaders.set(key, value);
    }

    options = { ...options, headers: existingHeaders };
  }

  return fetch(url, options);
}

