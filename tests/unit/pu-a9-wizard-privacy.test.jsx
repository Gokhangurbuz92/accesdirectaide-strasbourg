// @vitest-environment jsdom
/* global window */
/**
 * A-9 (P16) — the orientation wizard asked for a date of birth, income and housing with no privacy notice, and kept its progress for 24 hours in
 * window.localStorage. It now shows a notice before the first question; its progress lives in the tab's session only, holds the first steps' choices only
 * (never the last step's answers), is removed when the result is shown, and the 24-hour copy of earlier versions is deleted. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ client: { entities: { Structure: { filter: async () => [] } } } }));

import { storage, WIZARD_KEPT_FIELDS } from '../../src/lib/storage.js';
import Wizard from '../../src/components/assistant/Wizard.jsx';

const KEY = 'ada_wizard_state';
const FULL = { need: 'logement', territory: '67000', situation: 'seul', statut: 'emploi', urgency: 'haute',
  birthDate: '1990-05-01', ageBand: '25-59', householdSize: '1', salary: '1200', unemployment: '0', rent: '450', charges: '50', housingStatus: 'tenant' };

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
afterEach(() => cleanup());

describe('A-9: what the wizard keeps in the browser', () => {
  it('progress goes to the tab session, never to window.localStorage', () => {
    storage.saveWizard({ step: 2, data: { need: 'logement', territory: '67000' } });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(storage.loadWizard()).toEqual({ step: 2, data: { need: 'logement', territory: '67000' } });
  });
  it('the last step\'s answers (birth date, age band, income, rent, housing) are never written', () => {
    storage.saveWizard({ step: 4, data: FULL });
    const raw = window.sessionStorage.getItem(KEY) || '';
    for (const secret of ['1990-05-01', '25-59', '1200', '450', 'tenant', 'birthDate', 'salary', 'rent', 'housingStatus', 'householdSize']) expect(raw, secret).not.toContain(secret);
    expect(Object.keys(storage.loadWizard().data).sort()).toEqual([...WIZARD_KEPT_FIELDS].sort());
    expect(WIZARD_KEPT_FIELDS).toEqual(['need', 'territory', 'situation', 'statut', 'urgency']);
  });
  it('the 24-hour window.localStorage copy of earlier versions is deleted, never read', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ data: { step: 4, data: FULL }, timestamp: Date.now() }));
    expect(storage.loadWizard()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ data: { step: 4, data: FULL }, timestamp: Date.now() }));
    storage.purgeExpired();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
  it('clearWizard and clearAll remove the session copy', () => {
    storage.saveWizard({ step: 1, data: { need: 'sante' } }); storage.clearWizard();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    storage.saveWizard({ step: 1, data: { need: 'sante' } }); storage.clearAll();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
  it('the result screen removes the stored progress (source: clearWizard right after the result is set)', () => {
    const src = fs.readFileSync('src/components/assistant/Wizard.jsx', 'utf8');
    expect(src).toMatch(/setPhase\('diagnostic-results'\);\s*storage\.clearWizard\(\);/);
  });
});

describe('A-9: the wizard shows its privacy notice before the first question', () => {
  it('first step: the notice is a labelled region, says the answers go to the server and what the browser keeps, and links to the policy', async () => {
    render(h(MemoryRouter, null, h(Wizard)));
    const notice = screen.getByTestId('wizard-privacy-notice');
    expect(screen.getByRole('region', { name: 'Vos données' })).toBe(notice);
    expect(notice).toHaveTextContent('vos réponses sont transmises à notre serveur');
    expect(notice).toHaveTextContent('gardés seulement dans cet onglet');
    expect(notice).toHaveTextContent('« Recommencer »');
    expect(notice).toHaveTextContent('Votre date de naissance, vos revenus et votre logement ne sont pas gardés dans le navigateur.');
    expect(notice).not.toHaveTextContent('24 heures');
    expect(screen.getByRole('link', { name: 'Lire la politique de confidentialité' })).toHaveAttribute('href', '/politique-confidentialite');
    // the notice comes before the step's first control in reading order
    const firstControl = window.document.querySelector('button, input, select');
    expect(notice.compareDocumentPosition(firstControl) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).not.toBeNull());
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
  it.each(['en', 'tr', 'ar', 'de', 'uk'])('%s: the browser sentence is translated and keeps « {{restart}} »', (lang) => {
    const loc = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/diagnostic.json`, 'utf8'));
    expect(loc['wizard.privacy.browser']).toContain('{{restart}}');
    expect(loc['wizard.privacy.browser']).not.toMatch(/24/);
  });
});
