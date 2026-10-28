// @vitest-environment jsdom
/**
 * DTA S3A — honest structure shortlist for the plan (pure routing + jsdom UI).  No structure is declared suitable; ids/slugs/contacts/appointments are never invented;
 * the data is UNVERIFIED and the notice says so; booking is only reachable from the structure page the person chooses.
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionPlan from '../../src/components/diagnostic/ActionPlan.jsx';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { ALTERNATIVES, NO_MATCH_NOTICE, ROUTING_NOTICE, organismQuery, routeStructures, structurePath } from '../../src/lib/structureRouting.js';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';

afterEach(cleanup);
const DIR = [
  { id: 1, slug: 'caf-67', nom: "CAISSE D'ALLOCATIONS FAMILIALES DU BAS RHIN — CAF 67", ville: 'Strasbourg', telephone: '+33388377543', email: 'x@caf67.example' },
  { id: 2, slug: 'cpam', nom: 'CPAM du Bas-Rhin', ville: 'Strasbourg' },
  { id: 3, slug: '', nom: 'CAF sans page', ville: 'Strasbourg' },
  { id: 4, nom: 'CAF sans slug' },
  { id: 1, slug: 'caf-67', nom: 'CAF doublon' },
  null, 'x', { nom: 'CAF sans id', slug: 's' },
];

describe('pure routing', () => {
  it('only the organism the assessment names is keyed (CAF); a generic professional is not guessed', () => {
    expect(organismQuery('votre CAF')).toEqual({ key: 'CAF', query: 'CAF' });
    expect(organismQuery('votre commune ou votre CAF')).toEqual({ key: 'CAF', query: 'CAF' });
    expect(organismQuery("un professionnel (travailleur social ou structure d'accompagnement)")).toBeNull();
    expect(organismQuery(null)).toBeNull(); expect(organismQuery(42)).toBeNull();
  });
  it('MATCHED: name correspondence only, requires id + slug, de-duplicated, no contact detail is carried, notice states the data is unverified', () => {
    const r = routeStructures('votre CAF', DIR);
    expect(r.mode).toBe('MATCHED'); expect(r.structures).toEqual([{ id: '1', slug: 'caf-67', nom: DIR[0].nom, ville: 'Strasbourg', rdvOnline: false }]);
    expect(JSON.stringify(r)).not.toMatch(/telephone|email|@|\+33|disponib|rendez-vous planifi/i);
    expect(r.notice).toBe(ROUTING_NOTICE); expect(r.notice).toMatch(/nom uniquement/); expect(r.notice).toMatch(/ne sait pas si/); expect(r.notice).toMatch(/Données en cours de vérification/);
    expect(findProhibitedDecisionWording(r.notice)).toEqual([]);
  });
  it('S3B: the online-appointment hint comes ONLY from the structure\'s own is_pro_enabled === true, never from the name', () => {
    const r = routeStructures('votre CAF', [{ id: 1, slug: 'a', nom: 'CAF A', is_pro_enabled: true }, { id: 2, slug: 'b', nom: 'CAF B', is_pro_enabled: 'true' }, { id: 3, slug: 'c', nom: 'CAF C' }]);
    expect(r.structures.map((x) => x.rdvOnline)).toEqual([true, false, false]);
  });
  it('NONE for no match, for a generic organism and for garbage input: an explicit limitation + alternatives, never an invented structure', () => {
    for (const [who, list] of [['votre CAF', [DIR[1]]], ['votre CAF', []], ['votre CAF', null], ['un professionnel', DIR]]) {
      const r = routeStructures(who, list); expect(r.mode).toBe('NONE'); expect(r.structures).toEqual([]); expect(r.notice).toBe(NO_MATCH_NOTICE);
      expect(r.alternatives).toBe(ALTERNATIVES); expect(r.notice).toMatch(/pas un refus/);
    }
  });
  it('at most five structures; a structure path exists only from a real slug', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: 10 + i, slug: `caf-${i}`, nom: `CAF ${i}` }));
    expect(routeStructures('votre CAF', many).structures).toHaveLength(5);
    expect(structurePath({ slug: 'a b' })).toBe('/structures/a%20b'); expect(structurePath({ id: 4 })).toBeNull(); expect(structurePath(null)).toBeNull();
  });
  it('the alternatives are internal routes only', () => { for (const a of ALTERNATIVES) expect(a.to).toMatch(/^\/[a-z0-9\-/?=&_]*$/i); });
});

const ANSWERS = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } };
const results = () => ({ assessment: buildAssessment({ answers: ANSWERS, unsupportedRights: UNSUPPORTED_RIGHTS }), period: '2026-09', meta: { requestId: 'r', durationMs: 1 } });
const open = (props) => render(createElement(MemoryRouter, null, createElement(ActionPlan, { results: results(), ...props })));

describe('the plan UI', () => {
  it('without a loader nothing is fetched or shown (existing behaviour)', () => { open({}); expect(screen.queryByTestId('plan-structures')).toBeNull(); });
  it('CAF step: the loader is called once with the organism query, the person gets a link to the structure PAGE (not to a booking), and the notice', async () => {
    const loader = vi.fn(async () => DIR);
    open({ structureLoader: loader });
    await screen.findAllByTestId('plan-structures');
    const cafStep = [...screen.getByTestId('action-plan').querySelectorAll('[data-step-kind="verify"]')].find((li) => /CAF/.test(li.textContent));
    const panel = await within(cafStep).findByTestId('plan-structures'); expect(panel).toHaveAttribute('data-mode', 'MATCHED');
    expect(loader).toHaveBeenCalledTimes(1); expect(loader).toHaveBeenCalledWith('CAF');
    const link = within(panel).getByTestId('plan-structure-link'); expect(link).toHaveAttribute('href', '/structures/caf-67');
    expect(document.body.innerHTML).not.toMatch(/structure_id|\/appointments\/request|\/rdv\//);
    expect(within(panel).getByTestId('plan-structures-notice')).toHaveTextContent(/nom uniquement/);
    expect(screen.getByTestId('action-plan').querySelectorAll('[data-testid="plan-structure-link"]')).toHaveLength(1); // only the CAF step has a shortlist; the generic professional step is covered below
  });
  it('S3B: the hint is shown only for a structure that publishes online appointments, and says it must be confirmed on its page', async () => {
    open({ structureLoader: async () => [{ id: 1, slug: 'caf-rdv', nom: 'CAF avec RDV', is_pro_enabled: true }, { id: 2, slug: 'caf-sans', nom: 'CAF sans RDV' }] });
    const hints = await screen.findAllByTestId('plan-structure-rdv'); expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent(/à confirmer sur sa page/); expect(screen.getAllByTestId('plan-structure-link')).toHaveLength(2);
  });
  it('generic professional step: explicit limitation and alternatives, no structure', async () => {
    const loader = vi.fn(async () => DIR); open({ structureLoader: loader });
    await screen.findByTestId('plan-structures');
    const generic = [...screen.getByTestId('action-plan').querySelectorAll('[data-step-kind="verify"]')].find((li) => /professionnel/.test(li.textContent));
    expect(generic).toBeTruthy(); const p = within(generic).getByTestId('plan-structures'); expect(p).toHaveAttribute('data-mode', 'NONE');
    expect(within(p).getByText(/pas de structure à vous proposer/)).toBeInTheDocument(); expect(within(p).getByRole('link', { name: /France Services/ })).toHaveAttribute('href', '/structures?type=france_services');
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('a failing directory is a limitation, not a crash and not a refusal', async () => {
    open({ structureLoader: vi.fn(async () => { throw new Error('boom'); }) });
    const panels = await screen.findAllByTestId('plan-structures'); for (const p of panels) expect(p).toHaveAttribute('data-mode', expect.stringMatching(/ERROR|NONE/));
    await waitFor(() => expect(screen.getAllByTestId('plan-structures-notice')[0]).toHaveTextContent(/n.a pas pu être consulté/));
    expect(screen.getAllByTestId('plan-structures-notice')[0].textContent).toMatch(/pas un refus/);
  });
  it('S3B loading: a pending directory shows a polite status (role=status) and no result claim yet', async () => {
    open({ structureLoader: () => new Promise(() => {}) });
    const st = await screen.findAllByRole('status'); expect(st.some((e) => /Recherche dans l.annuaire/.test(e.textContent))).toBe(true);
    expect(screen.queryByTestId('plan-structure-link')).toBeNull(); expect(screen.getByTestId('plan-structures-loading')).toBeInTheDocument(); // the generic professional step shows its limitation panel, never a structure
  });
  it('S3B keyboard + a11y: shortlist links are native focusable links, the panel has no serious/critical axe violation (jsdom, contrast disabled)', async () => {
    open({ structureLoader: async () => [{ id: 1, slug: 'caf-rdv', nom: 'CAF avec RDV', ville: 'Strasbourg', is_pro_enabled: true }] });
    const link = await screen.findByTestId('plan-structure-link'); expect(link.tagName).toBe('A'); link.focus(); expect(document.activeElement).toBe(link);
    await waitFor(() => expect(screen.queryByTestId('plan-structures-loading')).toBeNull());
    const res = await axe.run(screen.getByTestId('action-plan'), { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
  it('the read-only professional view never queries the directory and shows no shortlist', () => {
    const loader = vi.fn(async () => DIR); open({ audience: 'pro', structureLoader: loader });
    expect(loader).not.toHaveBeenCalled(); expect(screen.queryByTestId('plan-structures')).toBeNull();
  });
});
