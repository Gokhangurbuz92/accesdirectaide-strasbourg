import { describe, expect, it, vi } from 'vitest';

import {
  createWs8GuardedFetch,
  isWs8AllowedNetworkUrl,
} from '../helpers/ws8-strict-offline.js';

describe('WS8 strict-offline network boundary', () => {
  it.each([
    ['http://127.0.0.1:3000/api/health', true],
    ['http://localhost:4175/', true],
    ['http://[::1]:5432/', true],
    ['https://localhost:8443/', true],
    ['data:text/plain,ok', true],
    ['blob:http://127.0.0.1:3000/abc', true],
    ['file:///tmp/ws8-proof.json', true],
    ['/api/local-relative', true],
    ['https://example.com/', false],
    ['http://api.example.test/', false],
    ['ftp://127.0.0.1/file', false],
    ['not a url', false],
  ])('classifies %s as allowed=%s', (target, expected) => {
    expect(isWs8AllowedNetworkUrl(target)).toBe(expected);
  });

  it('fails closed before delegated fetch for a remote URL', async () => {
    const delegate = vi.fn(async () => ({ ok: true }));
    const guarded = createWs8GuardedFetch(delegate);

    await expect(guarded('https://example.com/private')).rejects.toMatchObject({
      code: 'WS8_REMOTE_NETWORK_BLOCKED',
    });
    expect(delegate).not.toHaveBeenCalled();
  });

  it('delegates loopback fetches unchanged', async () => {
    const response = { ok: true, status: 200 };
    const delegate = vi.fn(async () => response);
    const guarded = createWs8GuardedFetch(delegate);

    await expect(guarded('http://127.0.0.1:3000/api/local')).resolves.toBe(response);
    expect(delegate).toHaveBeenCalledTimes(1);
  });
});
