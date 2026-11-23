// @vitest-environment jsdom
/**
 * G14-OBS — /observatoire and the opt-in box of the Rights Graph page.
 *   F  closed by default (VITE_OBSERVATOIRE): the method, the caveat and « not open yet » are shown, no request is made, no figure
 *   A  open: every chart is a table (caption, column and row headers), readings in words, masked cells « masqué », freeze date and source per quarter,
 *      download links (CSV, JSON, OpenAPI, licence); no « % » (DTA-B68 bans percentages on the public pages), no axe violation (WCAG 2 A/AA)
 *   R  Arabic: right-to-left document, logical CSS only (no left/right utilities), quarter labels isolated
 *   O  the opt-in: rendered only when the build opens it, UNTICKED by default, nothing stored; sendSituationSignal sends only { situation } and only when ticked
 *   T  the page's French method text is the registry's master text (api/lib/demand-signals.js METHOD_TEXT)
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Observatoire from '../../src/pages/Observatoire.jsx';
import SituationSignalOptIn from '../../src/components/observatoire/SituationSignalOptIn.jsx';
import { observatoireOpened, sendSituationSignal, situationSignalsOpened } from '../../src/lib/observatoire.js';
import { METHOD_TEXT } from '../../api/lib/demand-signals.js';
import { sampleBody } from '../fixtures/g14-obs-sample.js';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
afterEach(() => { cleanup(); globalThis.document.documentElement.removeAttribute('dir'); });

const page = (props) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(Observatoire, props))));
const runAxe = (node) => axe.run(node, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'], rules: { 'color-contrast': { enabled: false } } });

describe('G14-OBS F closed by default', () => {
  it('the build switches are exact and closed in the test build', () => {
    expect(observatoireOpened()).toBe(false);
    for (const v of ['', '1', 'true', 'opened', null]) expect(observatoireOpened(v), String(v)).toBe(false);
    expect(observatoireOpened(' open ')).toBe(true);
    expect(situationSignalsOpened()).toBe(false);
    expect(situationSignalsOpened('search,parcours')).toBe(false);
    expect(situationSignalsOpened('search, situation')).toBe(true);
  });
  it('closed: caveat, « not open yet », method — and nothing is requested', async () => {
    const load = vi.fn();
    const { container } = page({ load, opened: false });
    expect(screen.getByTestId('obs-closed')).toBeInTheDocument();
    expect(screen.getByTestId('obs-caveat')).toHaveTextContent('pas une mesure du non-recours officiel');
    expect(screen.getByTestId('obs-method')).toBeInTheDocument();
    expect(screen.queryByTestId('obs-open-data')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect((await runAxe(container)).violations.map((v) => v.id)).toEqual([]);
  });
});

describe('G14-OBS A open', () => {
  it('tables with captions and headers, readings in words, freeze date and source, downloads; no percentage; no axe violation', async () => {
    const { container } = page({ load: async () => sampleBody(), opened: true });
    await waitFor(() => expect(screen.getByTestId('obs-quarter')).toBeInTheDocument());
    expect(screen.getByTestId('obs-frozen')).toHaveTextContent('Chiffres figés le 1 octobre 2026. Source : AccesDirectAide');
    const t = screen.getByTestId('obs-search-table');
    expect(t.querySelector('caption')).not.toBeNull();
    expect(t.querySelectorAll('thead th[scope="col"]').length).toBe(4);
    expect(t.querySelectorAll('tbody th[scope="row"]').length).toBe(20);
    expect(t).toHaveTextContent('Aucun lieu publié dans l’Eurométropole');
    expect(screen.getByTestId('obs-search-summary')).toHaveTextContent('Précarité');
    expect(screen.getByTestId('obs-leads')).toHaveTextContent('aucun lieu publié dans la commune');
    expect(screen.getByTestId('obs-sub-precarite')).toHaveTextContent('masqué');
    expect(screen.getByTestId('obs-situations-not-collected')).toBeInTheDocument();
    expect(screen.getByTestId('obs-parcours')).toHaveTextContent('Demander le RSA');
    expect(screen.getByTestId('obs-supply-domains')).toHaveTextContent('1 à 4');
    for (const bar of container.querySelectorAll('.bg-blue-700.h-2')) expect(bar.getAttribute('aria-hidden')).toBe('true');
    const links = [...screen.getByTestId('obs-open-data').querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/api/public/observatoire?format=csv', '/api/public/observatoire', '/api/docs/openapi.json', 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/']);
    expect(container.textContent).not.toMatch(/\d\s?%/);
    expect(container.textContent).not.toMatch(/personnes aidées|taux de non-recours/i);
    expect((await runAxe(container)).violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
  it('no quarter yet: says so; a failed read says so', async () => {
    page({ load: async () => ({ ...sampleBody(), quarters: [] }), opened: true });
    await waitFor(() => expect(screen.getByTestId('obs-no-quarter')).toBeInTheDocument());
    cleanup();
    page({ load: async () => null, opened: true });
    await waitFor(() => expect(screen.getByTestId('obs-unavailable')).toBeInTheDocument());
  });
});

describe('G14-OBS R right to left', () => {
  it('logical CSS only and isolated quarter labels', () => {
    for (const f of ['src/pages/Observatoire.jsx', 'src/components/observatoire/ObservatoireData.jsx', 'src/components/observatoire/SituationSignalOptIn.jsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/(?<=["'`\s])(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-(?:\d|\[)|\btext-(?:left|right)\b/);
    }
    expect(fs.readFileSync('src/components/observatoire/ObservatoireData.jsx', 'utf8')).toContain('<bdi>{q.quarter}</bdi>');
  });
  it('the Arabic interface carries every key of the page', () => {
    const ar = JSON.parse(fs.readFileSync('src/i18n/locales/ar/observatory.json', 'utf8'));
    expect(ar['caveat.text']).toMatch(/ليست/);
    for (const l of ['en', 'de', 'tr', 'uk']) expect(Object.keys(JSON.parse(fs.readFileSync(`src/i18n/locales/${l}/observatory.json`, 'utf8')))).toEqual(Object.keys(ar));
  });
});

describe('G14-OBS O the opt-in', () => {
  it('nothing unless opened; unticked by default; the parent keeps the choice', async () => {
    const closed = render(createElement(MemoryRouter, null, createElement(SituationSignalOptIn, { checked: false, onChange: () => {}, opened: false })));
    expect(closed.container.innerHTML).toBe(''); cleanup();
    const onChange = vi.fn();
    const { container } = render(createElement(MemoryRouter, null, createElement(SituationSignalOptIn, { checked: false, onChange, opened: true })));
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleName(/Aider l’Observatoire/);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.document.cookie).toBe('');
    expect((await runAxe(container)).violations.map((v) => v.id)).toEqual([]);
  });
  it('sendSituationSignal: only when ticked and opened, only { situation }, never in the address', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    expect(await sendSituationSignal('dettes', { optedIn: false, opened: true, fetchImpl })).toBe(false);
    expect(await sendSituationSignal('dettes', { optedIn: true, opened: false, fetchImpl })).toBe(false);
    expect(await sendSituationSignal('', { optedIn: true, opened: true, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await sendSituationSignal('dettes', { optedIn: true, opened: true, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/public/signal');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ situation: 'dettes' });
  });
});

describe('G14-OBS T the master text', () => {
  it('the page shows the registry method text, word for word', () => {
    const src = fs.readFileSync('src/pages/Observatoire.jsx', 'utf8');
    for (const [k, v] of Object.entries(METHOD_TEXT)) expect(src, k).toContain(v);
  });
});
