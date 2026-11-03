// @vitest-environment jsdom
/* global document, window, Node, NodeFilter */
/**
 * R40 — the orientation wizard (components/assistant/*), the assistant panel (chat/ChatAssistant) and the structure proposal form (pages/SuggestStructure)
 * in the interface language: French is the former text; in Arabic and English no French sentence is left outside a lang="fr" fragment (the assistant
 * works in French: its example questions, answers and sources stay French and are marked so). jsdom: no layout. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Wizard from '../../src/components/assistant/Wizard.jsx';
import ChatAssistant from '../../src/components/chat/ChatAssistant.jsx';
import SuggestStructure from '../../src/pages/SuggestStructure.jsx';
import { setLanguage } from '../../src/i18n/index.js';

beforeEach(() => { window.localStorage.clear(); window.HTMLElement.prototype.scrollIntoView = () => {}; });
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const wrap = (el) => h(HelmetProvider, null, h(MemoryRouter, null, el));
const outsideFrench = (root) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let out = ''; let n;
  while ((n = w.nextNode())) { if (n.nodeType === Node.TEXT_NODE && !n.parentElement.closest('[lang="fr"]')) out += ` ${n.textContent}`; }
  const attrs = [...root.querySelectorAll('[aria-label],[placeholder],[title]')].filter((e) => !e.closest('[lang="fr"]'))
    .map((e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('title')].filter(Boolean).join(' '));
  return `${out} ${attrs.join(' ')}`;
};
const FRENCH_WORDS = /\b(vous|votre|vos|les|une|pour|avec|aucune|retour|continuer|étape|réessayer|recommencer|logement|situation familiale)\b/i;
const steps = (container) => {
  const click = (name) => fireEvent.click(screen.getByRole(name.role || 'button', { name: name.name }));
  return { click, text: () => outsideFrench(container) };
};

describe('French: the former wizard text', () => {
  it('step 1 and the progress keep their French wording', () => {
    render(wrap(h(Wizard)));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quel est votre besoin principal ?');
    expect(document.body.textContent).toContain('Étape 1 sur 5');
    expect(screen.getByRole('button', { name: 'Travail / Emploi' })).toBeInTheDocument();
  });
});

describe.each([
  ['ar', 'ما حاجتك الأساسية؟', 'السكن', 'أين تسكن؟'],
  ['en', 'What is your main need?', 'Housing', 'Where do you live?'],
])('%s', (code, title, housing, where) => {
  it('every wizard step is translated (no French outside lang="fr"); axe clean on the last step', async () => {
    await lang(code);
    const { container } = render(wrap(h(Wizard)));
    const s = steps(container);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(title);
    expect(s.text()).not.toMatch(FRENCH_WORDS);
    s.click({ name: housing });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(where);
    expect(s.text()).not.toMatch(FRENCH_WORDS);
    fireEvent.submit(container.querySelector('form'));
    expect(s.text()).not.toMatch(FRENCH_WORDS);                       // step 3: family situation / status
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); fireEvent.click(radios[3]);
    fireEvent.click(screen.getAllByRole('button').at(-1));
    expect(s.text()).not.toMatch(FRENCH_WORDS);                       // step 4: urgency
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getAllByRole('button').at(-1));
    expect(container.querySelector('#diag-birthdate')).not.toBeNull(); // step 5: the calculation form
    expect(s.text()).not.toMatch(FRENCH_WORDS);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
  it('the assistant panel frame is translated, says it answers in French, and keeps its French example questions in lang="fr"', async () => {
    await lang(code);
    const { container } = render(wrap(h(ChatAssistant, { embedded: true })));
    expect(screen.getByTestId('chat-french-only')).toBeInTheDocument();
    expect(outsideFrench(container)).not.toMatch(FRENCH_WORDS);
    expect([...container.querySelectorAll('[lang="fr"]')].some((e) => /loyer/.test(e.textContent))).toBe(true);
  });
  it('the structure proposal form is translated', async () => {
    await lang(code);
    const { container } = render(wrap(h(SuggestStructure)));
    expect(outsideFrench(container)).not.toMatch(FRENCH_WORDS);
  });
});
