// QA v81 DTA-B33 — without an HDS gateway the browser takes the legacy path without asking a ticket (no expected 503); unknown → ticket asked as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hdsTicket, hdsVaultMode, resetHdsMode } from '@/lib/hdsClient';
import { fetchServerFeatureState } from '@/lib/serverFeatures';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('hdsGateway status probe', () => {
  let calls;
  beforeEach(() => { resetHdsMode(); calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); resetHdsMode(); });
  const stub = (status) => vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return String(url).startsWith('/api/status') ? status : json(200, { ticket: 't', origin: 'https://h.example' }); }));

  it('features.hdsGateway === false → legacy, no ticket request', async () => {
    stub(json(200, { features: { hdsGateway: false } }));
    expect(await hdsTicket('messaging.attachments', { conversation: 'c1' })).toBeNull();
    expect(hdsVaultMode()).toBe('legacy');
    expect(calls.filter((u) => u.includes('hds-ticket'))).toEqual([]);
    expect(await hdsTicket('citizen.vault')).toBeNull();
    expect(calls.filter((u) => u.startsWith('/api/status'))).toHaveLength(1);
  });
  it('features.hdsGateway === true → ticket asked', async () => {
    stub(json(200, { features: { hdsGateway: true } }));
    expect(await hdsTicket('citizen.vault')).toEqual({ ticket: 't', origin: 'https://h.example' });
    expect(calls.some((u) => u.includes('/api/citizen/hds-ticket'))).toBe(true);
  });
  it('unknown (status error or field absent) → ticket asked (server stays the authority)', async () => {
    stub(json(500, {}));
    expect(await hdsTicket('citizen.vault')).not.toBeNull();
    resetHdsMode(); calls = [];
    stub(json(200, { features: {} }));
    expect(await hdsTicket('citizen.vault')).not.toBeNull();
  });
  it('fetchServerFeatureState is tri-state', async () => {
    expect(await fetchServerFeatureState('hdsGateway', async () => json(200, { features: { hdsGateway: false } }))).toBe(false);
    expect(await fetchServerFeatureState('hdsGateway', async () => json(200, { features: { hdsGateway: 'no' } }))).toBeNull();
    expect(await fetchServerFeatureState('hdsGateway', async () => { throw new Error('x'); })).toBeNull();
  });
});

