// @vitest-environment jsdom
/**
 * PKG-11 / P16 — the need named in the first wizard step brings sourced leads from the verified catalogue, ranked and explained, next to (never inside) the
 * assessment: a postal code becomes a département for structures, démarches are not filtered by place, kinds alternate best-first, each lead says why it is shown.
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { departementOf, interleave, whyShownOf } from '../../api/_handlers/assistant/recommendations.js';

const post = vi.hoisted(() => ({ fn: null }));
vi.mock('@/lib/assistant/client', () => ({ postRecommendations: (...a) => post.fn(...a) }));
afterEach(cleanup);

describe('PKG-11 / P16 ranking helpers', () => {
  it('a postal code gives its département (Corse is ambiguous, overseas has three digits); anything else gives no filter', () => {
    expect(departementOf('67000')).toBe('67'); expect(departementOf(' 68100 ')).toBe('68'); expect(departementOf('97400')).toBe('974');
    expect(departementOf('20000')).toBeUndefined(); expect(departementOf('67')).toBe('67'); expect(departementOf('2A')).toBe('2A');
    expect(departementOf('Strasbourg')).toBeUndefined(); expect(departementOf(undefined)).toBeUndefined();
  });
  it('kinds alternate, best of each first', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['d1'], ['s1', 's2']])).toEqual(['a1', 'd1', 's1', 'a2', 's2', 'a3']);
    expect(interleave([])).toEqual([]);
  });
  it('why shown: the structure\'s declared service, else the words of the need found, else a meaning-based match', () => {
    expect(whyShownOf({ title: 'Centre X', _services: ['Accompagnement logement'] }, ['logement'])).toBe('la structure indique proposer « Accompagnement logement »');
    expect(whyShownOf({ title: 'Aide au logement étudiant', excerpt: '' }, ['logement'])).toBe('correspond au mot « logement » de votre besoin');
    expect(whyShownOf({ title: 'Hébergement d\'urgence', excerpt: 'alimentaire' }, ['aide', 'urgente', 'hebergement', 'alimentaire'])).toBe('correspond aux mots « hebergement », « alimentaire » de votre besoin');
    expect(whyShownOf({ title: 'FSL', excerpt: 'impayés' }, ['logement'])).toBe('proche de votre besoin dans le catalogue (recherche par le sens)');
  });
  it('the handler never sends the need to an external embedding provider and links structures to their real page', () => {
    const src = fs.readFileSync('api/_handlers/assistant/recommendations.js', 'utf8');
    expect(src).toContain('generateCitizenLocalQueryEmbedding');
    expect(src).not.toMatch(/EmbeddingProvider|generateEmbedding\(/);
    expect(src).toContain('`/structures/${encodeURIComponent(String(slug))}`');
    expect(src).not.toMatch(/url: slug \? `\/annuaire\//);
  });
});

describe('PKG-11 / P16 panel', () => {
  const show = async (items) => {
    post.fn = vi.fn(async () => ({ items }));
    const { default: NeedRecommendations } = await import('../../src/components/assistant/NeedRecommendations.jsx');
    render(createElement(MemoryRouter, null, createElement(NeedRecommendations, { need: 'logement', label: 'logement', territory: '67000' })));
  };
  it('lists the leads with their kind, why they are shown and their source / verification date; never an eligibility statement', async () => {
    await show([
      { type: 'aide', slug: 'apl', title: 'Aide personnalisée au logement', url: '/aides/apl', whyShown: 'correspond au mot « logement » de votre besoin', sourceUrl: 'https://www.service-public.fr/x', verifiedAt: '2026-10-01T00:00:00Z' },
      { type: 'structure', slug: 'cx', title: 'Centre X', url: '/structures/cx', whyShown: 'la structure indique proposer « Accompagnement logement »' },
    ]);
    const leads = await screen.findAllByTestId('need-recommendation');
    expect(leads.map((l) => l.getAttribute('data-kind'))).toEqual(['aide', 'structure']);
    expect(leads[0]).toHaveTextContent('Aide'); expect(leads[0]).toHaveTextContent('Source : service-public.fr — vérifiée le 01/10/2026');
    expect(leads[0].querySelector('a')).toHaveAttribute('href', '/aides/apl');
    expect(leads[1]).toHaveTextContent('Pourquoi cette piste : la structure indique proposer « Accompagnement logement »');
    expect(post.fn).toHaveBeenCalledWith({ need: 'logement', territory: '67000', limit: 6 }, expect.anything());
    expect(screen.getByTestId('need-recommendations').textContent).not.toMatch(/éligible|vous avez droit|droit à l/i);
  });
  it('an empty answer and a failure are said plainly; the assessment is not affected', async () => {
    await show([]);
    expect(await screen.findByTestId('need-recommendations-empty')).toHaveTextContent('Aucune piste du catalogue vérifié ne correspond encore à ce besoin.');
    cleanup();
    post.fn = vi.fn(async () => { throw new Error('x'); });
    const { default: NeedRecommendations } = await import('../../src/components/assistant/NeedRecommendations.jsx');
    render(createElement(MemoryRouter, null, createElement(NeedRecommendations, { need: 'logement', label: 'logement' })));
    expect(await screen.findByTestId('need-recommendations-error')).toHaveTextContent('Le résultat ci-dessus reste valable.');
  });
  it('the wizard shows the panel beside the assessment (outside diagnostic-results) and no longer asks the model for an unsourced plan', () => {
    const w = fs.readFileSync('src/components/assistant/Wizard.jsx', 'utf8');
    expect(w.indexOf('<NeedRecommendations')).toBeGreaterThan(w.indexOf('</div>', w.indexOf('data-testid="diagnostic-results"')));
    expect(w).not.toMatch(/sendMessage|ResultPanel|Rédige un plan d'action/);
  });
});
