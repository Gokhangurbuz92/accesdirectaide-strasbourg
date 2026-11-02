// @vitest-environment jsdom
/* global document */
/**
 * R36 — the header: account entry points only when accounts can be used; « Écouter la page » in the header's utility row with its controls under the header
 * (one shared reader); one accessibility panel mounted per breakpoint (two would keep two text sizes); the dark-mode icon is no longer squeezed to 0 px.
 * The visual checks (widths, six languages, RTL, 200 %) are in evidence/r36/header (Playwright on the LAB build).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { accountEntriesShown } from '../../src/lib/publicBeta.js';
import { ReadAloudPanel, ReadAloudToggle } from '../../src/components/a11y/ReadAloud.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('account entry points', () => {
  it('are shown outside the beta, hidden in the beta, shown again when the build opens the accounts surface', () => {
    expect(accountEntriesShown(false, [])).toBe(true);
    expect(accountEntriesShown(true, [])).toBe(false);
    expect(accountEntriesShown(true, ['appointments'])).toBe(false);
    expect(accountEntriesShown(true, ['accounts'])).toBe(true);
  });
});

describe('the reader in the header', () => {
  const reader = (calls) => ({ supported: true, state: { status: 'idle', section: 0, total: 3, heading: '', skipped: [], error: null }, voices: [], prefs: { rate: 1, voices: {}, highlight: true },
    rates: [1], play: () => calls.push('play'), pause: () => {}, resume: () => {}, stop: () => calls.push('stop'), next: () => {}, previous: () => {}, setPrefs: () => {} });
  function Header({ r }) {
    const [open, setOpen] = useState(false);
    return h('div', null, h('header', null, h(ReadAloudToggle, { reader: r, open, setOpen })), h('main', null, h(ReadAloudPanel, { reader: r, open })));
  }
  it('the toggle opens the controls under the header and closing stops the reading', () => {
    const calls = [];
    render(h(Header, { r: reader(calls) }));
    const toggle = screen.getByTestId('read-aloud-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('read-aloud-controls')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('main #read-aloud-controls')).not.toBeNull();
    fireEvent.click(screen.getByTestId('read-page'));
    fireEvent.click(toggle);
    expect(calls).toEqual(['play', 'stop']);
    expect(document.getElementById('read-aloud-controls')).toBeNull();
  });
  it('the compact phone toggle keeps an accessible name; nothing is rendered without speech synthesis', () => {
    const r = reader([]);
    const { container } = render(h(ReadAloudToggle, { reader: r, open: false, setOpen: () => {}, compact: true }));
    expect(container.querySelector('button').getAttribute('aria-label')).toBe('Écouter la page');
    const none = render(h(ReadAloudToggle, { reader: { ...r, supported: false }, open: false, setOpen: () => {} }));
    expect(none.container.innerHTML).toBe('');
  });
});

describe('layout', () => {
  const layout = read('src/pages/Layout.jsx');
  it('one reader and one accessibility panel per breakpoint; the reader no longer has a row of its own in <main>', () => {
    expect(layout.match(/useReadAloud\(\)/g)).toHaveLength(1);
    expect(layout).toMatch(/\{!phone && \(\s*<div className="hidden sm:block[^"]*" data-testid="header-utilities">/);
    expect(layout).toMatch(/\{phone && \(\s*<div className="flex items-center gap-1\.5" data-testid="header-utilities-phone">/);
    expect(layout.match(/<AccessibilityPanel \/>/g)).toHaveLength(2);
    expect(layout).toMatch(/<main id="main-content"[^>]*>\s*<ReadAloudPanel reader=\{reader\} open=\{readOpen\} \/>/);
    expect(layout).not.toMatch(/<ReadAloud \/>/);
  });
  it('the dark-mode icon keeps its size (the button padding used to squeeze it to 0 px)', () => {
    const t = read('src/components/ui/DarkModeToggle.jsx');
    expect(t).toMatch(/h-8 w-8 !px-0 !py-0/);
    expect(t).toMatch(/<Moon size=\{16\} className="shrink-0/);
  });
});
