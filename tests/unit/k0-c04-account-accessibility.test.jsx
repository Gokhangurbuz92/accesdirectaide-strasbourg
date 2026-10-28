// @vitest-environment jsdom
/**
 * K0 / C04 — accessibility preferences saved in the account are applied site-wide (not only shown in the profile form).
 */
/* global document, window, localStorage */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAccountAccessibility, ACCESSIBILITY_EVENT, TEXT_SCALE_PERCENT } from '../../src/lib/accountAccessibility.js';
import AccessibilityPanel from '../../src/components/ui/AccessibilityPanel.jsx';
import { FalcProvider, useFalc } from '../../src/contexts/FalcContext.jsx';

beforeEach(() => { localStorage.clear(); document.documentElement.className = ''; document.body.className = ''; document.documentElement.style.fontSize = ''; });
afterEach(cleanup);

describe('applyAccountAccessibility', () => {
  it('maps the account values onto the device settings the site already applies', () => {
    const out = applyAccountAccessibility({ falc: true, highContrast: true, textScale: 'xlarge' });
    expect(out.applied).toBe(true);
    expect(JSON.parse(localStorage.getItem('accessibilitySettings'))).toMatchObject({ fontSize: TEXT_SCALE_PERCENT.xlarge, contrast: 'high' });
    expect(localStorage.getItem('falc-mode')).toBe('true');
  });
  it('an unset or unknown value never resets a choice made on this device; empty prefs do nothing', () => {
    localStorage.setItem('accessibilitySettings', JSON.stringify({ fontSize: 120, contrast: 'dark', lineHeight: 'large', simplifiedMode: false }));
    let fired = 0; const on = () => { fired += 1; }; window.addEventListener(ACCESSIBILITY_EVENT, on);
    expect(applyAccountAccessibility({}).applied).toBe(false);
    expect(applyAccountAccessibility({ textScale: 'giant', junk: 1 }).applied).toBe(false);
    expect(applyAccountAccessibility(null).applied).toBe(false);
    expect(fired).toBe(0);
    applyAccountAccessibility({ highContrast: false });             // "no high contrast" keeps the device's dark mode
    expect(JSON.parse(localStorage.getItem('accessibilitySettings'))).toMatchObject({ fontSize: 120, contrast: 'dark', lineHeight: 'large' });
    window.removeEventListener(ACCESSIBILITY_EVENT, on);
  });
});

describe('the mounted site components follow the account at once', () => {
  it('AccessibilityPanel applies text size and high contrast to the whole document', async () => {
    render(createElement(AccessibilityPanel));
    await act(async () => { applyAccountAccessibility({ highContrast: true, textScale: 'large' }); });
    expect(document.documentElement.style.fontSize).toBe('115%');
    expect(document.body).toHaveClass('high-contrast');
    expect(screen.getAllByText('115%').length).toBeGreaterThan(0);
  });
  it('FalcProvider switches the site to FALC mode', async () => {
    const Probe = () => createElement('span', { 'data-testid': 'falc' }, String(useFalc().isFalcEnabled));
    render(createElement(FalcProvider, null, createElement(Probe)));
    expect(screen.getByTestId('falc')).toHaveTextContent('false');
    await act(async () => { applyAccountAccessibility({ falc: true }); });
    expect(screen.getByTestId('falc')).toHaveTextContent('true');
    expect(document.body).toHaveClass('falc-mode');
  });
});

describe('the settings screen choices survive a reload', () => {
  it('text size / contrast chosen in /compte/parametres go to the device settings the panel re-applies; reduce-motion is re-applied too', async () => {
    const { applyDeviceAccessibility } = await import('../../src/lib/accountAccessibility.js');
    applyDeviceAccessibility({ fontSize: 125, highContrast: true });
    localStorage.setItem('ada_citizen_prefs', JSON.stringify({ reduceMotion: true }));
    render(createElement(AccessibilityPanel));                   // a fresh page load
    await act(async () => {});
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(document.body).toHaveClass('high-contrast');
    expect(document.body).toHaveClass('reduce-motion');
  });
});
