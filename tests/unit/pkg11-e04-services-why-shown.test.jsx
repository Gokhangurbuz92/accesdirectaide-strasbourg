// @vitest-environment jsdom
/**
 * PKG-11 / E04 — services feed the shortlist and the directory cards. A structure listed because of a service it DECLARES (not its name) carries that service,
 * the notice says « par le nom ou par un service que la structure indique proposer » and never that it suits the person; name-only results are unchanged.
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTING_NOTICE, ROUTING_NOTICE_SERVICES, routeStructures } from '../../src/lib/structureRouting.js';
import StructureCard from '../../src/components/cards/StructureCard.jsx';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';

afterEach(cleanup);

describe('PKG-11 / E04 shortlist and « why shown »', () => {
  it('a structure whose declared service names the organism is listed with that service; the notice says so', () => {
    const r = routeStructures('votre CAF', [
      { id: 1, slug: 'caf-67', nom: 'CAF du Bas-Rhin', ville: 'Strasbourg' },
      { id: 2, slug: 'centre-x', nom: 'Centre social X', ville: 'Schiltigheim', services: ['Aide aux démarches CAF', 'Écrivain public'] },
      { id: 3, slug: 'centre-y', nom: 'Centre social Y', services: ['Écrivain public'] },
    ]);
    expect(r.mode).toBe('MATCHED');
    expect(r.structures).toEqual([
      { id: '1', slug: 'caf-67', nom: 'CAF du Bas-Rhin', ville: 'Strasbourg', rdvOnline: false },
      { id: '2', slug: 'centre-x', nom: 'Centre social X', ville: 'Schiltigheim', rdvOnline: false, service: 'Aide aux démarches CAF' },
    ]);
    expect(r.notice).toBe(ROUTING_NOTICE_SERVICES);
    expect(r.notice).toMatch(/indique proposer/); expect(r.notice).toMatch(/ne sait pas si/);
    expect(findProhibitedDecisionWording(r.notice)).toEqual([]);
  });

  it('name-only matches keep the original notice and item shape', () => {
    const r = routeStructures('votre CAF', [{ id: 1, slug: 'caf-67', nom: 'CAF du Bas-Rhin' }]);
    expect(r.notice).toBe(ROUTING_NOTICE);
    expect(r.structures[0]).not.toHaveProperty('service');
  });

  it('the directory card says which declared service matched, in the structure\'s own words', () => {
    render(createElement(MemoryRouter, null, createElement(StructureCard, { structure: { id: 's', slug: 's', nom: 'Centre social X', type_structure: 'association', whyShown: { services: ['Aide aux démarches CAF'] } } })));
    expect(screen.getByTestId('structure-why-shown')).toHaveTextContent('Correspond à votre recherche : indique proposer « Aide aux démarches CAF ».');
  });

  it('no « why shown » line without a matched service', () => {
    render(createElement(MemoryRouter, null, createElement(StructureCard, { structure: { id: 's', slug: 's', nom: 'Centre social X', type_structure: 'association' } })));
    expect(screen.queryByTestId('structure-why-shown')).toBeNull();
  });
});
