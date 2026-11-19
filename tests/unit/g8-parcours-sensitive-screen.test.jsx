// @vitest-environment jsdom
/**
 * G8 — the screens of a « sensitive step »: Mon Parcours says what this deployment does with them (excluded by default, or per-step consent), the title
 * asks not to write such information, a request the server will only take with consent is NEVER resent before the person ticked and confirmed (and is
 * resent with `sensitiveConsent: true` only then), a step kept that way is labelled, and the delegate's view says sensitive steps are never shown there.
 * Six languages for every new sentence; none asserts a right.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import CompteParcours from '../../src/pages/CompteParcours.jsx';
import { AddToParcoursControl } from '../../src/components/AddToParcoursButton.jsx';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const wrap = (el) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, el))));
const item = { id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: [], records: [], available: true,
  plan: null, step: null, dependsOn: null, waiting: false };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const err = (code, status) => Object.assign(new Error(`refus ${code}`), { code, status });

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.parcoursHistory.mockResolvedValue({ events: [] }); api.listShares.mockResolvedValue({ shares: [] }); });
afterEach(() => { cleanup(); });

describe('G8 — Mon Parcours screen', () => {
  it('excluded (default, and a server without the flag): the notice says sensitive steps are not recorded; the title asks not to write them', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true, planImport: false });
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('parcours-sensitive-notice')).toHaveTextContent(/n’enregistre pas, pour le moment, ce qui concerne la santé, le handicap/);
    expect(screen.getByTestId('parcours-title-hint')).toHaveTextContent(/sans information sur votre santé/);
    expect(screen.getByTestId('parcours-new-title')).toHaveAttribute('aria-describedby', 'pc-new-hint');
  });

  it('excluded: a refused step shows the refusal, nothing is resent, no consent is offered', async () => {
    api.listParcours.mockResolvedValue({ items: [], planSteps: true, sensitiveSteps: 'excluded' });
    api.parcours.mockRejectedValue(err('SENSITIVE_STEP_EXCLUDED', 422));
    wrap(h(CompteParcours)); await tick();
    fireEvent.change(screen.getByTestId('parcours-new-title'), { target: { value: 'Dossier MDPH' } });
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add')); }); await tick();
    expect(api.parcours).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('parcours-problem')).toHaveTextContent('refus SENSITIVE_STEP_EXCLUDED');
    expect(screen.queryByTestId('parcours-consent')).toBeNull();
  });

  it('consent: the request is resent with sensitiveConsent only after the box is ticked and confirmed; cancelling sends nothing', async () => {
    api.listParcours.mockResolvedValue({ items: [], planSteps: true, sensitiveSteps: 'consent' });
    api.parcours.mockRejectedValueOnce(err('SENSITIVE_STEP_CONSENT_REQUIRED', 409)).mockResolvedValueOnce({ ok: true, item: { id: 'p9' } });
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('parcours-sensitive-notice')).toHaveTextContent(/qu’avec votre accord explicite, étape par étape/);
    fireEvent.change(screen.getByTestId('parcours-new-title'), { target: { value: 'Dossier MDPH' } });
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add')); }); await tick();
    expect(api.parcours).toHaveBeenCalledTimes(1);
    expect(api.parcours.mock.calls[0][0]).toEqual({ action: 'add', title: 'Dossier MDPH' });
    expect(screen.queryByTestId('parcours-problem')).toBeNull();
    const confirm = screen.getByTestId('parcours-consent-confirm');
    expect(screen.getByTestId('parcours-consent')).toHaveTextContent(/Rien n’a été enregistré/);
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('parcours-consent-check')).not.toBeChecked();   // never pre-ticked
    fireEvent.click(screen.getByTestId('parcours-consent-check'));
    expect(confirm).toBeEnabled();
    await act(async () => { fireEvent.click(confirm); }); await tick();
    expect(api.parcours).toHaveBeenCalledTimes(2);
    expect(api.parcours.mock.calls[1][0]).toEqual({ action: 'add', title: 'Dossier MDPH', sensitiveConsent: true });
    expect(screen.queryByTestId('parcours-consent')).toBeNull();
    expect(screen.getByTestId('parcours-new-title')).toHaveValue('');
  });

  it('consent: « Ne pas enregistrer » closes the request without sending anything', async () => {
    api.listParcours.mockResolvedValue({ items: [], planSteps: true, sensitiveSteps: 'consent' });
    api.parcours.mockRejectedValueOnce(err('SENSITIVE_STEP_CONSENT_REQUIRED', 409));
    wrap(h(CompteParcours)); await tick();
    fireEvent.change(screen.getByTestId('parcours-new-title'), { target: { value: 'RDV au CMP' } });
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add')); }); await tick();
    fireEvent.click(screen.getByTestId('parcours-consent-cancel'));
    expect(screen.queryByTestId('parcours-consent')).toBeNull();
    expect(api.parcours).toHaveBeenCalledTimes(1);
  });

  it('a step kept with consent is labelled: visible by the person only, never shown to a trusted person, deletion withdraws it', async () => {
    api.listParcours.mockResolvedValue({ items: [{ ...item, title: 'Dossier MDPH', sensitive: true }, item], planSteps: true, sensitiveSteps: 'consent' });
    wrap(h(CompteParcours)); await tick();
    expect(screen.getAllByTestId('parcours-sensitive-item')).toHaveLength(1);
    expect(screen.getByTestId('parcours-sensitive-item')).toHaveTextContent(/jamais montrée à une personne de confiance/);
  });
});

describe('G8 — notes closed (ADA_PARCOURS_NOTES=off)', () => {
  it('no note field on a step without a note; a step that has one keeps the field so the person can clear it', async () => {
    api.listParcours.mockResolvedValue({ items: [item, { ...item, id: 'p2', title: 'Rassembler les papiers', note: 'Appeler lundi' }], planSteps: true, notes: false });
    wrap(h(CompteParcours)); await tick();
    const buttons = screen.getAllByRole('button', { name: /Mettre à jour/ });
    await act(async () => { fireEvent.click(buttons[0]); }); await tick();
    expect(screen.queryByTestId('parcours-note')).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Mettre à jour/ })[0]); }); await tick();
    expect(screen.getByTestId('parcours-note')).toHaveValue('Appeler lundi');
  });
  it('notes open (default, and a server without the flag): the field is there', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true });
    wrap(h(CompteParcours)); await tick();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mettre à jour/ })); }); await tick();
    expect(screen.getByTestId('parcours-note')).toBeInTheDocument();
  });
});

describe('G8 — « Ajouter à mon parcours » on a record page', () => {
  it('consent: asks before resending; the resent request is the same plus sensitiveConsent', async () => {
    api.parcours.mockRejectedValueOnce(err('SENSITIVE_STEP_CONSENT_REQUIRED', 409)).mockResolvedValueOnce({ ok: true, added: true });
    wrap(h(AddToParcoursControl, { records: [{ type: 'aide', id: 'aah' }] }));
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add-record-button')); }); await tick();
    expect(screen.getByTestId('parcours-add-consent')).toBeInTheDocument();
    expect(screen.getByTestId('parcours-add-consent-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('parcours-add-consent-check'));
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add-consent-confirm')); }); await tick();
    expect(api.parcours.mock.calls.map((c) => c[0])).toEqual([{ action: 'add', records: [{ type: 'aide', id: 'aah' }] }, { action: 'add', records: [{ type: 'aide', id: 'aah' }], sensitiveConsent: true }]);
    expect(screen.getByTestId('parcours-add-record-status')).toHaveTextContent(/Étape ajoutée/);
  });
  it('excluded: the refusal is shown, no consent offered', async () => {
    api.parcours.mockRejectedValueOnce(err('SENSITIVE_STEP_EXCLUDED', 422));
    wrap(h(AddToParcoursControl, { records: [{ type: 'aide', id: 'aah' }] }));
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add-record-button')); }); await tick();
    expect(screen.getByTestId('parcours-add-record-error')).toHaveTextContent('refus SENSITIVE_STEP_EXCLUDED');
    expect(screen.queryByTestId('parcours-add-consent')).toBeNull();
  });
});

describe('G8 — six languages, no entitlement claim', () => {
  const KEYS = { compte: ['parcours.sensitive_item', 'parcours.sensitive_notice_consent', 'parcours.sensitive_notice_excluded', 'parcours.consent_title', 'parcours.consent_body',
    'parcours.consent_check', 'parcours.consent_confirm', 'parcours.consent_cancel', 'parcours.title_hint', 'delegation_view.sensitive_hidden'],
  shared: ['parcours_add.consent_body', 'parcours_add.consent_check', 'parcours_add.consent_confirm', 'parcours_add.consent_cancel'],
  common: ['api_error.sensitive_step_excluded', 'api_error.sensitive_step_consent', 'api_error.notes_closed'] };
  it.each(['en', 'de', 'tr', 'ar', 'uk'])('%s', (lang) => {
    for (const [ns, keys] of Object.entries(KEYS)) {
      const d = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/${ns}.json`, 'utf8'));
      for (const k of keys) { expect(typeof d[k] === 'string' && d[k].trim().length > 0, `${lang}/${ns}:${k}`).toBe(true); expect(claimsEntitlement(d[k]), `${lang}/${ns}:${k}`).toBe(false); }
    }
  });
  it('the French defaults in code assert no right either', () => {
    const src = ['src/pages/CompteParcours.jsx', 'src/components/AddToParcoursButton.jsx', 'src/lib/citizenErrors.js', 'src/pages/CompteDelegationVue.jsx'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const found = [...src.matchAll(/'(?:compte|shared|common):(?:parcours\.(?:sensitive|consent|title_hint)[\w.]*|parcours_add\.consent\w*|api_error\.sensitive\w*|delegation_view\.sensitive_hidden)', '([^']+)'/g)];
    expect(found.length).toBe(16);
    for (const m of found) expect(claimsEntitlement(m[1]), m[1]).toBe(false);
  });
});
