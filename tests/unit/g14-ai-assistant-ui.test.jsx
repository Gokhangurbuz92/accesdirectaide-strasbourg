// @vitest-environment jsdom
/**
 * G14-AI — the assistant widget states added for Cloudflare Workers AI: the daily limit said in the interface language, the emergency numbers as callable
 * links, the cited fiche link beside its official source, the privacy line naming the processor when the build says so, and the beta switch of the widget.
 * No JSX in the test body (the repo ESLint config does not parse JSX in tests/).
 */
/* global window */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ ensureCsrfHeaders: async () => ({ 'x-csrf-token': 't' }), csrfFetch: vi.fn() }));
vi.mock('@/components/assistant/FeedbackButtons', () => ({ default: () => null }));

import ChatAssistant from '../../src/components/chat/ChatAssistant.jsx';
import { assistantMessage, assistantUsesCloud, chatFailure } from '../../src/lib/chatOutcome.js';
import { assistantOpened, isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';

const t = (/** @type {string} */ _k, /** @type {string} */ d) => d;
/** @type {(body: any) => { status: number, body: any }} */ let answer;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const out = answer(JSON.parse(init.body));
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  }));
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.localStorage.clear(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

async function ask(/** @type {string} */ text) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')); });
}
const mount = () => render(createElement(MemoryRouter, null, createElement(ChatAssistant, { embedded: true })));

describe('pure helpers', () => {
  it('the daily limit is its own kind, before the generic server message', () => {
    expect(chatFailure(503, { error: 'daily_limit_reached', message: 'x' }, t)).toEqual({ text: "L'assistant a atteint sa limite du jour, réessayez demain.", kind: 'daily_limit' });
    expect(chatFailure(503, { error: 'service_unavailable', message: 'Le service assistant est temporairement indisponible.' }, t).kind).toBe('server');
  });
  it('a citation links the platform fiche first and keeps the https official source; emergencies are their own outcome', () => {
    const m = assistantMessage({ answer: 'x', citations: [{ title: 'Aide', ficheUrl: '/aides/aide-logement', sourceUrl: 'https://www.caf.fr/a', entityType: 'aide' }] });
    expect(m.links[0]).toMatchObject({ url: '/aides/aide-logement', sourceUrl: 'https://www.caf.fr/a' });
    expect(m.outcome).toBe('grounded');
    expect(assistantMessage({ answer: 'x', citations: [{ title: 'A', ficheUrl: 'https://evil.example/x', sourceUrl: 'https://www.caf.fr/a' }] }).links[0]).toMatchObject({ url: 'https://www.caf.fr/a', sourceUrl: null });
    const e = assistantMessage({ answer: 'Appelez', abstention: true, citations: [], emergencyNumbers: [{ number: '112', label: 'Urgence' }, { number: 'javascript:x', label: 'bad' }], meta: { reason: 'emergency_redirect' } });
    expect(e.outcome).toBe('emergency'); expect(e.emergencyNumbers).toEqual([{ number: '112', label: 'Urgence' }]);
  });
  it('the cloud privacy line follows VITE_ASSISTANT_PROVIDER exactly', () => {
    expect(assistantUsesCloud('workers_ai')).toBe(true);
    expect(assistantUsesCloud('')).toBe(false);
    expect(assistantUsesCloud('workers')).toBe(false);
  });
  it('the widget shows outside the beta, or in the beta only when the build opens « assistant »; diagnostic screens are unchanged', () => {
    expect(assistantOpened(false, [])).toBe(true);
    expect(assistantOpened(true, [])).toBe(false);
    expect(assistantOpened(true, ['diagnostic'])).toBe(false);
    expect(assistantOpened(true, ['assistant'])).toBe(true);
    expect(isBetaRestrictedPath('/diagnostic', ['assistant'])).toBe(true);
  });
  it('the four new keys exist in the five translated locales (French is the source text)', () => {
    for (const lang of ['en', 'de', 'ar', 'tr', 'uk']) {
      const d = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/shared.json`, 'utf8'));
      for (const k of ['chat.daily_limit', 'chat.outcome_emergency', 'chat.official_source', 'chat.privacy_cloud']) expect(d[k], `${lang} ${k}`).toBeTruthy();
      expect(d['chat.privacy_cloud']).toContain('<0>'); expect(d['chat.privacy_cloud']).toContain('Cloudflare');
    }
  });
});

describe('widget states', () => {
  it('daily limit: the French message, with retry, no answer invented', async () => {
    answer = () => ({ status: 503, body: { ok: false, error: 'daily_limit_reached', message: "L'assistant a atteint sa limite du jour, réessayez demain." } });
    mount();
    await ask('Comment payer mon loyer ?');
    expect(await screen.findByTestId('chat-error')).toHaveTextContent("L'assistant a atteint sa limite du jour, réessayez demain.");
    expect(screen.queryByTestId('chat-outcome')).toBeNull();
  });
  it('daily limit in English uses the translated key', async () => {
    await act(async () => { await setLanguage('en', { persist: false }); });
    answer = () => ({ status: 503, body: { ok: false, error: 'daily_limit_reached', message: 'fr' } });
    mount();
    await ask('loyer');
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('The assistant has reached its limit for today');
  });
  it('emergency: the numbers are tel: links and the outcome says it', async () => {
    answer = () => ({ status: 200, body: { answer: 'Appelez le 112.', abstention: true, citations: [], emergencyNumbers: [{ number: '112', label: 'Urgence' }, { number: '3114', label: 'Prévention du suicide' }], meta: { reason: 'emergency_redirect' } } });
    mount();
    await ask('Je veux mourir');
    expect(await screen.findByTestId('chat-emergency-numbers')).toBeInTheDocument();
    expect(screen.getByTestId('chat-outcome')).toHaveAttribute('data-outcome', 'emergency');
    const links = screen.getByTestId('chat-emergency-numbers').querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['tel:112', 'tel:3114']);
  });
  it('grounded answer: the fiche link and its official source are both offered', async () => {
    answer = () => ({ status: 200, body: { answer: 'Selon la fiche…', grounded: true, abstention: false, citations: [{ title: 'Aide au logement', entityType: 'aide', ficheUrl: '/aides/aide-logement', sourceUrl: 'https://www.caf.fr/a' }], meta: { provider: 'workers_ai' } } });
    mount();
    await ask('loyer');
    const spans = await screen.findAllByText('Aide au logement', { selector: 'span' });
    expect(spans.map((s) => s.closest('a').getAttribute('href'))).toEqual(['/aides/aide-logement', 'https://www.caf.fr/a']);
    expect(screen.getByTestId('chat-official-source')).toHaveAttribute('href', 'https://www.caf.fr/a');
  });
  it('privacy line: names Cloudflare when the build selects Workers AI, the local text otherwise', () => {
    vi.stubEnv('VITE_ASSISTANT_PROVIDER', 'workers_ai');
    const { unmount } = mount();
    expect(screen.getByText(/Cloudflare/)).toBeInTheDocument();
    unmount();
    vi.stubEnv('VITE_ASSISTANT_PROVIDER', '');
    mount();
    expect(screen.queryByText(/Cloudflare/)).toBeNull();
    expect(screen.getByText(/assistant local/)).toBeInTheDocument();
  });
});
