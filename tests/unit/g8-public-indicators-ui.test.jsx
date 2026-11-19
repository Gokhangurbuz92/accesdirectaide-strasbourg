// @vitest-environment jsdom
/**
 * G8 — the public indicators section of /impact: hidden unless the build sets VITE_PUBLIC_INDICATORS=open; dated (« Calculé le … »); every card says what the
 * figure does not mean; a link check that did not run says « non mesuré » instead of 0; logical CSS only (RTL); the Arabic interface mirrors it.
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicIndicatorsOpened } from '../../src/lib/publicBeta.js';
import PublicIndicators from '../../src/components/impact/PublicIndicators.jsx';
import { loadPublicIndicators } from '../../src/lib/publicIndicators.js';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
afterEach(() => cleanup());

const BODY = {
  schema: 'ada.public-indicators.v1', computedAt: '2026-11-19T10:00:00.000Z',
  rules: { visibility: 'D5_STRICT', currentDays: 90, maxAgeDays: 180, kMin: 5, linkWindowDays: 35 },
  catalogue: { aides: 120, demarches: 80, structures: 300, dispositifs: 4, guides: 37, actualites: 10 },
  aidesByDomain: [{ domain: 'LOGEMENT', count: 20 }, { domain: 'SANTE', count: 7 }],
  aidesByScope: [{ scope: 'NATIONAL', count: 100 }, { scope: 'UNSPECIFIED', count: 20 }],
  structuresByCommune: { cells: [{ commune: '67482', label: 'Strasbourg', count: 200 }], maskedCommunes: 3, notLocated: null, kMin: 5 },
  freshness: { aide: { visible: 120, current: 100, updateNeeded: 20, currentShare: 83.3 }, demarche: { visible: 0, current: 0, updateNeeded: 0, currentShare: null },
    structure: { visible: 300, current: 300, updateNeeded: 0, currentShare: 100 }, dispositif: { visible: 4, current: 4, updateNeeded: 0, currentShare: 100 } },
  linkHealth: { measured: false, windowDays: 35 },
  translations: { languages: { en: { aide: { full: 10, partial: 2 }, demarche: { full: 1, partial: 0 }, guide: { full: 0, partial: 0 }, actualite: { full: 0, partial: 0 } } },
    of: { aide: 120, demarche: 80, guide: 37, actualite: 10 } },
  structuresInformation: { visible: 300, stepFreeAccessIndicated: 80, openingHoursIndicated: 150 },
  rightsNeeds: { needs: 22, officialFiches: 60, sourcesReadOn: '2026-11-18' },
};

describe('G8 public indicators — flag', () => {
  it('hidden unless the build value is exactly « open »', () => {
    for (const v of ['', '1', 'true', 'opened', null]) expect(publicIndicatorsOpened(v), String(v)).toBe(false);
    expect(publicIndicatorsOpened('open')).toBe(true);
    expect(publicIndicatorsOpened(), 'the test build does not set VITE_PUBLIC_INDICATORS').toBe(false);
  });
  it('/impact renders the section only behind the flag', () => {
    const impact = fs.readFileSync('src/pages/Impact.jsx', 'utf8');
    expect(impact).toMatch(/\{publicIndicatorsOpened\(\) && <PublicIndicators \/>\}/);
  });
  it('the loader asks the public route without credentials and refuses another schema', async () => {
    const calls = [];
    const ok = await loadPublicIndicators(async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => BODY }; });
    expect(ok.schema).toBe('ada.public-indicators.v1'); expect(calls[0]).toEqual(['/api/public/indicators', { credentials: 'omit' }]);
    expect(await loadPublicIndicators(async () => ({ ok: true, json: async () => ({ schema: 'other' }) }))).toBeNull();
    expect(await loadPublicIndicators(async () => ({ ok: false, status: 404 }))).toBeNull();
  });
});

describe('G8 public indicators — rendering', () => {
  it('dated, every card says what it does not mean, « non mesuré » instead of 0, masked cells are words', async () => {
    render(createElement(PublicIndicators, { load: async () => BODY }));
    expect(await screen.findByTestId('public-indicators-computed')).toHaveTextContent(/Calculé le 19\/11\/2026/);
    expect(screen.getByTestId('ind-links-not-measured')).toHaveTextContent('Non mesuré');
    const cards = screen.getAllByText('Ce que ce chiffre ne dit pas :');
    expect(cards.length).toBe(9);
    expect(screen.getByTestId('ind-communes')).toHaveTextContent('masqué');
    expect(screen.getByTestId('ind-communes')).toHaveTextContent('Strasbourg');
    expect(screen.getByTestId('ind-freshness')).toHaveTextContent('aucune fiche');
    expect(screen.getByText(/Ils ne mesurent pas le non-recours/)).toBeInTheDocument();
    expect(screen.getByTestId('public-indicators').textContent).not.toMatch(/personnes aidées\s*:\s*\d|vous avez droit|éligible/i);
  });
  it('an unreadable answer says so (no zero, no empty card)', async () => {
    render(createElement(PublicIndicators, { load: async () => null }));
    expect(await screen.findByTestId('public-indicators-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('ind-catalogue')).toBeNull();
  });
  it('logical CSS only (the Arabic interface mirrors the layout)', () => {
    const src = fs.readFileSync('src/components/impact/PublicIndicators.jsx', 'utf8');
    expect(src).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d|\btext-(?:left|right)\b|\b(?:border|rounded)-[lr]\b/);
  });
});
