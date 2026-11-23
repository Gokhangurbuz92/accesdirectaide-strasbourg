// @vitest-environment jsdom
/* global document, window */
/**
 * G14-CHAN (Part B) — what a screen reader SAYS, with @guidepup/virtual-screen-reader (a simulated reader over the accessibility tree in jsdom; it is
 * not NVDA, JAWS, VoiceOver or TalkBack and replaces no test with real users — none has been made). Three patterns of the product:
 *   - form errors: a refused submit announces the error summary (role="alert"), the field is announced invalid with its own message;
 *   - dialogs: opening announces a modal dialog with its name, the reader stays inside it, the close button has a French name;
 *   - live regions: a status message (role="status", polite) is announced when it changes, without moving the focus.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { virtual } from '@guidepup/virtual-screen-reader';
import { ErrorSummary, FieldError } from '../../src/components/forms/FieldErrors.jsx';
import { useFormErrors } from '../../src/components/forms/useFormErrors.js';
import { fieldA11y } from '../../src/lib/fieldErrors.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../src/components/ui/dialog.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const citizen = vi.hoisted(() => ({ citizenApi: { pushStatus: vi.fn(), setPreference: vi.fn(), pushSubscribe: vi.fn(), pushUnsubscribe: vi.fn() } }));
vi.mock('@/lib/citizenApi', () => citizen);

beforeEach(async () => {
  window.HTMLElement.prototype.scrollIntoView = () => {}; window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  await act(async () => { await setLanguage('fr', { persist: false }); });
});
afterEach(async () => { await virtual.stop(); cleanup(); vi.unstubAllGlobals(); });

/** every phrase spoken from the start, then until `until` returns true (at most `max` moves) */
async function readUntil(until, max = 40) {
  for (let i = 0; i < max; i += 1) { if (until(await virtual.lastSpokenPhrase())) return true; await virtual.next(); }
  return until(await virtual.lastSpokenPhrase());
}

function SignupForm() {
  const { errors, check, clear, summaryRef } = useFormErrors();
  const [email, setEmail] = useState('');
  const submit = (e) => { e.preventDefault(); check(email ? {} : { email: 'Adresse e-mail : ce champ est obligatoire.' }); };
  return h('form', { onSubmit: submit, noValidate: true, 'aria-label': 'Créer un compte' },
    h(ErrorSummary, { ref: summaryRef, errors, order: ['email'] }),
    h('label', { htmlFor: 'email' }, 'Adresse e-mail'),
    h('input', { id: 'email', type: 'email', value: email, onChange: (e) => { setEmail(e.target.value); clear('email'); }, ...fieldA11y('email', errors) }),
    h(FieldError, { field: 'email', errors }),
    h('button', { type: 'submit' }, 'Envoyer'));
}

describe('G14-CHAN virtual screen reader — form errors', () => {
  it('a refused submit: the summary is announced (alert) and focused; the field is invalid and described by its message', async () => {
    const { container } = render(h(SignupForm));
    await virtual.start({ container });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer' })); });
    await new Promise((r) => setTimeout(r, 0));
    const log = (await virtual.spokenPhraseLog()).join(' ⏎ ');
    // the summary (role="alert", named by its title) is announced as it receives the focus
    expect(log).toMatch(/alert, Le formulaire n’a pas été envoyé/);
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(await readUntil((p) => /textbox, Adresse e-mail/.test(p))).toBe(true);
    const field = await virtual.lastSpokenPhrase();
    expect(field).toMatch(/invalid/);
    expect(field).toMatch(/Adresse e-mail : ce champ est obligatoire/);
    // fixing the field removes the error (nothing invalid is announced any more)
    await act(async () => { fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@b.fr' } }); });
    expect(screen.getByLabelText('Adresse e-mail')).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('G14-CHAN virtual screen reader — dialogs', () => {
  it('opening announces a modal dialog with its name and description; the close button has a French name', async () => {
    render(h(Dialog, null, h(DialogTrigger, null, 'Ouvrir les réglages'),
      h(DialogContent, null, h(DialogTitle, null, 'Réglages d’affichage'), h(DialogDescription, null, 'Choisissez la taille du texte.'), h('button', { type: 'button' }, 'Appliquer'))));
    await virtual.start({ container: document.body });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages' })); });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Réglages d’affichage');
    expect(dialog).toHaveAccessibleDescription('Choisissez la taille du texte.');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await virtual.stop();
    await virtual.start({ container: dialog });
    expect(await readUntil((p) => /dialog/.test(p) && /Réglages d’affichage/.test(p), 3)).toBe(true);
    const spoken = [];
    for (let i = 0; i < 8; i += 1) { await virtual.next(); spoken.push(await virtual.lastSpokenPhrase()); }
    const all = spoken.join(' ⏎ ');
    expect(all).toMatch(/Choisissez la taille du texte/);
    expect(all).toMatch(/button, Appliquer/);
    expect(all).toMatch(/button, Fermer/);
  });
});

describe('G14-CHAN virtual screen reader — live regions', () => {
  it('a polite status (role="status") is announced when its text changes, and the focus does not move', async () => {
    function Saver() {
      const [msg, setMsg] = useState('');
      return h('div', null, h('button', { type: 'button', onClick: () => setMsg('Préférences enregistrées.') }, 'Enregistrer'), h('p', { role: 'status', 'aria-live': 'polite' }, msg));
    }
    const { container } = render(h(Saver));
    await virtual.start({ container });
    const button = screen.getByRole('button', { name: 'Enregistrer' }); button.focus();
    await act(async () => { fireEvent.click(button); });
    await new Promise((r) => setTimeout(r, 0));
    expect((await virtual.spokenPhraseLog()).join(' ⏎ ')).toMatch(/polite: Préférences enregistrées\./);
    expect(document.activeElement).toBe(button);
  });

  it('the device notifications card (DevicePush) announces its state politely — iPhone in Safari: the Home Screen guidance', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 });
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const { default: DevicePush } = await import('../../src/components/DevicePush.jsx');
    const { container } = render(h(DevicePush));
    await virtual.start({ container });
    const status = await screen.findByText(/écran d’accueil/);
    expect(status.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toMatch(/16\.4/);
    expect(citizen.citizenApi.pushStatus).not.toHaveBeenCalled();   // nothing asked of the server, no permission prompt without a gesture
  });
});
