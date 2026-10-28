// @vitest-environment jsdom
/**
 * PKG-11 / P28 — the territorial entry point /territoire: the 33 communes INSEE lists for the Eurométropole de Strasbourg, where the list comes from, that no
 * person has validated it yet, and one directory link per commune that speaks of structures LOCATED there (never « serving you »). No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import TerritoireCouvert from '../../src/pages/TerritoireCouvert.jsx';

const svc = JSON.parse(fs.readFileSync('data/geography/service-territory.v1.json', 'utf8'));
afterEach(cleanup);
const page = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(TerritoireCouvert))));

describe('PKG-11 / P28 /territoire', () => {
  it('lists every commune of the service territory with a directory link on its exact name', () => {
    page();
    const links = screen.getByTestId('territoire-communes').querySelectorAll('a');
    expect(links).toHaveLength(33);
    expect([...links].map((a) => a.getAttribute('data-commune'))).toEqual(svc.communes.map((c) => c[0]));
    const strasbourg = [...links].find((a) => a.getAttribute('data-commune') === '67482');
    expect(strasbourg).toHaveAttribute('href', '/structures?city=Strasbourg');
    expect([...links].find((a) => a.getAttribute('data-commune') === '67204')).toHaveAttribute('href', `/structures?city=${encodeURIComponent('Hœnheim')}`);
    expect(strasbourg).toHaveAccessibleName(/^Strasbourg ?: structures situées dans cette commune$/);
  });

  it('says where the list comes from and that no person has validated it, and never claims the structures serve the person', () => {
    const { container } = page();
    expect(screen.getByTestId('territoire-source')).toHaveTextContent(/Insee/);
    expect(screen.getByTestId('territoire-validation')).toHaveTextContent("Cette liste n'a pas encore été vérifiée par une personne de l'équipe.");
    expect(container).toHaveTextContent(/Être situé dans une commune ne veut pas dire servir/);
    expect(container.textContent).not.toMatch(/vérifiée par une personne\.|éligible|vous avez droit/i);
    const nav = fs.readFileSync('src/pages/Layout.jsx', 'utf8');
    expect(nav).toContain("{ label: 'Territoire couvert', href: '/territoire' }");
  });

  it('has no serious or critical axe violation', async () => {
    const { container } = page();
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
});
