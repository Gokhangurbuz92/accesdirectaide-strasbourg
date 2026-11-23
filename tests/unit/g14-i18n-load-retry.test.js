/**
 * G14-R2 (QA v74) — a language file whose download fails once is fetched again before the visitor's language is given up (bootLanguage used to fall
 * back to French silently: <html lang="fr"> on /proposer-une-structure in the QA accessibility self-check, intermittently).
 */
import { describe, expect, it, vi } from 'vitest';
import { loadWithRetry } from '../../src/i18n/index.js';

describe('loadWithRetry', () => {
  it('returns the module after a transient failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue({ default: { a: 'b' } });
    await expect(loadWithRetry(load)).resolves.toEqual({ default: { a: 'b' } });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('gives up after three attempts and rethrows the error', async () => {
    const err = new TypeError('Failed to fetch dynamically imported module');
    const load = vi.fn().mockRejectedValue(err);
    await expect(loadWithRetry(load)).rejects.toBe(err);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('a first success is not repeated', async () => {
    const load = vi.fn().mockResolvedValue({ default: {} });
    await loadWithRetry(load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
