// @vitest-environment jsdom
/**
 * G14-FIND — the word-aware term match of the word searches (four letters start a word: « CCAS » ≠ « oCCASion »; three letters are whole words) and the
 * places scope of /recherche with a commune (the page says where the places come from; the form no longer says places are not filtered). No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const answer = vi.hoisted(() => ({ value: null }));
vi.mock('@/lib/searchClient', async (orig) => ({ ...(await orig()), searchAides: vi.fn(async () => answer.value) }));
vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));

import Recherche from '../../src/pages/Recherche.jsx';
import { isShortTerm, isWordStartTerm, termMatch } from '../../api/lib/search-query.js';
import { communeNamed } from '../../api/_handlers/search.js';

afterEach(() => cleanup());
const dialect = new PgDialect();
const render$ = (t) => dialect.sqlToQuery(termMatch(sql.raw('x'), t));

describe('G14-FIND: the term match is word-aware for short terms and acronyms', () => {
  it('3 letters: whole word; 4 letters: start of a word; 5+: substring', () => {
    expect(isShortTerm('caf')).toBe(true); expect(isWordStartTerm('ccas')).toBe(true); expect(isWordStartTerm('logement')).toBe(false);
    expect(render$('caf')).toMatchObject({ sql: 'x ~ $1', params: ['\\mcaf\\M'] });
    expect(render$('ccas')).toMatchObject({ sql: 'x ~ $1', params: ['\\mccas'] });
    expect(render$('cpam').params).toEqual(['\\mcpam']);
    expect(render$('logement')).toMatchObject({ sql: 'x LIKE $1', params: ['%logement%'] });
  });
  it('the JS reading of the same regular expressions: « ccas » is not in « occasion », « soin » is in « soins », « caf » is not in « cafe »', () => {
    const js = (t) => new RegExp(isShortTerm(t) ? `\\b${t}\\b` : `\\b${t}`);
    expect(js('ccas').test("vehicule d'occasion")).toBe(false); expect(js('ccas').test('aide du ccas')).toBe(true);
    expect(js('soin').test('soins infirmiers')).toBe(true); expect(js('caf').test('cafe solidaire')).toBe(false);
  });
  it('a commune typed after an office type is recognised in the covered territory only', () => {
    expect(communeNamed('schiltigheim')).toBe('67447'); expect(communeNamed('Illkirch Graffenstaden')).toBe('67218');
    expect(communeNamed('haguenau')).toBeNull(); expect(communeNamed('')).toBeNull();
  });
});

describe('G14-FIND /recherche with a commune: the places say where they come from', () => {
  const show = (path) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Recherche))));
  // the shape searchClient's normalizeResponse gives (structuresScope / structuresCommune carried through)
  const response = (scope, commune) => ({ results: [], demarches: [], dispositifs: [], actualites: [], guides: [], glossaire: [], safety: null, orientation: null, error: null,
    structures: [{ id: 's1', slug: 'ccas-bischheim', title: 'CCAS - Bischheim', ville: 'Bischheim', type: 'structure' }],
    structuresScope: scope || null, structuresCommune: commune || null, meta: { total: 0, totalAll: 1, message: null } });
  it('scope « territory »: no place recorded for the commune is said, the places of the Eurométropole follow', async () => {
    answer.value = response('territory', 'Schiltigheim');
    show('/recherche?q=CCAS&territoire=67447');
    const note = await screen.findByTestId('search-structures-scope');
    expect(note).toHaveAttribute('data-scope', 'territory');
    expect(note).toHaveTextContent('Aucun lieu correspondant n’est enregistré pour Schiltigheim : voici ceux d’autres communes de l’Eurométropole de Strasbourg.');
    expect(screen.getByText('CCAS - Bischheim')).toBeInTheDocument();
  });
  it('scope « commune »', async () => {
    answer.value = response('commune', 'Bischheim');
    show('/recherche?q=CCAS&territoire=67043');
    expect(await screen.findByTestId('search-structures-scope')).toHaveTextContent('Lieux enregistrés pour Bischheim.');
  });
  it('no scope (no commune): no note', async () => {
    answer.value = response(undefined, undefined);
    show('/recherche?q=CCAS');
    await screen.findByText('CCAS - Bischheim');
    expect(screen.queryByTestId('search-structures-scope')).toBeNull();
  });
  it('the form no longer says that places are not filtered; the new keys exist in the five translated languages', () => {
    expect(fs.readFileSync('src/components/search/AidesSearchForm.jsx', 'utf8')).not.toMatch(/les lieux et les actualités ne sont pas filtrés/);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const j = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/search.json`, 'utf8'));
      for (const k of ['form.territory-help-v2', 'structures_scope.commune', 'structures_scope.territory', 'structures_scope.all']) expect(j[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
