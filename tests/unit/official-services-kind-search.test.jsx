// @vitest-environment jsdom
/**
 * 12/11/2026 (Production fc0e40b) — Outils › « Services en ligne officiels »: « cerfa » found 2 services although hundreds are cerfa forms, because only
 * `title operator cerfa-number` were searched. The type of service (cerfa, formulaire, simulateur, modèle de lettre, démarche en ligne, recherche) now
 * finds its services, accent- and case-insensitively, in the same order (most cited, then title). No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ITEMS = [
  { id: 'f1', kind: 'formulaire', title: 'Demande de logement social', cerfa: '14069', cited: 5, categorie: 'logement' },
  { id: 'f2', kind: 'formulaire', title: 'Déclaration de naissance', cited: 9, categorie: 'famille' },
  { id: 's1', kind: 'simulateur', title: 'Estimer ses aides au logement', cited: 7, categorie: 'logement' },
  { id: 'm1', kind: 'modele', title: 'Contester une amende', cited: 1 },
  { id: 't1', kind: 'teleservice', title: 'Changer d’adresse', cited: 3 },
  { id: 'r1', kind: 'recherche', title: 'Annuaire de l’administration', cited: 2 },
  { id: 'p1', kind: 'formulaire', title: 'Formulaire réservé aux entreprises', audience: 'pro', cited: 50 },
];
vi.mock('@/config/officialServices.generated.json', () => ({ default: { items: ITEMS, source: { publisher: 'DILA', licence: 'Licence Ouverte 2.0', date: '2026-11-01' }, checkedAt: '2026-11-10' } }));

import OfficialServices from '../../src/components/OfficialServices.jsx';
import { filterServices } from '../../src/lib/officialServicesSearch.js';

afterEach(() => cleanup());
const ids = (q, o = {}) => filterServices(ITEMS, { q, ...o }).map((x) => x.id);

describe('Official services: the type of service is searchable', () => {
  it('« cerfa » and « formulaire » find every form, most cited first; accents and case do not matter', () => {
    expect(ids('cerfa')).toEqual(['f2', 'f1']);
    expect(ids('CERFA')).toEqual(['f2', 'f1']);
    expect(ids('Formulaires')).toEqual(['f2', 'f1']);
    expect(ids('cerfa', { pro: true })).toEqual(['p1', 'f2', 'f1']);
  });
  it('simulateur, modèle de lettre, démarche en ligne, recherche', () => {
    expect(ids('simulateur')).toEqual(['s1']);
    expect(ids('modèle de lettre')).toEqual(['m1']);
    expect(ids('demarche en ligne')).toEqual(['t1']);
    expect(ids('outil de recherche')).toEqual(['r1']);
  });
  it('the type narrows a title search and the cerfa number still works', () => {
    expect(ids('logement')).toEqual(['s1', 'f1']);
    expect(ids('cerfa logement')).toEqual(['f1']);
    expect(ids('14069')).toEqual(['f1']);
    expect(ids('')).toHaveLength(6);
  });
  it('the label of the kind in the interface language is searched too', () => {
    expect(filterServices(ITEMS, { q: 'simulator', kindLabels: { simulateur: 'Simulators' } }).map((x) => x.id)).toEqual(['s1']);
  });
  it('in the page: typing « cerfa » lists the forms', async () => {
    render(h(OfficialServices));
    const input = await screen.findByTestId('official-services-search');
    fireEvent.change(input, { target: { value: 'cerfa' } });
    expect(screen.getByTestId('official-services-count')).toHaveTextContent('2 services');
    expect(screen.getAllByTestId('official-service').map((li) => li.textContent)).toEqual([expect.stringContaining('Déclaration de naissance'), expect.stringContaining('Demande de logement social')]);
  });
});
