// @vitest-environment jsdom
// R3 (QA v79, DTA-B69): one lost download of a page's code no longer shows the application's error screen — the import is tried again first.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense, Component, createElement as h } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import lazyWithRetry, { importWithRetry, CHUNK_LOAD_ERROR } from '@/lib/lazyWithRetry';

const lost = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:5173/assets/AdminLayout-BUvGv8aj.js');
const noWait = () => Promise.resolve();

class Catch extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? h('p', null, 'error screen') : this.props.children; }
}

describe('importWithRetry', () => {
  it('tries a lost download again and resolves with the module', async () => {
    const mod = { default: () => null };
    const factory = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(mod);
    await expect(importWithRetry(factory, { wait: noWait })()).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('gives up after the allowed retries with the browser error', async () => {
    const factory = vi.fn().mockRejectedValue(lost());
    await expect(importWithRetry(factory, { retries: 2, wait: noWait })()).rejects.toThrow(/dynamically imported module/);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('never retries a module that throws while it is evaluated', async () => {
    const factory = vi.fn().mockRejectedValue(new ReferenceError('x is not defined'));
    await expect(importWithRetry(factory, { wait: noWait })()).rejects.toThrow('x is not defined');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('knows the download errors of Chrome, Firefox, Safari and Vite', () => {
    for (const m of ['Failed to fetch dynamically imported module: /assets/a.js', 'error loading dynamically imported module', 'Importing a module script failed.', 'Unable to preload CSS for /assets/a.css']) expect(CHUNK_LOAD_ERROR.test(m)).toBe(true);
    expect(CHUNK_LOAD_ERROR.test('Cannot read properties of undefined')).toBe(false);
  });
});

describe('lazyWithRetry', () => {
  it('renders the page, not the error screen, when its first download was lost', async () => {
    let calls = 0;
    const Page = lazyWithRetry(() => { calls += 1; return calls === 1 ? Promise.reject(lost()) : Promise.resolve({ default: () => h('h1', null, 'Fiche introuvable') }); });
    render(h(Catch, null, h(Suspense, { fallback: h('p', null, 'loading') }, h(Page))));
    expect(await screen.findByRole('heading', { name: 'Fiche introuvable' }, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('error screen')).toBeNull();
    expect(calls).toBe(2);
  });
});

describe('the router and the application shell use it', () => {
  const read = (f) => fs.readFileSync(path.resolve(f), 'utf8');
  it('src/pages/index.jsx: every lazy page goes through lazyWithRetry, never React.lazy', () => {
    const src = read('src/pages/index.jsx');
    expect(src).toMatch(/^import lazy from "@\/lib\/lazyWithRetry";/m);
    expect(src).not.toMatch(/import \{[^}]*\blazy\b[^}]*\} from ["']react["']/);
    expect((src.match(/= lazy\(\(\) => import\(/g) || []).length).toBeGreaterThan(100);
  });
  it('src/App.jsx: the cookie banner shown on every page goes through lazyWithRetry', () => {
    expect(read('src/App.jsx')).toMatch(/const CookieBanner = lazyWithRetry\(\(\) => import\('@\/components\/CookieBanner'\)\)/);
  });
});
