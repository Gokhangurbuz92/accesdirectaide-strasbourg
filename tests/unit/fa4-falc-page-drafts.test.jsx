// @vitest-environment jsdom
/* global localStorage */
// FA-D4 — simplified French drafts of the key citizen pages (src/content/falc/citizenPages.fr.js): every draft is marked
// « simplified-draft-awaiting-participatory-validation » (never « FALC validé »: the first Unapei rule — participation of people with an intellectual
// disability — has not been applied yet), follows the measurable Unapei rules (short sentences, one sentence per line), never states an entitlement,
// and is shown only when « Facile à lire » is on, in French, with its provisional label.
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FALC_PAGE_DRAFTS, FALC_DRAFT_STATUS, FALC_RULES_SOURCE } from '../../src/content/falc/citizenPages.fr.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import FalcPageDraft from '../../src/components/FalcPageDraft.jsx';
import { FalcProvider } from '../../src/contexts/FalcContext.jsx';

afterEach(() => { cleanup(); try { localStorage.removeItem('falc-mode'); } catch { /* */ } });
const drafts = Object.values(FALC_PAGE_DRAFTS);
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;

describe('FA-D4 FALC drafts — content contract', () => {
  it('covers home, orientation result, rights-record template, account / data rights, error and empty states', () => {
    expect(Object.keys(FALC_PAGE_DRAFTS).sort()).toEqual(['accountData', 'emptyResults', 'home', 'notFound', 'orientationResult', 'rightDetail', 'serviceError']);
  });
  it('every draft awaits participatory validation; the rules source and its read date are recorded', () => {
    expect(FALC_DRAFT_STATUS).toBe('simplified-draft-awaiting-participatory-validation');
    for (const d of drafts) expect(d.status, d.id).toBe(FALC_DRAFT_STATUS);
    expect(FALC_RULES_SOURCE).toEqual({ url: 'https://falc.unapei.org/quest-ce-que-le-falc/les-regles-du-falc/', publisher: 'Unapei', readOn: '2026-11-18' });
  });
  it('short sentences (≤ 13 words), one sentence per line, short headings', () => {
    const long = []; const several = [];
    for (const d of drafts) for (const b of d.blocks) {
      if (words(b.heading) > 8) long.push(`${d.id} heading: ${b.heading}`);
      for (const l of b.lines) {
        if (words(l) > 13) long.push(`${d.id}: ${l}`);
        if (/[.!?]\s+\S/.test(l.replace(/«[^»]*»/g, ''))) several.push(`${d.id}: ${l}`);
      }
    }
    expect(long).toEqual([]); expect(several).toEqual([]);
  });
  it('never states an entitlement, never claims a validated FALC', () => {
    const all = drafts.flatMap((d) => [d.title, ...d.blocks.flatMap((b) => [b.heading, ...b.lines])]);
    expect(all.filter((s) => claimsEntitlement(s))).toEqual([]);
    expect(all.filter((s) => /FALC|valid[ée]/i.test(s))).toEqual([]);
    // the label the reader sees (French default) says provisional and not yet proofread
    expect(fs.readFileSync('src/components/FalcPageDraft.jsx', 'utf8')).toMatch(/'Texte simplifié provisoire : pas encore relu par des personnes en situation de handicap intellectuel'/);
  });
});

describe('FA-D4 FALC drafts — display', () => {
  it('hidden while « Facile à lire » is off', () => {
    render(h(FalcProvider, null, h(FalcPageDraft, { id: 'home' })));
    expect(screen.queryByTestId('falc-page-draft')).toBeNull();
  });
  it('shown when it is on: provisional label, status, French text, no axe violation', async () => {
    localStorage.setItem('falc-mode', 'true');
    const { container } = render(h('main', null, h('h1', null, 'Accueil'), h(FalcProvider, null, h(FalcPageDraft, { id: 'accountData' }))));
    const box = screen.getByTestId('falc-page-draft');
    expect(box).toHaveAttribute('data-falc-status', 'simplified-draft-awaiting-participatory-validation');
    expect(screen.getByTestId('falc-draft-label')).toHaveTextContent('Texte simplifié provisoire');
    expect(box.querySelector('[lang="fr"]')).toHaveTextContent('Exporter mes données');
    const r = await axe.run(container, { runOnly: ['wcag2a', 'wcag2aa'], rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
