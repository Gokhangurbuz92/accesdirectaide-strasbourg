// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026: the open « Boussole Sociale » widget (assistant surface open in Production) said what it can do and where the question goes,
 * never its limits. It now says, in every language, that it is automatic, can be wrong, decides nothing, and that an emergency is 112.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ChatAssistant from '../../src/components/chat/ChatAssistant.jsx';
import { setLanguage } from '../../src/i18n/index.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

beforeEach(() => { globalThis.HTMLElement.prototype.scrollIntoView = () => {}; });
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const show = () => render(h(HelmetProvider, null, h(MemoryRouter, null, h(ChatAssistant, { embedded: true }))));

describe('R3H the assistant states its limits', () => {
  it('French', () => {
    show();
    const limits = screen.getByTestId('chat-limits');
    expect(limits).toHaveTextContent('je peux me tromper');
    expect(limits).toHaveTextContent('seul l’organisme concerné décide de vos droits');
    expect(limits).toHaveTextContent('112');
    expect(claimsEntitlement(limits.textContent)).toBe(false);
  });
  it.each(['en', 'de', 'tr', 'ar', 'uk'])('%s: translated, with 112', async (code) => {
    await act(async () => { await setLanguage(code, { persist: false }); });
    show();
    const limits = screen.getByTestId('chat-limits');
    expect(limits).toHaveTextContent('112');
    expect(limits.textContent).not.toMatch(/je peux me tromper/);
  });
});
