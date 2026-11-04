// @vitest-environment jsdom
/* global document, window */
/**
 * R42-POLISH (R41 i18n audit, header overflow) — for a signed-in administrator the public header used to put six administration entries in the same
 * single row as the public menu (~1,060 px in English): from 1280 px to ~1,600 px the page scrolled sideways (LTR) or the row overflowed towards the
 * unreachable side (RTL). Regression guard (jsdom, no layout — the widths are checked in Chrome by scripts/acceptance/r33-a11y.mjs « header-fits-* »):
 *   - the desktop menu has the same 6 public entries + ONE « Administration » disclosure entry; every administration page is still a link in it;
 *   - keyboard order = DOM order: public entries first, then Administration, then its six pages; the phone menu offers the same group;
 *   - the header row may wrap (min height, flex-wrap), nothing is clipped (no overflow-hidden on the header row or the menu).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const user = { current: null };
vi.mock('@/api/client', () => ({ adminClient: { auth: { getUser: async () => user.current } } }));
vi.mock('@/components/ui/AccessibilityPanel', () => ({ default: () => null }));
vi.mock('@/components/ui/HideScreenButton', () => ({ default: () => null }));
vi.mock('@/components/chat/ChatAssistant', () => ({ default: () => null }));

beforeEach(() => {
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); user.current = null; });

const mount = async () => {
  const { default: Layout } = await import('../../src/pages/Layout.jsx');
  let out;
  await act(async () => { out = render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/contact'] }, h(Layout, null, h('p', null, 'page')))))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return out;
};

describe('desktop menu', () => {
  it('a visitor sees the six public entries and no administration entry', async () => {
    await mount();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(nav.querySelectorAll(':scope > div').length).toBe(6);
    expect(within(nav).queryByText('Administration')).toBeNull();
  });

  it('an administrator gets ONE more entry, « Administration », whose submenu holds every administration page, after the public entries', async () => {
    user.current = { role: 'admin' };
    await mount();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    const entries = [...nav.querySelectorAll(':scope > div')];
    expect(entries.length).toBe(7);
    const group = entries[6];
    expect(group.querySelector(':scope > a')).toHaveTextContent('Administration');
    const menu = within(group).getByRole('menu', { hidden: true });
    const links = [...menu.querySelectorAll('a[role="menuitem"]')].map((a) => a.getAttribute('href'));
    expect(links.length).toBe(6);
    // the order of the tab stops is the DOM order: public links, then the group, then its pages
    const tabOrder = [...nav.querySelectorAll('a')].map((a) => a.textContent.trim());
    expect(tabOrder.indexOf('Administration')).toBeGreaterThan(tabOrder.indexOf('Actualités'));
    expect(links.every((href) => href && href.startsWith('/'))).toBe(true);
  });

  it('the phone menu offers the same group as a disclosure button', async () => {
    user.current = { role: 'admin' };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const mobile = screen.getByRole('navigation', { name: 'Navigation mobile' });
    const toggle = within(mobile).getByRole('button', { name: /Administration/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')).querySelectorAll('a').length).toBe(6);
  });
});

describe('the header row', () => {
  const layout = fs.readFileSync('src/pages/Layout.jsx', 'utf8');
  it('may wrap instead of overflowing, and clips nothing', () => {
    expect(layout).toMatch(/<div className="flex flex-wrap items-center justify-between min-h-16 gap-x-4 gap-y-1">/);
    expect(layout).toMatch(/<nav className="hidden xl:flex flex-wrap min-w-0 items-center gap-1"/);
    expect(layout).not.toMatch(/<header[^>]*overflow-(hidden|x-hidden|clip)/);
    expect(layout).not.toMatch(/adminOnly: true/);
  });
});
