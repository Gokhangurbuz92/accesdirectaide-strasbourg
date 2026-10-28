// @vitest-environment jsdom
/**
 * DTA S7 — /ressources?emergency=1 must never be an empty box: the five national numbers are shown from the API answer, and from a built-in list when the request fails
 * (network error, 429, 5xx) or returns nothing. The built-in list is pinned to the API's list. A failed non-emergency list is an error with a retry, not "Aucune ressource".
 */
/* global window, document */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Ressources from '../../src/pages/Ressources.jsx';
import { EMERGENCY_FALLBACK } from '../../src/lib/emergencyNumbers.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
const mount = (search) => { window.history.replaceState(null, '', `/ressources${search}`); return render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(Ressources)))); };
const NUMBERS = ['112', '15', '17', '18', '115'];

describe('emergency resources', () => {
  it('the built-in list equals the five numbers and titles served by the API handler', () => {
    const src = readFileSync('api/_handlers/ressources.js', 'utf8');
    const api = [...src.matchAll(/id: '(emergency-\d+)'.*?title: '([^']+)'.*?phone: '(\d+)'/g)].map((m) => ({ id: m[1], title: m[2], phone: m[3] }));
    expect(api).toHaveLength(5);
    expect(EMERGENCY_FALLBACK).toEqual(api);
  });
  it.each([
    ['network error', () => Promise.reject(new TypeError('offline'))],
    ['429', () => Promise.resolve({ ok: false, status: 429, json: async () => ({}) })],
    ['500', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ['empty answer', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) })],
  ])('%s: the five numbers are still shown as tel: links, with an honest note', async (_n, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    mount('?emergency=1');
    await waitFor(() => expect(screen.getByTestId('emergency-fallback-note')).toBeInTheDocument());
    for (const n of NUMBERS) expect(screen.getByTestId(`emergency-resource-${n}`)).toHaveAttribute('href', `tel:${n}`);
  });
  it('API answer is used as is, without the fallback note', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [{ id: 'a', slug: 'a', title: 'SAMU', phone: '15' }] }) })));
    mount('?emergency=1');
    await waitFor(() => expect(screen.getByTestId('emergency-resource-15')).toBeInTheDocument());
    expect(screen.queryByTestId('emergency-fallback-note')).toBeNull(); expect(screen.queryByTestId('emergency-resource-112')).toBeNull();
  });
  it('without ?emergency=1 no emergency box is shown; a failed list is an error with a retry that refetches (not "Aucune ressource")', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: 'r', slug: 'r', title: 'Guide test', type: 'guide' }] }) });
    vi.stubGlobal('fetch', f);
    mount('');
    await waitFor(() => expect(screen.getByTestId('ressources-error')).toBeInTheDocument());
    expect(screen.queryByTestId('emergency-resources')).toBeNull(); expect(document.body.textContent).not.toMatch(/Aucune ressource trouvée/);
    fireEvent.click(screen.getByTestId('ressources-retry'));
    await waitFor(() => expect(screen.getByText('Guide test')).toBeInTheDocument());
    expect(f).toHaveBeenCalledTimes(2);
  });
});
