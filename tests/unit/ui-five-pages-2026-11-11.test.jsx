// @vitest-environment jsdom
/**
 * Five public pages redesign (owner directive 11/11/2026): the shared catalogue layout and the interaction defects it fixed.
 *  - Aides: the sidebar « Catégorie » kept a slug and searched it inside titles (any choice emptied the list) → the category is the API filter (chips);
 *  - Aides / Démarches: a « Source » select changed the address only (the APIs have no source parameter) → removed;
 *  - Annuaire: « Liste / Carte » were role=tab without a tab panel → a real tab pair (panel labelled by its tab, arrow keys);
 *  - one page structure: PageHeader with the search inside, results bar, sidebar from `lg`, the same fields in a phone sheet with their own ids.
 */
import fs from 'node:fs';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveFilters, ChoiceChips, Pager } from '../../src/components/layout/catalog.jsx';

const read = (f) => fs.readFileSync(f, 'utf8');
const PAGES = ['Actualites', 'Aides', 'Demarches', 'Annuaire', 'Tools'];

describe('shared page structure', () => {
  it('every page draws the shared banner and the shared container', () => {
    for (const p of PAGES) {
      const s = read(`src/pages/${p}.jsx`);
      expect(s, p).toMatch(/<PageHeader[\s\n]/);
      expect(s, p).toMatch(/CatalogBody|CONTAINER/);
      expect(s, p).not.toMatch(/linear-gradient\(135deg, #020617/);   // the banner colours are the theme token, not a copy per page
    }
    expect(read('tailwind.config.js')).toMatch(/'ada-hero': 'linear-gradient\(135deg, #020617/);
    expect(read('src/components/layout/PageHeader.jsx')).toMatch(/bg-ada-hero/);
  });
  it('the catalogue pages put their search inside the banner and keep their test hooks', () => {
    expect(read('src/pages/Demarches.jsx')).toMatch(/inputTestId="demarches-search-input"[\s\S]*submitTestId="demarches-search-submit"/);
    expect(read('src/pages/Annuaire.jsx')).toMatch(/inputTestId="structures-search-input"/);
    for (const p of ['Aides', 'Demarches', 'Annuaire', 'Actualites']) expect(read(`src/pages/${p}.jsx`), p).toMatch(/<HeroSearch/);
  });
  it('the phone filter sheet draws the same fields with their own ids (no duplicate id, labels point to the visible field)', () => {
    for (const p of ['Aides', 'Demarches', 'Annuaire', 'Actualites']) {
      const s = read(`src/pages/${p}.jsx`);
      expect(s, p).toMatch(/render=\{renderFilters\}/);
      expect(s, p).toMatch(/id=\{`\$\{prefix\}/);
    }
    expect(read('src/components/layout/catalog.jsx')).toMatch(/render\('m-'\)/);
  });
});

describe('interaction defects fixed', () => {
  it('Aides: no category matched inside titles; the category is the API filter', () => {
    const s = read('src/pages/Aides.jsx');
    expect(s).not.toMatch(/searchStr\.includes\(localFilters\.category/);
    expect(s).toMatch(/const INITIAL_LOCAL_FILTERS = \{ urgentOnly: false \}/);
    expect(s).toMatch(/<ChoiceChips label=\{t\('aides:filters\.category', 'Catégorie'\)\}[^\n]*onChange=\{\(v\) => handleParamChange\('category', v\)\}/);
    expect(s).toContain("urgentOnly ? 'true' : undefined");
  });
  it('Aides and Démarches: no « Source » control that the API ignores', () => {
    expect(read('src/pages/Aides.jsx')).not.toMatch(/id=\{?["`]?\$?\{?prefix?\}?aides-source/);
    expect(read('src/pages/Aides.jsx')).not.toMatch(/handleParamChange\('source'/);
    expect(read('src/pages/Demarches.jsx')).not.toMatch(/handleParamChange\('source'/);
    expect(read('api/_utils/validators.js')).not.toMatch(/searchDemarchesSchema = baseSearchSchema\.extend\(\{[^}]*source:/);
  });
  it('Annuaire: list / map is a tab pair with a labelled panel (the QA clicks the tab « Carte »)', () => {
    const s = read('src/pages/Annuaire.jsx');
    expect(s).toMatch(/role="tablist"/);
    expect(s).toMatch(/id="annuaire-tab-map" role="tab"[^>]*aria-controls="annuaire-panel"/);
    expect(s).toMatch(/id="annuaire-panel" role="tabpanel" aria-labelledby=\{`annuaire-tab-\$\{viewMode\}`\}/);
    expect(s).toMatch(/data-testid="map-provider-notice"/);
    expect(s).toMatch(/data-testid="annuaire-serves-filter"/);
  });
  it('Outils: official services and AccesDirectAide tools are labelled apart', () => {
    const s = read('src/pages/Tools.jsx');
    expect(s).toMatch(/t\('tools:official\.badge', 'Service officiel'\)/);
    expect(s).toMatch(/t\('tools:ada\.badge', 'AccesDirectAide'\)/);
    expect(s).toMatch(/<OfficialTools \/>/);
  });
});

describe('shared components', () => {
  it('ChoiceChips: pressed state, choosing the active chip again clears it', () => {
    const onChange = vi.fn();
    render(h(ChoiceChips, { label: 'Catégorie', value: 'logement', onChange, options: [{ value: '', label: 'Toutes' }, { value: 'logement', label: 'Logement', count: 3 }] }));
    const b = screen.getByRole('button', { name: /Logement/ });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Catégorie' })).toBeTruthy();
    fireEvent.click(b); expect(onChange).toHaveBeenCalledWith('');
  });
  it('ActiveFilters: each chip is a named remove button; « Tout effacer » with two filters or more', () => {
    const a = vi.fn(); const clear = vi.fn();
    render(h(ActiveFilters, { items: [{ key: 'q', label: '« rsa »', onRemove: a }, { key: 'c', label: 'Logement', onRemove: vi.fn() }], onClear: clear }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le filtre « rsa »' })); expect(a).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' })); expect(clear).toHaveBeenCalled();
  });
  it('Pager: hidden for one page, previous disabled on page 1', () => {
    const { container } = render(h(Pager, { page: 1, totalPages: 1, hasNext: false, onPage: () => {}, label: 'Pages', previous: 'Précédent', next: 'Suivant', status: 'Page 1 / 1' }));
    expect(container.firstChild).toBeNull();
    render(h(Pager, { page: 1, totalPages: 3, hasNext: true, onPage: () => {}, label: 'Pages', previous: 'Précédent', next: 'Suivant', status: 'Page 1 / 3' }));
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Précédent' }).hasAttribute('disabled')).toBe(true);
  });
});
