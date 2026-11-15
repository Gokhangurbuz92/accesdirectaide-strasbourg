// @vitest-environment jsdom
/**
 * A-3 (E05) — « Lieux dont la zone d'intervention, vérifiée par ADA, couvre … » was false: the `serves` filter matches "Structure".insee_codes, which the
 * automatic chain seeds with the commune where an imported place is LOCATED (api/_services/verification/chain.js); a declared area only comes from a reviewed
 * Espace Structure proposal, and nothing marks which is which. The label now says what the data holds and claims no ADA verification, in six languages.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import TerritoireCouvert from '../../src/pages/TerritoireCouvert.jsx';

afterEach(() => cleanup());
const KEYS = { structures: ['serves.named', 'serves.code', 'empty.description_serves'], home: ['territory.serves.title', 'territory.serves.text', 'territory.serves.submit'] };
const FALSE_CLAIM = /vérifiée? par ADA|zone d['’]intervention vérifiée|checked by ADA|verified by ADA|ADA tarafından (doğrulan|kontrol)|von ADA (geprüft|überprüft)|перевірен\S* ADA|ADA\s*(تحقق|تحققت|راجعت)|(تحقق|تحققت|راجعت)\s*(منها\s*)?ADA/i;

describe('A-3: the commune filter of the directory claims no verified service area', () => {
  it('the directory banner and its empty state say « located in … or declares working there », never « vérifiée par ADA »', () => {
    const src = fs.readFileSync('src/pages/Annuaire.jsx', 'utf8');
    const strings = [...src.matchAll(/t\('structures:(?:serves\.(?:named|code)|empty\.description_serves)', "([^"]+)"/g)].map((m) => m[1]);
    expect(strings).toHaveLength(3);
    for (const s of strings) expect(s).not.toMatch(FALSE_CLAIM);
    expect(strings[0]).toBe("Lieux situés à {{commune}} ou dont la structure déclare y intervenir (code Insee {{code}}). Vérifiez auprès de la structure qu'elle peut vous recevoir.");
    expect(src).not.toMatch(/vérifiée par ADA/);
  });

  it('the territory page describes the same filter honestly', () => {
    render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/territoire'] }, h(TerritoireCouvert))));
    const section = screen.getByTestId('territoire-serves');
    expect(section).toHaveTextContent('Lieux enregistrés pour une commune');
    expect(section).toHaveTextContent('Pour la plupart des fiches, la seule information connue est la commune où le lieu est situé');
    expect(section).not.toHaveTextContent(/vérifiée? par ADA/);
    expect(section).not.toHaveTextContent(/desserv/);
    expect(screen.getByRole('button', { name: 'Voir les lieux enregistrés pour cette commune' })).toBeInTheDocument();
  });

  it.each(['en', 'tr', 'ar', 'de', 'uk'])('%s: the translations of these labels make no ADA-verification claim and keep the placeholders', (lang) => {
    for (const [ns, keys] of Object.entries(KEYS)) {
      const loc = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/${ns}.json`, 'utf8'));
      for (const k of keys) {
        expect(loc[k], `${lang} ${ns}:${k}`).toBeTruthy();
        expect(loc[k], `${lang} ${ns}:${k}`).not.toMatch(FALSE_CLAIM);
        expect(loc[k], `${lang} ${ns}:${k}`).not.toMatch(/\bADA\b/);
      }
      if (ns === 'structures') { expect(loc['serves.named']).toContain('{{commune}}'); expect(loc['serves.named']).toContain('{{code}}'); expect(loc['serves.code']).toContain('{{code}}'); }
    }
  });
});
