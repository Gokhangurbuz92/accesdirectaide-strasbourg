// R8 — « TypeError: Load failed » (Sentry ACCESDIRECTAIDE-WEB-2, 27/11/2026): the browser's own wording for a request that never reached the server is
// dropped before sending; any other error, and the same words inside a real error, are still sent (and scrubbed).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isBrowserNetworkNoise } from '../../src/observability/sentryScrub.js';

const ev = (type, value, extra = []) => ({ exception: { values: [{ type, value }, ...extra] } });

describe('R8 Sentry browser network noise', () => {
  it('drops the network wording of Safari, Chrome and Firefox', () => {
    for (const v of ['Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.', 'The network connection was lost.', ' Load failed ']) {
      expect(isBrowserNetworkNoise(ev('TypeError', v)), v).toBe(true);
    }
  });
  it('keeps every real error', () => {
    expect(isBrowserNetworkNoise(ev('TypeError', "Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isBrowserNetworkNoise(ev('Error', 'Load failed'))).toBe(false);
    expect(isBrowserNetworkNoise(ev('TypeError', 'Load failed for /api/aides'))).toBe(false);
    expect(isBrowserNetworkNoise(ev('TypeError', 'Load failed', [{ type: 'Error', value: 'x' }]))).toBe(false);
    expect(isBrowserNetworkNoise({ message: 'Load failed' })).toBe(false);
    expect(isBrowserNetworkNoise(null)).toBe(false);
  });
  it('is applied in the browser Sentry beforeSend, before the scrubber', () => {
    expect(readFileSync('src/observability/initSentry.js', 'utf8')).toContain('beforeSend: (event) => (isBrowserNetworkNoise(event) ? null : scrubEvent(event)),');
  });
});
