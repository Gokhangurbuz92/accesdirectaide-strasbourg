// @vitest-environment jsdom
/**
 * R46 / P17 — public UI states of the grounded assistant (the model side is the diagnostic worker's): grounded vs abstention said, 429 and « not open »
 * said by their kind, and a postal code the server cannot use turned into the official La Poste communes — the person picks one, never the first.
 * No JSX in the test body (the repo ESLint config does not parse JSX in tests/).
 */
/* global window, document */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ ensureCsrfHeaders: async () => ({ 'x-csrf-token': 't' }), csrfFetch: vi.fn() }));
vi.mock('@/components/assistant/FeedbackButtons', () => ({ default: () => null }));

import ChatAssistant from '../../src/components/chat/ChatAssistant.jsx';
import { assistantMessage, chatFailure } from '../../src/lib/chatOutcome.js';

const t = (/** @type {string} */ _k, /** @type {string} */ d) => d;
/** @type {any[]} */ let chats;
/** @type {(body: any) => { status: number, body: any }} */ let answer;

beforeEach(() => {
  chats = [];
  vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (String(url).startsWith('/api/territory/postal')) {
      return { ok: true, status: 200, json: async () => ({ status: 'MULTIPLE', postalCode: '67800', candidates: [{ code: '67043', nom: 'Bischheim', inServiceTerritory: true }, { code: '67204', nom: 'Hœnheim', inServiceTerritory: true }] }) };
    }
    const body = JSON.parse(init.body); chats.push(body);
    const out = answer(body);
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  }));
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

async function ask(/** @type {string} */ text) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')); });
}
const mount = () => render(createElement(MemoryRouter, null, createElement(ChatAssistant, { embedded: true })));

describe('R46 P17 pure helpers', () => {
  it('chatFailure says the kind of refusal', () => {
    expect(chatFailure(429, {}, t).kind).toBe('rate_limited');
    expect(chatFailure(503, { error: 'PUBLIC_BETA_RESTRICTED', message: 'Bêta publique…' }, t)).toMatchObject({ kind: 'closed' });
    expect(chatFailure(503, { error: 'CAPABILITY_NOT_OPEN' }, t).kind).toBe('closed');
    expect(chatFailure(503, { message: 'Le service assistant local est temporairement indisponible.' }, t)).toMatchObject({ kind: 'server', fr: true });
    expect(chatFailure(500, null, t).kind).toBe('error');
  });

  it('assistantMessage marks grounded only with citations, abstention whenever the server abstains', () => {
    expect(assistantMessage({ answer: 'x', citations: [{ sourceUrl: 'https://www.service-public.fr/x', title: 'Fiche' }] }).outcome).toBe('grounded');
    expect(assistantMessage({ answer: 'x', citations: [], abstention: true }).outcome).toBe('abstention');
    expect(assistantMessage({ answer: 'x', citations: [{ title: 'sans lien' }] }).outcome).toBe('ungrounded');
    expect(assistantMessage({ answer: 'x', abstention: true, citations: [{ sourceUrl: 'https://a.example' }] }).outcome).toBe('abstention');
  });
});

describe('R46 P17 in the widget', () => {
  it('a postal code: the official communes are offered, the chosen name is sent as the territory with the pending question', async () => {
    answer = (b) => (b.context?.territory === 'Hœnheim'
      ? { status: 200, body: { answer: 'Selon la fiche…', citations: [{ sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006', title: 'Aides au logement' }], grounded: true, meta: { territoryId: 'commune:67204', territoryLabel: 'Hœnheim' } } }
      : b.context?.territory === '67800'
        ? { status: 200, body: { answer: 'Je ne peux pas encore utiliser un code postal : plusieurs communes peuvent le partager. Indiquez le nom de votre commune.', citations: [], abstention: true, meta: { reason: 'territory_postal_code' } } }
        : { status: 200, body: { answer: 'Pour vous orienter localement, indiquez votre commune.', citations: [], abstention: true, meta: { reason: 'territory_required' } } });
    mount();
    await ask('Quelles aides pour payer mon loyer ?');
    await waitFor(() => expect(screen.getAllByTestId('chat-outcome')[0]).toHaveAttribute('data-outcome', 'abstention'));
    await ask('67800');
    const choices = await screen.findByTestId('chat-postal-choices');
    expect(choices).toHaveTextContent('Communes du code postal 67800');
    const buttons = choices.querySelectorAll('button');
    expect([...buttons].map((b) => b.getAttribute('data-commune'))).toEqual(['67043', '67204']);
    await act(async () => { fireEvent.click(buttons[1]); });
    await waitFor(() => expect(chats).toHaveLength(3));
    expect(chats[2]).toMatchObject({ message: 'Quelles aides pour payer mon loyer ?', context: { territory: 'Hœnheim' } });
    await waitFor(() => expect(screen.getAllByTestId('chat-outcome').at(-1)).toHaveAttribute('data-outcome', 'grounded'));
    expect(document.body.textContent).not.toMatch(/vous avez droit|vous êtes éligible/i);
  });

  it('429 and the beta refusal are said by their kind, with a way forward', async () => {
    answer = () => ({ status: 429, body: { error: 'Rate limited' } });
    mount();
    await ask('Bonjour');
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('Trop de questions en peu de temps');
    cleanup();
    answer = () => ({ status: 503, body: { error: 'PUBLIC_BETA_RESTRICTED', message: 'Bêta publique : cette fonction n’est pas encore ouverte.' } });
    mount();
    await ask('Bonjour');
    expect(await screen.findByTestId('chat-error')).toHaveTextContent("La Boussole Sociale n'est pas encore ouverte");
    expect(screen.getByTestId('chat-closed-search')).toHaveAttribute('href', '/recherche');
  });

  it('a non-JSON failure is an error, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } })));
    mount();
    await ask('Bonjour');
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('Une erreur est survenue.');
  });
});
