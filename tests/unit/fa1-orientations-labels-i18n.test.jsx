// @vitest-environment jsdom
/**
 * FA-D1 (D-FA1-1) — « Mes orientations » in the person's interface language: the status, the motive and the result of a referral are controlled codes
 * translated by the six-language contract (pro:case_labels.*, the same keys the professional pages and the shared-dossier transparency use). Before the fix the
 * citizen page read the French-only maps of src/lib/caseLabels.js: an Arabic, English, Turkish, German or Ukrainian page said « Déclinée », « Logement »,
 * « Annulée », « La personne n’a pas poursuivi » — French words, unmarked, in a right-to-left page for Arabic. French screens are unchanged.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ referrals: vi.fn(), decideReferral: vi.fn(), dossierReferent: vi.fn(), decideReferent: vi.fn(), endReferent: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/components/SEO', () => ({ default: () => null }));

import CompteOrientations from '../../src/pages/CompteOrientations.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const base = { dossierId: 'd1', from: 'Org synthétique X', message: '', respondedAt: '2026-11-01T10:00:00Z', closedAt: null, previousId: null, nextId: null, needsFollowUp: false };
const DECLINED = { ...base, id: 'a', to: 'Org synthétique Y', status: 'DECLINED', reasonCode: 'HOUSING', responseCode: 'REDIRECT_SUGGESTED', suggested: 'Org synthétique Z', nextAction: null };
const WITHDRAWN = { ...base, id: 'b', to: 'Org synthétique Z', status: 'CANCELLED', reasonCode: 'HOUSING', responseCode: null, suggested: null, outcome: 'CITIZEN_WITHDREW', closedAt: '2026-11-02T10:00:00Z', nextAction: null, previousId: 'a' };
const PENDING = { ...base, id: 'c', to: 'Org synthétique W', status: 'PENDING_CITIZEN', reasonCode: 'HOUSING', responseCode: null, suggested: null, nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' } };
const FRENCH = ['Déclinée', 'Annulée', 'Logement', 'La personne n’a pas poursuivi'];

beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.dossierReferent.mockResolvedValue({ available: true, referent: null, proposal: null }); api.referrals.mockResolvedValue({ referrals: [PENDING, DECLINED, WITHDRAWN] }); });
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

async function renderIn(lang) {
  await act(async () => { await setLanguage(lang, { persist: false }); });
  render(h(MemoryRouter, null, h(CompteOrientations)));
  await waitFor(() => expect(screen.getAllByTestId('orientation-item')).toHaveLength(2));
  return screen.getByTestId('compte-orientations');
}

describe('FA-D1 — Mes orientations: the referral codes in the interface language', () => {
  it('French stays the canonical text', async () => {
    const page = await renderIn('fr');
    for (const w of FRENCH) expect(page).toHaveTextContent(w);
  });

  it.each([
    ['en', ['Declined', 'Cancelled', 'Housing', 'The person did not continue']],
    ['ar', ['مرفوض', 'السكن', 'لم يواصل الشخص']],
    ['tr', ['Reddedildi', 'Konut', 'Kişi devam etmedi']],
    ['de', ['Abgelehnt', 'Wohnen', 'Die Person hat nicht weitergemacht']],
    ['uk', ['Відхилено', 'Житло', 'Людина не продовжила']],
  ])('%s: status, motive and result are translated — no French label left', async (lang, expected) => {
    const page = await renderIn(lang);
    for (const w of expected) expect(page, `${lang}: ${w}`).toHaveTextContent(w);
    const statuses = screen.getAllByTestId('orientation-item-status').map((e) => e.textContent);
    for (const w of FRENCH) {
      expect(statuses.join(' | '), `${lang} status`).not.toContain(w);
      expect(screen.getByTestId('orientation-pending').textContent, `${lang} motive`).not.toContain(w);
      expect(screen.getByTestId('orientation-outcome').textContent, `${lang} result`).not.toContain(w);
    }
  });
});
