// @vitest-environment jsdom
/**
 * P2b (owner decision 08/11/2026, D2 V2 option B) — the display preferences (FALC, high contrast, reduced motion, text size, read-aloud settings) live on
 * THIS DEVICE ONLY: written to local storage, applied at once to the whole site, re-applied after a reload, kept after sign-out, reset in one action, and
 * never sent to the server. (Replaces K0 / C04, where they were saved in the account.)
 */
/* global document, window, localStorage */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDisplayPreferences, readDisplayPreferences, resetDisplayPreferences, ACCESSIBILITY_EVENT, DEVICE_KEYS, TEXT_SCALE_PERCENT } from '../../src/lib/accountAccessibility.js';
import AccessibilityPanel from '../../src/components/ui/AccessibilityPanel.jsx';
import { FalcProvider, useFalc } from '../../src/contexts/FalcContext.jsx';
import DeviceDisplayPreferences from '../../src/components/account/DeviceDisplayPreferences.jsx';

let fetchSpy;
beforeEach(() => {
  localStorage.clear(); document.documentElement.className = ''; document.body.className = ''; document.documentElement.style.fontSize = '';
  fetchSpy = vi.fn(async () => { throw new Error('no network expected'); }); vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const Probe = () => createElement('span', { 'data-testid': 'falc' }, String(useFalc().isFalcEnabled));
/** a page load: the site-wide components mount and read the device storage */
const pageLoad = () => render(createElement(FalcProvider, null, createElement(AccessibilityPanel), createElement(Probe)));

describe('the device store', () => {
  it('writes every preference to local storage only — nothing is sent anywhere', () => {
    const out = applyDisplayPreferences({ falc: true, highContrast: true, textScale: 'xlarge', reduceMotion: true });
    expect(out.applied).toBe(true);
    expect(JSON.parse(localStorage.getItem(DEVICE_KEYS.settings))).toMatchObject({ fontSize: TEXT_SCALE_PERCENT.xlarge, contrast: 'high', reduceMotion: true });
    expect(localStorage.getItem(DEVICE_KEYS.falc)).toBe('true');
    expect(readDisplayPreferences()).toEqual({ falc: true, highContrast: true, fontSize: 130, textScale: 'xlarge', reduceMotion: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('only the values given change; unknown values are ignored; « no high contrast » keeps a dark theme chosen on the device', () => {
    localStorage.setItem(DEVICE_KEYS.settings, JSON.stringify({ fontSize: 120, contrast: 'dark', lineHeight: 'large', simplifiedMode: false }));
    let fired = 0; const on = () => { fired += 1; }; window.addEventListener(ACCESSIBILITY_EVENT, on);
    expect(applyDisplayPreferences({}).applied).toBe(false);
    expect(applyDisplayPreferences({ textScale: 'giant', junk: 1, fontSize: 999 }).applied).toBe(false);
    expect(applyDisplayPreferences(null).applied).toBe(false);
    expect(fired).toBe(0);
    applyDisplayPreferences({ highContrast: false });
    expect(JSON.parse(localStorage.getItem(DEVICE_KEYS.settings))).toMatchObject({ fontSize: 120, contrast: 'dark', lineHeight: 'large' });
    window.removeEventListener(ACCESSIBILITY_EVENT, on);
  });
  it('stores no health or disability information: only the five display values', () => {
    applyDisplayPreferences({ falc: true, highContrast: true, textScale: 'large', reduceMotion: true, disability: 'x', health: 'y' });
    const stored = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    expect(stored).not.toMatch(/disab|health|handicap|santé/i);
  });
});

describe('the whole site follows at once, and again after a reload', () => {
  it('a page load in an untouched browser writes NO display key (art. 82: written only after a choice of the person)', async () => {
    pageLoad();
    await act(async () => {});
    for (const k of [DEVICE_KEYS.settings, DEVICE_KEYS.falc, DEVICE_KEYS.reader]) expect(localStorage.getItem(k), k).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Augmenter la taille du texte' })[0]); });   // a choice in the header panel
    expect(JSON.parse(localStorage.getItem(DEVICE_KEYS.settings))).toMatchObject({ fontSize: 110 });
  });
  it('a change applies immediately (text size, contrast, reduced motion, FALC)', async () => {
    pageLoad();
    await act(async () => { applyDisplayPreferences({ highContrast: true, textScale: 'large', reduceMotion: true, falc: true }); });
    expect(document.documentElement.style.fontSize).toBe('115%');
    expect(document.body).toHaveClass('high-contrast');
    expect(document.body).toHaveClass('reduce-motion');
    expect(document.body).toHaveClass('falc-mode');
    expect(screen.getByTestId('falc')).toHaveTextContent('true');
  });
  it('a reload (fresh page) re-applies every preference from the device', async () => {
    applyDisplayPreferences({ highContrast: true, fontSize: 125, reduceMotion: true, falc: true });
    document.body.className = ''; document.documentElement.style.fontSize = '';
    pageLoad();
    await act(async () => {});
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(document.body).toHaveClass('high-contrast');
    expect(document.body).toHaveClass('reduce-motion');
    expect(document.body).toHaveClass('falc-mode');
  });
  it('the legacy « reduce motion » key of the old settings screen is still honoured', async () => {
    localStorage.setItem(DEVICE_KEYS.legacy, JSON.stringify({ reduceMotion: true }));
    pageLoad();
    await act(async () => {});
    expect(document.body).toHaveClass('reduce-motion');
    expect(readDisplayPreferences().reduceMotion).toBe(true);
  });
  it('signing out (which clears the account key « ada_citizen_prefs ») and in again leaves the device preferences in place', async () => {
    applyDisplayPreferences({ highContrast: true, textScale: 'xlarge', reduceMotion: true, falc: true });
    localStorage.removeItem('ada_citizen_prefs');   // what AuthHeaderActions does at sign-out
    pageLoad();                                     // the next page, signed out, then signed in: nothing is fetched from the account
    await act(async () => {});
    expect(readDisplayPreferences()).toEqual({ falc: true, highContrast: true, fontSize: 130, textScale: 'xlarge', reduceMotion: true });
    expect(document.body).toHaveClass('reduce-motion');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('reset', () => {
  it('puts every display preference of this device back (including read-aloud) and the site follows at once', async () => {
    applyDisplayPreferences({ highContrast: true, textScale: 'xlarge', reduceMotion: true, falc: true });
    localStorage.setItem(DEVICE_KEYS.reader, JSON.stringify({ rate: 1.5, voices: {}, highlight: false }));
    localStorage.setItem(DEVICE_KEYS.legacy, JSON.stringify({ reduceMotion: true, other: 1 }));
    pageLoad();
    await act(async () => { resetDisplayPreferences(); });
    expect([null, 'false']).toContain(localStorage.getItem(DEVICE_KEYS.falc));   // the mounted FALC provider writes its (default) value back
    expect(localStorage.getItem(DEVICE_KEYS.reader)).toBeNull();
    expect(JSON.parse(localStorage.getItem(DEVICE_KEYS.legacy))).toEqual({ other: 1 });
    expect(readDisplayPreferences()).toEqual({ falc: false, highContrast: false, fontSize: 100, textScale: 'normal', reduceMotion: false });
    expect(document.documentElement.style.fontSize).toBe('100%');
    expect(document.body).not.toHaveClass('high-contrast');
    expect(document.body).not.toHaveClass('reduce-motion');
    expect(document.body).not.toHaveClass('falc-mode');
    expect(screen.getByTestId('falc')).toHaveTextContent('false');
  });
});

describe('the account screens (DeviceDisplayPreferences)', () => {
  it('says the preferences stay on this device and do not synchronise; the controls change the device at once; reset is announced', async () => {
    pageLoad();
    render(createElement(DeviceDisplayPreferences));
    const note = screen.getByTestId('pf-display-note');
    expect(note).toHaveTextContent('uniquement dans ce navigateur');
    expect(note).toHaveTextContent('ne se synchronisent donc pas');
    expect(note).toHaveTextContent('après la déconnexion');
    await act(async () => { fireEvent.click(screen.getByTestId('pf-falc')); });
    await act(async () => { fireEvent.click(screen.getByTestId('pf-motion')); });
    await act(async () => { fireEvent.change(screen.getByTestId('pf-scale'), { target: { value: 'large' } }); });
    expect(readDisplayPreferences()).toMatchObject({ falc: true, reduceMotion: true, textScale: 'large' });
    expect(document.body).toHaveClass('falc-mode');
    expect(document.body).toHaveClass('reduce-motion');
    expect(screen.getByTestId('pf-falc')).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByTestId('pf-display-reset')); });
    expect(screen.getByTestId('pf-display-status')).toHaveTextContent('Affichage réinitialisé sur cet appareil.');
    expect(screen.getByTestId('pf-falc')).not.toBeChecked();
    expect(screen.getByTestId('pf-motion')).not.toBeChecked();
    expect(document.body).not.toHaveClass('falc-mode');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
