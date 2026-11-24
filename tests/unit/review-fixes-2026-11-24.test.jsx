// @vitest-environment jsdom
/**
 * 24/11/2026 — fixes from the first run of the ada-security-reviewer checklist on the design release:
 * the former panel « dark » contrast is migrated to the site theme ONCE (turning dark mode off is not undone at the next load); a malformed
 * address hash does not crash the public ADA Pro guide. No JSX in the body.
 */
/* global window, localStorage */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccessibilityPanel from '../../src/components/ui/AccessibilityPanel.jsx';
import { ThemeProvider } from '../../src/components/providers/ThemeProvider.tsx';
import ProGuide from '../../src/pages/pro/Guide.jsx';

beforeEach(() => { localStorage.clear(); window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('single dark mode: the old panel value is migrated once', () => {
  it('« contrast: dark » becomes the dark theme and is removed from the stored settings', async () => {
    localStorage.setItem('accessibilitySettings', JSON.stringify({ fontSize: 100, contrast: 'dark', lineHeight: 'normal', simplifiedMode: false }));
    await act(async () => { render(h(ThemeProvider, null, h(AccessibilityPanel))); });
    expect(JSON.parse(localStorage.getItem('accessibilitySettings')).contrast).toBe('normal');
    expect(localStorage.getItem('ada-theme')).toBe('dark');
    // the person turns dark mode off; the next page load must not switch it back on
    localStorage.setItem('ada-theme', 'light');
    cleanup();
    await act(async () => { render(h(ThemeProvider, null, h(AccessibilityPanel))); });
    expect(localStorage.getItem('ada-theme')).toBe('light');
  });
});

describe('public ADA Pro guide', () => {
  it('a malformed hash (#%E0) does not break the page', async () => {
    await act(async () => { render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/pro/guide-public#%E0'] }, h(ProGuide, { publicView: true })))); });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
