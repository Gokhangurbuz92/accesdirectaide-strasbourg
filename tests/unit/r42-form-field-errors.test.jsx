// @vitest-environment jsdom
/* global document, window */
/**
 * R42-POLISH (R41 review A5, RGAA 11.10 / 11.11) — field-level error semantics on the contact form (also used to report an error, « signalement »)
 * and the structure proposal form: on submit, every field in error gets aria-invalid and aria-describedby → its own message, an error summary
 * (role="alert") lists the errors as links and receives the focus; fixing a field removes its error; the messages are in the interface language.
 * jsdom: no layout. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Contact from '../../src/pages/Contact.jsx';
import SuggestStructure from '../../src/pages/SuggestStructure.jsx';
import { fieldA11y, looksLikeEmail, plainLabel, withoutError } from '../../src/lib/fieldErrors.js';
import { setLanguage } from '../../src/i18n/index.js';

beforeEach(() => { window.localStorage.clear(); window.HTMLElement.prototype.scrollIntoView = () => {}; window.HTMLElement.prototype.hasPointerCapture = () => false; });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const wrap = (el) => h(HelmetProvider, null, h(MemoryRouter, null, el));
const submit = (container) => act(async () => { fireEvent.submit(container.querySelector('form')); });
const describedText = (el) => (el.getAttribute('aria-describedby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ');

describe('helpers', () => {
  it('only a field in error is invalid; existing descriptions are kept', () => {
    expect(fieldA11y('email', {})).toEqual({});
    expect(fieldA11y('email', {}, 'hint')).toEqual({ 'aria-describedby': 'hint' });
    expect(fieldA11y('email', { email: 'x' }, 'hint')).toEqual({ 'aria-invalid': true, 'aria-describedby': 'hint email-error' });
    expect(withoutError({ a: '1', b: '2' }, 'a')).toEqual({ b: '2' });
    expect(plainLabel('Ville *')).toBe('Ville');
    expect(looksLikeEmail('nom@exemple.fr')).toBe(true);
    for (const v of ['', 'nom', 'nom@', 'nom@exemple', 'a b@c.fr']) expect(looksLikeEmail(v), v).toBe(false);
  });
});

describe('contact form', () => {
  it('empty submit: no request, three fields invalid with their own message, summary focused and announced', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(wrap(h(Contact)));
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
    await submit(container);
    expect(fetchSpy).not.toHaveBeenCalled();
    const summary = screen.getByTestId('contact-error-summary');
    expect(summary).toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(summary);
    expect(summary.querySelectorAll('a').length).toBe(3);
    for (const id of ['email', 'sujet', 'message']) {
      const field = document.getElementById(id);
      expect(field, id).toHaveAttribute('aria-invalid', 'true');
      expect(describedText(field)).toMatch(/obligatoire/);
    }
    expect(document.getElementById('nom')).not.toHaveAttribute('aria-invalid');
    // a link of the summary moves the focus to its field
    fireEvent.click(summary.querySelector('a[href="#message"]'));
    expect(document.activeElement).toBe(document.getElementById('message'));
  });

  it('typing fixes the field at once; a malformed e-mail gets its own message', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container } = render(wrap(h(Contact)));
    await submit(container);
    fireEvent.change(document.getElementById('message'), { target: { value: 'Bonjour' } });
    expect(document.getElementById('message')).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById('message-error')).toBeNull();
    fireEvent.change(document.getElementById('email'), { target: { value: 'nom@' } });
    await submit(container);
    expect(describedText(document.getElementById('email'))).toMatch(/adresse e-mail valide/);
  });

  it.each([['en', /required/], ['de', /erforderlich/], ['tr', /zorunludur/], ['ar', /إلزامي/], ['uk', /обов’язкове/]])('%s: the messages are in the interface language', async (code, re) => {
    vi.stubGlobal('fetch', vi.fn());
    await lang(code);
    const { container } = render(wrap(h(Contact)));
    await submit(container);
    expect(describedText(document.getElementById('email'))).toMatch(re);
    expect(screen.getByTestId('contact-error-summary').textContent).not.toMatch(/obligatoire|Corrigez/);
  });
});

describe('structure proposal form', () => {
  it('each step is checked before the next: the name, then the address, postcode and city, then the consent', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(wrap(h(SuggestStructure)));
    await submit(container);
    const summary = screen.getByTestId('suggest-error-summary');
    expect(document.activeElement).toBe(summary);
    expect(document.getElementById('name')).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(document.getElementById('name'))).toMatch(/Nom de la structure : ce champ est obligatoire/);
    fireEvent.change(document.getElementById('name'), { target: { value: 'CCAS synthétique' } });
    expect(screen.queryByTestId('suggest-error-summary')).toBeNull();
    await submit(container);   // → step 2
    await submit(container);
    for (const id of ['address', 'zipCode', 'city']) expect(document.getElementById(id), id).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(document.getElementById('email'), { target: { value: 'pas-une-adresse' } });
    await submit(container);
    expect(describedText(document.getElementById('email'))).toMatch(/adresse e-mail valide/);
    for (const [id, v] of [['address', '1 rue X'], ['zipCode', '67000'], ['city', 'Strasbourg'], ['email', 'contact@exemple.fr']]) fireEvent.change(document.getElementById(id), { target: { value: v } });
    await submit(container);   // → step 3
    await submit(container);
    expect(document.getElementById('consent')).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(document.getElementById('consent'))).toMatch(/Cochez la case/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
