import { beforeEach, describe, expect, it } from 'vitest';
import { _resetGdelt, discoverCoverage, gdeltQuery, GDELT_ENDPOINT } from '../../api/_services/news/discovery-gdelt.js';
import { conceptPrompt, illustrationProvider } from '../../api/_services/news/illustration-provider.js';

const ON = { NEWS_DISCOVERY_GDELT: 'on' };
const reply = (articles) => async (url) => ({ ok: true, url, json: async () => ({ articles }) });

describe('GDELT discovery — links only, bounded, off by default', () => {
  beforeEach(() => _resetGdelt());
  it('off unless NEWS_DISCOVERY_GDELT=on (no request made)', async () => {
    let called = false;
    expect(await discoverCoverage('Revalorisation du RSA au premier avril', { env: {}, fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } })).toEqual([]);
    expect(called).toBe(false);
  });
  it('keeps https links, one per site, never titles or images; asks the official endpoint', async () => {
    let asked = '';
    const fetchImpl = async (u) => { asked = u; return reply([
      { url: 'https://www.lemonde.example/a', title: 'TITRE PROTÉGÉ', socialimage: 'https://img/x.jpg', seendate: '20261110T090000Z' },
      { url: 'https://www.lemonde.example/b', title: 't', seendate: '20261110T100000Z' },
      { url: 'http://insecure.example/c', title: 't' }, { url: 'javascript:alert(1)' }, { url: 'https://user:pw@evil.example/x' },
      { url: 'https://bbc.example/d', seendate: 'bad' },
    ])(u); };
    const links = await discoverCoverage('Revalorisation du RSA au premier avril', { env: ON, fetchImpl, now: 1e12 });
    expect(asked.startsWith(GDELT_ENDPOINT + '?')).toBe(true);
    expect(links.map((l) => l.publisher)).toEqual(['lemonde.example', 'bbc.example']);
    expect(JSON.stringify(links)).not.toMatch(/PROTÉGÉ|img\/x\.jpg|title|socialimage/);
    expect(links[0]).toMatchObject({ lane: 'B', via: 'gdelt', date: '2026-11-10T09:00:00Z' });
  });
  it('cache 6 h, at most one request every 5 s, failures give no link', async () => {
    let n = 0; const fetchImpl = async (u) => { n += 1; return reply([{ url: 'https://a.example/1' }])(u); };
    await discoverCoverage('Revalorisation du RSA au premier avril', { env: ON, fetchImpl, now: 1e12 });
    await discoverCoverage('Revalorisation du RSA au premier avril', { env: ON, fetchImpl, now: 1e12 + 1000 });
    expect(n).toBe(1);
    expect(await discoverCoverage('Chèque énergie envoi des chèques', { env: ON, fetchImpl, now: 1e12 + 2000 })).toEqual([]);   // rate limit
    expect(await discoverCoverage('Autre sujet complètement différent ici', { env: ON, fetchImpl: async () => { throw new Error('down'); }, now: 1e12 + 60000 })).toEqual([]);
  });
  it('a title too short to identify a story asks nothing', () => { expect(gdeltQuery('RSA')).toBeNull(); });
});

describe('AI illustrations — no provider approved, concept prompts only', () => {
  it('no provider is ever returned without an approved adapter', () => {
    expect(illustrationProvider({})).toBeNull();
    expect(illustrationProvider({ NEWS_AI_IMAGES_APPROVED: 'on', NEWS_AI_IMAGES_PROVIDER: 'anything' })).toBeNull();
  });
  it('the prompt is a theme, never an event, a person or a photo', () => {
    const p = conceptPrompt('logement');
    expect(p).toMatch(/Flat editorial illustration/); expect(p).toMatch(/no people faces/); expect(p).toMatch(/no real places or events/);
    expect(conceptPrompt('une')).toBeNull(); expect(conceptPrompt('attentat à Paris')).toBeNull();
  });
});
