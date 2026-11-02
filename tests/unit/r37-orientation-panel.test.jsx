// @vitest-environment jsdom
/* global document */
/**
 * R37 — « Votre situation »: the needs in order of urgency, their official texts marked French and left-to-right (an Arabic page flipped their punctuation),
 * a published sheet opening its page on the site and another one Service-Public, the question as two re-searches, the cautions on the aide cards.
 */
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import OrientationPanel from '../../src/components/search/OrientationPanel.jsx';
import SearchResultCard from '../../src/components/search/SearchResultCard.jsx';
import { analyseNeeds } from '../../api/lib/multi-need.js';

const wrap = (el) => render(h(MemoryRouter, null, el));
const orientation = (q) => {
  const a = analyseNeeds([q], { now: new Date('2026-11-02T12:00:00Z') });
  const ids = [...new Set([...a.needs.flatMap((n) => [...n.sheets, ...n.rules.map((r) => r.sheet)]), ...a.cautions.flatMap((c) => c.sheets)])];
  const sources = Object.fromEntries(ids.map((id) => [id, { title: `Fiche ${id}`, url: `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`, slug: id === 'F3079' ? 'aide-medicale-f3079' : null }]));
  return { ...a, cautions: a.cautions.map(({ aides: _p, ...c }) => c), sources };
};

describe('OrientationPanel', () => {
  it('lists the needs in order, French texts left-to-right, local and Service-Public sheets', () => {
    wrap(h(OrientationPanel, { orientation: orientation('je suis sans titre de séjour et sans logement'), query: 'q' }));
    const needs = [...document.querySelectorAll('[data-testid^="orientation-need-"]')].map((x) => x.getAttribute('data-testid'));
    expect(needs).toEqual(['orientation-need-hebergement-urgence', 'orientation-need-droits-sans-titre']);
    expect(screen.getByRole('link', { name: 'Fiche F3079' }).getAttribute('href')).toBe('/bonnes-pratiques/aide-medicale-f3079');
    expect(screen.getAllByRole('link', { name: /Fiche F12006/ })[0].getAttribute('href')).toMatch(/service-public\.gouv\.fr.*F12006$/);
    const caution = document.querySelector('[data-testid="orientation-caution-permit-housing-aid"] span');
    expect([caution.getAttribute('lang'), caution.getAttribute('dir')]).toEqual(['fr', 'ltr']);
    expect(document.querySelector('a[href="tel:115"]')).not.toBeNull();
  });
  it('the question offers two re-searches; nothing without a need or a question', () => {
    wrap(h(OrientationPanel, { orientation: orientation('je suis étranger et je cherche un logement'), query: 'je suis étranger' }));
    expect(screen.getByRole('link', { name: 'Non' }).getAttribute('href')).toBe(`/recherche?q=${encodeURIComponent('je suis étranger sans titre de séjour')}`);
    const empty = render(h(MemoryRouter, null, h(OrientationPanel, { orientation: null, query: 'x' })));
    expect(empty.container.innerHTML).toBe('');
  });
  it('an aide card shows the caution that concerns it', () => {
    const o = orientation('sans titre de séjour et sans logement');
    wrap(h(SearchResultCard, { result: { id: 'a', slug: 'apl', title: 'Aide personnalisée au logement (APL)', cautions: ['permit-housing-aid'] }, cautions: o.cautions }));
    expect(screen.getByTestId('search-result-caution').textContent).toMatch(/titre de séjour en cours de validité/);
  });
});
