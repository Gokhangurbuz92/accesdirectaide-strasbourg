// @vitest-environment jsdom
/* global document */
/**
 * R34 — a search that describes danger shows the official emergency numbers first (« mon mari me frappe » used to return five town halls and nothing
 * else). The signal is narrow: a law, a statistic or « coup de pouce » is not an emergency.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createElement as h } from 'react';
import { safetySignal } from '../../api/lib/search-safety.js';
import SafetyNotice from '../../src/components/search/SafetyNotice.jsx';

describe('safetySignal', () => {
  it.each([
    ['mon mari me frappe', 'violence', '3919'], ['il me donne des coups', 'violence', '17'], ['my husband hits me', 'violence', '3919'],
    ['kocam beni dövüyor', 'violence', '3919'], ['чоловік б\'є мене', 'violence', '3919'], ['زوجي يضربني', 'violence', '3919'], ['mein Mann schlägt mich', 'violence', '17'],
    ['mon fils est maltraité', 'enfant', '119'], ['ma grand-mère est maltraitée', 'personne-agee', '3133'],
    ['je veux en finir', 'suicide', '3114'], ['I want to kill myself', 'suicide', '3114'], ['je dors dehors ce soir', 'sans-abri', '115'],
  ])('« %s » → %s with %s', (q, kind, number) => {
    const s = safetySignal(q);
    expect(s?.kind).toBe(kind);
    expect(s?.numbers).toContain(number);
  });
  it.each(['curatelle', 'coup de pouce vélo', 'loi sur les violences conjugales', 'le viol est puni article 222-23', 'frais de garde', 'carte d\'identité', 'aide au loyer'])(
    '« %s » is not an emergency', (q) => expect(safetySignal(q)).toBeNull());
  it('the French translation of a foreign query is read too', () => {
    expect(safetySignal('xyz', 'violences conjugales')?.kind).toBe('violence');
  });
  it('violence asks for the offices that receive victims', () => {
    expect(safetySignal('mon mari me frappe').structureTypes).toEqual(["Bureau d'aide aux victimes", 'CIDFF (droits des femmes et des familles)']);
  });
});

describe('SafetyNotice', () => {
  it('shows each official number as a phone link, in French with its lang', () => {
    render(h(SafetyNotice, { safety: { kind: 'violence', numbers: ['17', '3919'] } }));
    const links = [...document.querySelectorAll('[data-testid="search-safety"] a[href^="tel:"]')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['tel:17', 'tel:3919']);
    expect(document.querySelector('[data-testid="search-safety"] span[lang="fr"]')?.textContent).toBe('Police / gendarmerie');
  });
  it('shows nothing without a signal, and never a number missing from the reference file', () => {
    const { container } = render(h(SafetyNotice, { safety: { kind: 'x', numbers: ['0899999999'] } }));
    expect(container.innerHTML).toBe('');
    expect(render(h(SafetyNotice, { safety: null })).container.innerHTML).toBe('');
  });
});
