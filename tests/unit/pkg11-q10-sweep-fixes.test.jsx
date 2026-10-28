// @vitest-environment jsdom
/**
 * PKG-11 / Q10 — fixes found by the seven-surface route sweep (DTA-B69), pinned at unit level:
 *  - the app picks the Admin / Pro section by PATH SEGMENT: « /proposer-une-structure » (public) and the legacy « /adminaides » redirects were sent to the
 *    Pro / Admin routers, where nothing matched (blank page);
 *  - a full-page « introuvable » / « could not load » state is the page's level-1 heading (EmptyState / LoadError headingLevel);
 *  - the aides page never echoes an unknown theme or territory from the address into its heading;
 *  - the territory picker opens the directory on the places that SERVE the commune;
 *  - the FALC switch of the detail pages turns the site-wide FALC mode on (it used to change only itself: the pages never showed the easy-to-read text).
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import EmptyState from '../../src/components/ui/EmptyState';
import LoadError from '../../src/components/LoadError.jsx';
import TerritoireCouvert from '../../src/pages/TerritoireCouvert.jsx';
import FalcToggle from '../../src/components/FalcToggle.jsx';
import { FalcProvider, useFalc } from '../../src/contexts/FalcContext.jsx';

afterEach(() => cleanup());

describe('Q10 sweep fixes', () => {
  it('section routing by path segment, never by the first letters', () => {
    const src = fs.readFileSync('src/pages/index.jsx', 'utf8');
    expect(src).toContain("const inSection = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + '/');");
    expect(src).toContain("if (inSection(location.pathname, '/admin')) {"); expect(src).toContain("if (inSection(location.pathname, '/pro')) {");
    expect(src).not.toMatch(/location\.pathname\.startsWith\('\/(admin|pro)'\)/);
    expect(src).toContain('<Route path="/proposer-une-structure"'); expect(src).toContain('<Route path="/adminaides"');
  });

  it('a full-page state can be the level-1 heading; inside a page it stays a level-3 one', () => {
    render(h(EmptyState, { title: 'Guide introuvable', headingLevel: 1 }));
    expect(screen.getByRole('heading', { level: 1, name: 'Guide introuvable' })).toBeInTheDocument();
    render(h(LoadError, { what: 'ce dispositif', onRetry: () => {}, testId: 'x', headingLevel: 1 }));
    expect(screen.getByRole('heading', { level: 1, name: 'Impossible de charger ce dispositif' })).toBeInTheDocument();
    render(h(EmptyState, { title: 'Aucun résultat' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Aucun résultat' })).toBeInTheDocument();
  });

  it('the aides heading names only a known theme / commune', () => {
    const src = fs.readFileSync('src/pages/Aides.jsx', 'utf8');
    expect(src).not.toMatch(/\?\.label \|\| categorySlug/); expect(src).not.toMatch(/en \$\{territorySlug\}/);
    expect(src).toContain('data-testid="aides-unknown-theme"');
  });

  it('the territory picker opens the directory on the places that serve the chosen commune', () => {
    let at = '';
    const Where = () => { at = useLocation().pathname + useLocation().search; return null; };
    render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/territoire'] }, h(Routes, null, h(Route, { path: '/territoire', element: h(TerritoireCouvert) }), h(Route, { path: '/structures', element: h(Where) })))));
    fireEvent.change(screen.getByLabelText('Commune'), { target: { value: '67447' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voir les lieux qui la desservent' }));
    expect(at).toBe('/structures?serves=67447');
  });

  it('the FALC switch turns the site-wide FALC mode on and off', () => {
    const Mode = () => h('output', { 'data-testid': 'mode' }, String(useFalc().isFalcEnabled));
    render(h(FalcProvider, null, h(FalcToggle, { hasFalcContent: true, review: { fields: { summary_falc: '2026-10-24T00:00:00.000Z' } } }), h(Mode)));
    const sw = screen.getByRole('switch', { name: 'Activer la version facile à lire (FALC)' });
    expect(screen.getByTestId('mode')).toHaveTextContent('false'); expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(screen.getByTestId('mode')).toHaveTextContent('true'); expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(screen.getByTestId('mode')).toHaveTextContent('false');
  });
});
