// R39 (C) — ingest-structures: a page fetch is bounded (timeout) and tried once more on a temporary error; a person's own e-mail address is never stored
// for the public listing (the veille's rule); a record without its town or address is refused instead of becoming « Strasbourg » / « Inconnue ».
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { fetchPage, publicContactEmail, FETCH_TIMEOUT_MS, RUN_BUDGET_MS } = await import('../../api/_handlers/cron/ingest-structures.js');
const { StructureIngestSchema } = await import('../../api/lib/ingestion/validators.js');

const ok = { ok: true, status: 200, headers: { get: () => null } };
describe('fetchPage', () => {
  it('passes a timeout signal and returns the first good answer', async () => {
    const f = vi.fn(async () => ok);
    expect(await fetchPage('https://x.test/a', { fetchImpl: f })).toBe(ok);
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('tries once more after a 5xx, a 429 or a network error — never more', async () => {
    for (const first of [{ ok: false, status: 503, headers: { get: () => null } }, { ok: false, status: 429, headers: { get: () => '0' } }]) {
      const f = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(ok);
      expect(await fetchPage('https://x.test/a', { fetchImpl: f, retryDelayMs: 1 })).toBe(ok); expect(f).toHaveBeenCalledTimes(2);
    }
    const down = vi.fn(async () => { throw new TypeError('network'); });
    await expect(fetchPage('https://x.test/a', { fetchImpl: down, retryDelayMs: 1 })).rejects.toThrow('network'); expect(down).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null } }));
    expect((await fetchPage('https://x.test/a', { fetchImpl: bad, retryDelayMs: 1 })).status).toBe(503); expect(bad).toHaveBeenCalledTimes(2);
  });
  it('a 4xx (other than 429) is not retried', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
    expect((await fetchPage('https://x.test/a', { fetchImpl: f, retryDelayMs: 1 })).status).toBe(404); expect(f).toHaveBeenCalledTimes(1);
  });
  it('the budget leaves room inside the 300 s function limit', () => { expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(15000); expect(RUN_BUDGET_MS).toBeLessThan(300000); });
});

describe('public contact and invented facts', () => {
  it('a service mailbox is kept; a person’s own address is withheld', () => {
    expect(publicContactEmail('contact@centre-social.example')).toBe('contact@centre-social.example');
    expect(publicContactEmail('accueil67@caf.example')).toBe('accueil67@caf.example');
    expect(publicContactEmail('marie.dupont@asso.example')).toBeNull();
    expect(publicContactEmail(null)).toBeNull();
  });
  it('a record with no town or no address fails validation (no « Strasbourg » / « Inconnue » default)', () => {
    const base = { nom: 'Espace numérique', adresse: '1 rue de la Paix', ville: 'Strasbourg', code_postal: '67000', source_id: 'x', source_url: 'https://opendata.strasbourg.eu/x' };
    expect(StructureIngestSchema.safeParse(base).success).toBe(true);
    expect(StructureIngestSchema.safeParse({ ...base, ville: '' }).success).toBe(false);
    expect(StructureIngestSchema.safeParse({ ...base, adresse: '' }).success).toBe(false);
  });
});
