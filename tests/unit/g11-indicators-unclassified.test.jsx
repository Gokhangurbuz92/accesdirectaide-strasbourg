// @vitest-environment jsdom
/**
 * G11 (live check 20/11/2026 after the G8 opening): every published benefit in Production sits in category AUTRE and territory scope UNSPECIFIED, so /impact
 * showed « Logement 0, Santé 0 … Autre ou non classé 109 », which reads as « no housing benefit ». A breakdown with nothing classified now says it is not
 * measurable yet; as soon as one benefit is classified the full table (catch-all row included) comes back. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicIndicators from '../../src/components/impact/PublicIndicators.jsx';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
afterEach(() => cleanup());

const DOMAINS = ['LOGEMENT', 'SANTE', 'HANDICAP', 'EMPLOI', 'FAMILLE', 'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'JUSTICE', 'NUMERIQUE', 'AUTRE'];
const SCOPES = ['NATIONAL', 'REGIONAL', 'DEPARTMENTAL', 'COMMUNAL', 'UNSPECIFIED'];
const body = (domains, scopes) => ({
  schema: 'ada.public-indicators.v1', computedAt: '2026-11-19T23:43:42.507Z',
  rules: { visibility: 'D5_STRICT', currentDays: 90, maxAgeDays: 180, kMin: 5, linkWindowDays: 35 },
  catalogue: { aides: 109, demarches: 169, structures: 1646, dispositifs: 519, guides: 75, actualites: 34 },
  aidesByDomain: DOMAINS.map((domain) => ({ domain, count: domains[domain] ?? 0 })),
  aidesByScope: SCOPES.map((scope) => ({ scope, count: scopes[scope] ?? 0 })),
  structuresByCommune: { cells: [{ commune: '67482', label: 'Strasbourg', count: 334 }], maskedCommunes: 451, notLocated: 37, kMin: 5 },
  freshness: { aide: { visible: 109, current: 109, updateNeeded: 0, currentShare: 100 }, demarche: { visible: 169, current: 169, updateNeeded: 0, currentShare: 100 },
    structure: { visible: 1646, current: 1646, updateNeeded: 0, currentShare: 100 }, dispositif: { visible: 519, current: 519, updateNeeded: 0, currentShare: 100 } },
  linkHealth: { measured: false, windowDays: 35 },
  translations: { languages: {}, of: { aide: 109, demarche: 169, guide: 75, actualite: 34 } },
  structuresInformation: { visible: 1646, stepFreeAccessIndicated: 0, openingHoursIndicated: 629 },
  rightsNeeds: { needs: 22, officialFiches: 34, sourcesReadOn: '2026-11-18' },
});

describe('G11: an unclassified breakdown is not shown as zeros', () => {
  it('Production 20/11 data (109 AUTRE, 109 UNSPECIFIED): « pas encore mesurable », no « Logement 0 »', async () => {
    render(createElement(PublicIndicators, { load: async () => body({ AUTRE: 109 }, { UNSPECIFIED: 109 }) }));
    const domains = await screen.findByTestId('ind-domains');
    expect(screen.getByTestId('ind-domains-unclassified')).toHaveTextContent('Pas encore mesurable : les 109 aides publiées ne sont pas encore classées par domaine');
    expect(domains).not.toHaveTextContent('Logement');
    expect(domains).toHaveTextContent('Ce n’est pas l’importance des besoins');
    const scopes = screen.getByTestId('ind-scopes');
    expect(screen.getByTestId('ind-scopes-unclassified')).toHaveTextContent('n’indiquent pas encore leur échelon');
    expect(scopes).not.toHaveTextContent('Nationales');
  });

  it('one benefit classified: the full table comes back, catch-all row included', async () => {
    render(createElement(PublicIndicators, { load: async () => body({ LOGEMENT: 1, AUTRE: 108 }, { NATIONAL: 1, UNSPECIFIED: 108 }) }));
    const domains = await screen.findByTestId('ind-domains');
    expect(screen.queryByTestId('ind-domains-unclassified')).toBeNull();
    expect(domains).toHaveTextContent('Logement');
    expect(domains).toHaveTextContent('Autre ou non classé');
    expect(screen.queryByTestId('ind-scopes-unclassified')).toBeNull();
    expect(screen.getByTestId('ind-scopes')).toHaveTextContent('Échelon non précisé');
  });
});

describe('G12: aides by the official source\'s own theme', () => {
  it('lists the source themes in French (lang=fr), the empty theme as « non indiqué »; absent from older answers', async () => {
    render(createElement(PublicIndicators, { load: async () => ({ ...body({ AUTRE: 109 }, { UNSPECIFIED: 109 }),
      aidesBySourceTheme: [{ theme: 'Famille - Scolarité', count: 38 }, { theme: 'Logement', count: 11 }, { theme: null, count: 13 }] }) }));
    const card = await screen.findByTestId('ind-themes');
    expect(card).toHaveTextContent('Famille - Scolarité38');
    expect(card).toHaveTextContent('Thème non indiqué par la source13');
    expect(screen.getByText('Logement').getAttribute('lang')).toBe('fr');
    expect(screen.getByText('Thème non indiqué par la source').getAttribute('lang')).toBeNull();
    cleanup();
    render(createElement(PublicIndicators, { load: async () => body({ AUTRE: 109 }, { UNSPECIFIED: 109 }) }));
    await screen.findByTestId('ind-domains');
    expect(screen.queryByTestId('ind-themes')).toBeNull();
  });
});
