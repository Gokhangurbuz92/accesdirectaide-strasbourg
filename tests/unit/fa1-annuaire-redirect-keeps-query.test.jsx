// @vitest-environment jsdom
/**
 * FA-D1 (D-FA1-2) — the legacy directory path /annuaire redirects to /structures WITH its query. Found by the persona suite (e2e-fa1, P1): a link
 * /annuaire?serves=67482 (« places serving Strasbourg ») landed on /structures with no filter, and listed a Haut-Rhin place to a person in Strasbourg; the same
 * loss hit /annuaire?q=… and the booking fallback of src/lib/rdvRouting.js (appendRdvJourneyContext('/annuaire', …) adds ?next / ?aide / ?origin).
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import RedirectKeepingQuery from '../../src/components/routing/RedirectKeepingQuery.jsx';

afterEach(cleanup);
function Where() { const l = useLocation(); return h('p', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`); }
const at = (url) => render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
  h(Route, { path: '/annuaire', element: h(RedirectKeepingQuery, { to: '/structures' }) }),
  h(Route, { path: '/structures', element: h(Where) }))));

describe('FA-D1 — /annuaire keeps the filter it was given', () => {
  it('the commune filter, the words and the booking context survive the redirect', () => {
    at('/annuaire?serves=67482&q=logement#liste');
    expect(screen.getByTestId('where')).toHaveTextContent('/structures?serves=67482&q=logement#liste');
  });
  it('without a query it is the plain directory', () => {
    at('/annuaire');
    expect(screen.getByTestId('where').textContent).toBe('/structures');
  });
  it('the application routes use it for /annuaire (the plain <Navigate> dropped the query)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/pages/index.jsx'), 'utf8');
    expect(src).toMatch(/<Route path="\/annuaire" element={<RedirectKeepingQuery to="\/structures" \/>} \/>/);
    expect(src).not.toMatch(/<Route path="\/annuaire" element={<Navigate /);
  });
});
