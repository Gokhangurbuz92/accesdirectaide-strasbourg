// @vitest-environment jsdom
/* global document */
// FA-D4 — six-language formatting and Arabic bidirectional isolation.
//  1. The news card printed its verification date with a fixed « fr-FR » (12/10/2026) inside a translated sentence: a German reader saw the French
//     numeric form instead of 12.10.2026 (every other record card already used formatDate in the interface language).
//  2. Arabic (RTL): a value inserted into a sentence (a name, an e-mail address, a date, an amount, a count) is a run of unknown direction; without
//     isolation the Unicode bidi algorithm lets it merge with the neighbouring punctuation and digits, so « Jean (2) » or « 12 € – 15 € » can be shown
//     in the wrong order. W3C « Inline markup and bidirectional text in HTML » recommends isolating such inserted text (FSI U+2068 … PDI U+2069).
//     Inserted values are now isolated in Arabic only; the five left-to-right languages are byte-for-byte unchanged.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import NewsCardV2 from '../../src/components/news/NewsCardV2.jsx';

const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
afterEach(async () => { cleanup(); await lang('fr'); });

const item = { id: 'n1', slug: 'n1', titre: 'Titre', resume: 'Résumé', lane: 'A', auto_publish: true, published_at: '2026-10-12T10:00:00Z', date_publication: '2026-10-11T10:00:00Z', publisher: 'Service-Public', topics: ['societe'], geo: { scope: 'france' }, coverage: [] };

describe('FA-D4 — dates in the interface language', () => {
  it('the news card dates its verification in the reader’s language (de: 12.10.2026, not 12/10/2026)', async () => {
    await lang('de');
    render(h(MemoryRouter, null, h(NewsCardV2, { item })));
    expect(document.body.textContent).toContain('12.10.2026');
    expect(document.body.textContent).not.toContain('12/10/2026');
  });
  it('French keeps 12/10/2026', async () => {
    render(h(MemoryRouter, null, h(NewsCardV2, { item })));
    expect(document.body.textContent).toContain('12/10/2026');
  });
});

describe('FA-D4 — Arabic: inserted values are isolated (FSI … PDI), other languages unchanged', () => {
  it('ar: a name with brackets and a number is isolated', async () => {
    await lang('ar');
    const s = i18n.t('fa4test:x', { defaultValue: 'Bonjour {{name}}, {{n}} messages', name: 'Jean (2)', n: 3 });
    expect(s).toContain('⁨Jean (2)⁩');
    expect(s).toContain('⁨3⁩');
  });
  it.each(['fr', 'en', 'tr', 'de', 'uk'])('%s: no invisible character is added', async (code) => {
    await lang(code);
    const s = i18n.t('fa4test:x', { defaultValue: 'Bonjour {{name}}', name: 'Jean (2)' });
    expect(s).toBe('Bonjour Jean (2)');
  });
  it('ar: a rendered sentence keeps the visible text (only isolation marks are added)', async () => {
    await lang('ar');
    render(h('p', { 'data-testid': 'p' }, i18n.t('fa4test:y', { defaultValue: 'Total : {{amount}}', amount: '12 € – 15 €' })));
    expect(screen.getByTestId('p').textContent.replace(/[⁦-⁩]/g, '')).toBe('Total : 12 € – 15 €');
  });
});
