// @vitest-environment jsdom
/**
 * A-13 — what the person reads when the citizen API refuses is in the INTERFACE language: built from the stable error code (then the HTTP status), never the
 * raw French server sentence outside French; on a French page the server's own sentence is kept. No window.alert left in the account code.
 */
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), CsrfBootstrapError: class CsrfBootstrapError extends Error {} }));
import { setLanguage } from '../../src/i18n/index.js';
import { citizenApi, CitizenApiError } from '../../src/lib/citizenApi.js';
import { citizenErrorText, knownCitizenErrorCodes } from '../../src/lib/citizenErrors.js';

const FRENCH = 'Fichier trop volumineux (3 Mo au plus).';
const answer = (status, body) => { globalThis.fetch = vi.fn(async () => ({ ok: false, status, json: async () => body })); };
const refusal = async (fn) => { try { await fn(); } catch (e) { return e; } throw new Error('expected a refusal'); };

beforeEach(async () => { await setLanguage('fr', { persist: false }); });
afterEach(() => { vi.restoreAllMocks(); });

describe('A-13 citizen API errors', () => {
  it('French page: the server sentence, exactly as before; code and status kept', async () => {
    answer(413, { error: 'FILE_TOO_LARGE', message: FRENCH });
    const e = await refusal(() => citizenApi.uploadCoffre({}));
    expect(e).toBeInstanceOf(CitizenApiError);
    expect(e).toMatchObject({ message: FRENCH, status: 413, code: 'FILE_TOO_LARGE', serverMessage: FRENCH });
  });

  it('Arabic page: the sentence of the code in Arabic, never the French server text', async () => {
    await setLanguage('ar', { persist: false });
    answer(413, { error: 'FILE_TOO_LARGE', message: FRENCH });
    const e = await refusal(() => citizenApi.uploadCoffre({}));
    expect(e.message).toBe('الملف كبير جدًا (3 ميغابايت على الأكثر).');
    expect(e.message).not.toContain('Fichier');
    expect(e.serverMessage).toBe(FRENCH);
  });

  it('an unknown code falls back to the sentence of the HTTP status in the interface language', async () => {
    await setLanguage('de', { persist: false });
    answer(409, { error: 'SOMETHING_NEW', message: 'Phrase française inconnue.' });
    expect((await refusal(() => citizenApi.listParcours())).message).toMatch(/^Diese Aktion ist im aktuellen Zustand nicht möglich/);
    answer(500, { error: 'internal_error' });
    expect((await refusal(() => citizenApi.listParcours())).message).toMatch(/Problem/);
    answer(401, { error: 'Unauthorized' });
    expect((await refusal(() => citizenApi.listParcours())).message).toBe('Melden Sie sich an, um auf Ihren Bereich zuzugreifen.');
  });

  it('network and CSRF failures are translated too', async () => {
    await setLanguage('tr', { persist: false });
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const e = await refusal(() => citizenApi.listParcours());
    expect(e).toMatchObject({ code: 'network', status: 0 });
    expect(e.message).toBe('Hizmete şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.');
  });

  it('every known code has a non-French sentence in each target language', async () => {
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      await setLanguage(lang, { persist: false });
      for (const code of knownCitizenErrorCodes()) {
        const fr = await (async () => { await setLanguage('fr', { persist: false }); const v = citizenErrorText({ code }); await setLanguage(lang, { persist: false }); return v; })();
        expect(citizenErrorText({ code }), `${lang} ${code}`).not.toBe(fr);
      }
    }
  });

  it('no window.alert in the account code; the journals translate the action code', () => {
    for (const f of ['src/lib/citizenSession.js', 'src/pages/CompteParametres.jsx']) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/(?<![\w.])(window\.)?alert\(/);
    expect(fs.readFileSync('src/components/sharing/DossierTransparency.jsx', 'utf8')).toMatch(/ACTION_LABELS\[e\.action\]/);
    expect(fs.readFileSync('src/pages/CompteDelegations.jsx', 'utf8')).toMatch(/ACTION_LABELS\[e\.action\]/);
  });
});
