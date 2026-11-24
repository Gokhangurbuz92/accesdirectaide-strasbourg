import { lazy } from 'react';

/** the messages a browser gives when the code of a page could not be downloaded (Chrome, Firefox, Safari, Vite's CSS preload) */
export const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|Unable to preload CSS|error loading dynamically/i;

/**
 * R3 (QA v79, DTA-B69): React.lazy keeps the FIRST rejected import for good, so one lost download of a page's code (a network blip, a reset connection)
 * showed the application's error screen « Une erreur est survenue » until the person reloaded — reproduced by aborting the AdminLayout file once: the
 * screen appears and no API call is made. A failed download is tried again (the browser fetches the file anew) before React sees an error; any other
 * error (a module that throws while it is evaluated) is not retried.
 * @template {import('react').ComponentType<any>} T
 * @param {() => Promise<{ default: T }>} factory
 * @param {{ retries?: number, delayMs?: number, wait?: (ms: number) => Promise<void> }} [options]
 * @returns {() => Promise<{ default: T }>}
 */
export function importWithRetry(factory, { retries = 2, delayMs = 400, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        if (attempt >= retries || !CHUNK_LOAD_ERROR.test(String(/** @type {any} */ (error)?.message || ''))) throw error;
        await wait(delayMs * (attempt + 1));
      }
    }
  };
}

/**
 * React.lazy with {@link importWithRetry}.
 * @template {import('react').ComponentType<any>} T
 * @param {() => Promise<{ default: T }>} factory
 */
export default function lazyWithRetry(factory) {
  return lazy(importWithRetry(factory));
}
