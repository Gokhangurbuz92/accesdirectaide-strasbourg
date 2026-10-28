// @vitest-environment jsdom
/**
 * R13 (D17) — the grounded assistant connected to the person's result: « Poser une question sur ces pistes » on the result page opens the Boussole Sociale with
 * the pistes attached (code + state only, read-only on the server, never stored); the dialog says so and « Retirer » takes them back; every question sent while
 * they are attached carries them in context.assessment, none after. Before R13 the server accepted an assessment but no page ever sent one.
 * No JSX in the test body (the repo ESLint config does not parse JSX in tests/).
 */
/* global window */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ ensureCsrfHeaders: async () => ({ 'x-csrf-token': 't' }), csrfFetch: vi.fn() }));
vi.mock('@/components/assistant/FeedbackButtons', () => ({ default: () => null }));

import ChatAssistant from '../../src/components/chat/ChatAssistant.jsx';
import DiagnosticOutcome from '../../src/components/diagnostic/DiagnosticOutcome.jsx';
import { ASSISTANT_OPEN_EVENT, assessmentForAssistant, openAssistantWithAssessment } from '../../src/lib/assistantBridge.js';

const prov = { display: { source: 'Source : aucune', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé', rule: 'Règle : aucune', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const item = (code, state) => ({ code, label: code.toUpperCase(), state, authoritative: false, amount: null, missingFacts: [], whoToAsk: 'votre CAF', explanation: 'Pré-orientation indicative.', provenance: prov });
const RESULTS = { assessment: { contract: 'ADA_ASSESSMENT_CONTRACT_V1', items: [item('rsa', 'CHECK_REQUIRED'), item('apl', 'MISSING_INFORMATION'), { ...item('aah', 'ELIGIBLE'), authoritative: true }] } };

let bodies;
beforeEach(() => {
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ answer: 'Selon la fiche…', citations: [], meta: { territoryId: 'commune:67482', territoryLabel: 'Strasbourg' } }) }; }));
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('R13 D17: the assistant receives the result only when the person asks', () => {
  it('only the code and state of each renderable piste leave the page (an authoritative / unknown item is dropped), at most 20', () => {
    expect(assessmentForAssistant(RESULTS)).toEqual([{ rightId: 'rsa', state: 'CHECK_REQUIRED' }, { rightId: 'apl', state: 'MISSING_INFORMATION' }]);
    const many = { assessment: { items: Array.from({ length: 30 }, (_, i) => item(`r${i}`, 'CHECK_REQUIRED')) } };
    expect(assessmentForAssistant(many)).toHaveLength(20);
    expect(openAssistantWithAssessment({ assessment: { items: [] } })).toBe(false);
  });

  it('the result page button opens the assistant with the pistes; the dialog says so; « Retirer » takes them back', async () => {
    const seen = []; const spy = (e) => seen.push(e.detail); window.addEventListener(ASSISTANT_OPEN_EVENT, spy);
    render(createElement(MemoryRouter, null, createElement(DiagnosticOutcome, { results: RESULTS, situation: {}, structureLoader: async () => [] }), createElement(ChatAssistant)));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('diagnostic-ask-assistant')); });
    window.removeEventListener(ASSISTANT_OPEN_EVENT, spy);
    expect(seen).toEqual([{ assessment: [{ rightId: 'rsa', state: 'CHECK_REQUIRED' }, { rightId: 'apl', state: 'MISSING_INFORMATION' }] }]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-assessment-attached')).toHaveTextContent('Vos 2 pistes de simulation sont jointes à vos questions, en lecture seule');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Que veut dire « à vérifier » pour le RSA ?' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')); });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].context.assessment).toEqual([{ rightId: 'rsa', state: 'CHECK_REQUIRED' }, { rightId: 'apl', state: 'MISSING_INFORMATION' }]);
    expect(JSON.stringify(bodies[0])).not.toMatch(/explanation|label|whoToAsk|amount/);

    fireEvent.click(screen.getByTestId('assistant-assessment-remove'));
    expect(screen.queryByTestId('assistant-assessment-attached')).toBeNull();
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Et pour l’APL ?' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')); });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].context).not.toHaveProperty('assessment');
  });

  it('without a usable result there is no button, and the assistant alone never attaches anything', async () => {
    render(createElement(MemoryRouter, null, createElement(DiagnosticOutcome, { results: { assessment: { items: [] } }, situation: {}, structureLoader: async () => [] }), createElement(ChatAssistant)));
    expect(screen.queryByTestId('diagnostic-ask-assistant')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la Boussole Sociale' }));
    expect(screen.queryByTestId('assistant-assessment-attached')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Aide au loyer' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')); });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].context).not.toHaveProperty('assessment');
  });
});
