// @vitest-environment jsdom
/* global document */
/**
 * G14-CHAN (Part B) — lang / dir (RGAA 8.3, 8.4, 8.7): <html lang dir> follow EVERY interface language (Arabic right to left, the others left to right),
 * an unknown code falls back to French, a value inserted in an Arabic sentence is isolated (FSI … PDI), and a French passage inside a translated page
 * (the simplified FALC drafts, French whatever the interface) keeps lang="fr" dir="ltr" so a reader switches voice.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../src/i18n/languages.js';
import { applyDocumentLanguage, isolateInserted, setLanguage } from '../../src/i18n/index.js';
import FalcPageDraft from '../../src/components/FalcPageDraft.jsx';
import { FalcProvider } from '../../src/contexts/FalcContext.jsx';

afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('G14-CHAN lang / dir', () => {
  it.each(LANGUAGES.map((l) => [l.code, l.dir]))('%s → <html lang="%s"> dir %s', async (code, dir) => {
    await act(async () => { await setLanguage(code, { persist: false }); });
    expect(document.documentElement.lang).toBe(code);
    expect(document.documentElement.dir).toBe(dir);
    expect(dir).toBe(code === 'ar' ? 'rtl' : 'ltr');
  });
  it('an unknown code is French, left to right', () => {
    applyDocumentLanguage('xx');
    expect([document.documentElement.lang, document.documentElement.dir]).toEqual(['fr', 'ltr']);
  });
  it('inserted values are isolated in Arabic only, never twice', () => {
    expect(isolateInserted('CAF 67', 'ar')).toBe('⁨CAF 67⁩');
    expect(isolateInserted('⁨CAF 67⁩', 'ar')).toBe('⁨CAF 67⁩');
    expect(isolateInserted('CAF 67', 'fr')).toBe('CAF 67');
    expect(isolateInserted('', 'ar')).toBe('');
  });
  it('a French FALC draft inside an Arabic page keeps lang="fr" dir="ltr"', async () => {
    await act(async () => { await setLanguage('ar', { persist: false }); });
    render(h(FalcProvider, null, h(FalcPageDraft, { id: 'home', force: true })));
    const heading = screen.getByRole('heading', { level: 2 });
    const block = heading.closest('[lang]');
    expect(block).toHaveAttribute('lang', 'fr');
    expect(block).toHaveAttribute('dir', 'ltr');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
