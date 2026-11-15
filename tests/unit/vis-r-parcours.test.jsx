// @vitest-environment jsdom
/* global document */
/**
 * VIS-R — Mon Parcours gaps: « Ajouter à mon parcours » (only when the surface is open and a citizen is signed in; strict server validation), a withdrawn record
 * flagged in a step, « who does what next » of a plan step, and the neutral « Que faire ensuite ? » block after a self-declared unfavourable answer.
 * The server rules on a real PostgreSQL: tests/integration/vis-r-parcours-db.test.js.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn() }));
const authMe = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({ frontendEnv: null }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe } }));
vi.mock('../../src/config/env.js', async (importOriginal) => { const real = await importOriginal(); env.frontendEnv = { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, publicBeta: false } }; return { ...real, frontendEnv: env.frontendEnv }; });
// the service is imported for its pure validation only: touching the database here is a failure
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import AddToParcoursButton from '../../src/components/AddToParcoursButton.jsx';
import OrientationPanel from '../../src/components/search/OrientationPanel.jsx';
import CompteParcours from '../../src/pages/CompteParcours.jsx';
import { parcoursOpened } from '../../src/lib/publicBeta.js';
import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const mount = (C, props = {}) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, h(C, props)))));
const item = (o = {}) => ({ id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'NOT_STARTED', dueDate: null, note: null, itemCodes: [], records: [], available: true, plan: null, ...o });
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const signedIn = () => authMe.mockResolvedValue({ session: { kind: 'user' }, user: { email: 'x@example.test' } });
const need = { id: 'n1', label: 'Se soigner sans titre de séjour', urgent: false, numbers: [], actions: ['Demander un rendez-vous'], rules: [], sheets: ['F3079', 'F12006'], topic: 'aide médicale' };
const orientation = { needs: [need], cautions: [], questions: [], sources: { F3079: { title: 'Fiche F3079', url: 'https://www.service-public.gouv.fr/x/F3079', slug: 'aide-medicale-f3079' }, F12006: { title: 'Fiche F12006', url: 'https://www.service-public.gouv.fr/x/F12006', slug: null } } };

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); authMe.mockReset(); api.listShares.mockResolvedValue({ shares: [] }); api.parcoursHistory.mockResolvedValue({ events: [] }); env.frontendEnv.flags.publicBeta = false; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('surface gating of « Ajouter à mon parcours »', () => {
  it('open outside the beta; inside it only with the accounts surface in its FULL scope — the same answer as the server gate', () => {
    expect(parcoursOpened(false, [], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
    for (const [open, scope, expected] of [[[], 'booking', false], [[], 'full', false], [['accounts'], 'booking', false], [['appointments', 'documents'], 'full', false], [['accounts'], 'full', true]]) {
      expect(parcoursOpened(true, open, { accountsScope: scope, proSelfRegistration: false }), `${open}/${scope}`).toBe(expected);
      const server = isAllowedInPublicBeta('POST', 'citizen/parcours', { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: open.join(','), ADA_BETA_ACCOUNTS_SCOPE: scope });
      expect(server, `server ${open}/${scope}`).toBe(expected);
    }
  });
  it('public beta build: nothing is rendered and the session is not even asked', async () => {
    env.frontendEnv.flags.publicBeta = true; signedIn();
    mount(AddToParcoursButton, { type: 'aide', id: 'a1' });
    await tick();
    expect(screen.queryByTestId('parcours-add-record')).toBeNull(); expect(authMe).not.toHaveBeenCalled(); expect(api.parcours).not.toHaveBeenCalled();
  });
  it('beta build that opens accounts in the full scope: the control is offered to a signed-in citizen', async () => {
    env.frontendEnv.flags.publicBeta = true; vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'accounts'); vi.stubEnv('VITE_PUBLIC_BETA_ACCOUNTS_SCOPE', 'full'); signedIn();
    mount(AddToParcoursButton, { type: 'aide', id: 'a1' });
    expect(await screen.findByTestId('parcours-add-record-button')).toBeInTheDocument();
  });
  it('an anonymous visitor, a professional session, or a page without a query client: nothing', async () => {
    authMe.mockResolvedValue({ session: null });
    mount(AddToParcoursButton, { type: 'aide', id: 'a1' }); await tick();
    expect(screen.queryByTestId('parcours-add-record')).toBeNull(); cleanup();
    authMe.mockResolvedValue({ session: { kind: 'pro' } });
    mount(AddToParcoursButton, { type: 'aide', id: 'a1' }); await tick();
    expect(screen.queryByTestId('parcours-add-record')).toBeNull(); cleanup();
    signedIn(); authMe.mockClear();
    render(h(MemoryRouter, null, h(AddToParcoursButton, { type: 'aide', id: 'a1' }))); await tick();
    expect(screen.queryByTestId('parcours-add-record')).toBeNull(); expect(authMe).not.toHaveBeenCalled();
    expect(api.parcours).not.toHaveBeenCalled();
  });
});

describe('« Ajouter à mon parcours »', () => {
  it('a record page: a real button (keyboard), one request with the record, the confirmation in a polite live region with a link to Mon Parcours', async () => {
    signedIn(); api.parcours.mockResolvedValue({ added: true, item: { id: 'p9' } });
    mount(AddToParcoursButton, { type: 'demarche', id: 'd1' });
    const b = await screen.findByRole('button', { name: 'Ajouter à mon parcours' });
    expect(b.tagName).toBe('BUTTON'); expect(b).toHaveAttribute('type', 'button');
    const live = screen.getByTestId('parcours-add-record-status');
    expect(live).toHaveAttribute('aria-live', 'polite'); expect(live).toHaveAttribute('role', 'status'); expect(live).toBeEmptyDOMElement();
    b.focus(); expect(document.activeElement).toBe(b);
    fireEvent.click(b);
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'add', records: [{ type: 'demarche', id: 'd1' }] }));
    await waitFor(() => expect(live).toHaveTextContent('Étape ajoutée à Mon Parcours.'));
    expect(screen.getByRole('link', { name: 'Ouvrir Mon Parcours' })).toHaveAttribute('href', '/compte/parcours');
    expect(b).toBeDisabled();   // a second click cannot send it twice
    expect(api.parcours).toHaveBeenCalledTimes(1);
  });
  it('already tracked: said as such; a server refusal is shown as an alert and the button stays usable', async () => {
    signedIn(); api.parcours.mockResolvedValueOnce({ added: false, item: { id: 'p9' } });
    mount(AddToParcoursButton, { type: 'aide', id: 'a1' });
    fireEvent.click(await screen.findByTestId('parcours-add-record-button'));
    await waitFor(() => expect(screen.getByTestId('parcours-add-record-status')).toHaveTextContent('Cette étape est déjà dans Mon Parcours.'));
    cleanup();
    api.parcours.mockRejectedValueOnce(new Error('Cette fiche n’est pas publiée.'));
    mount(AddToParcoursButton, { type: 'aide', id: 'a2' });
    fireEvent.click(await screen.findByTestId('parcours-add-record-button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cette fiche n’est pas publiée.');
    expect(screen.getByTestId('parcours-add-record-button')).not.toBeDisabled();
  });
  it('an orientation need whose sheet is published on the site becomes a step: its label as the title, the local sheets as records', async () => {
    signedIn(); api.parcours.mockResolvedValue({ added: true });
    mount(OrientationPanel, { orientation, query: 'q' });
    fireEvent.click(await screen.findByTestId('parcours-add-record-button'));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'add', records: [{ type: 'guide', id: 'aide-medicale-f3079' }], title: 'Se soigner sans titre de séjour' }));
  });
  it('an orientation need with no sheet on the site, or an anonymous visitor: no control', async () => {
    signedIn();
    mount(OrientationPanel, { orientation: { ...orientation, needs: [{ ...need, sheets: ['F12006'] }] }, query: 'q' }); await tick();
    expect(screen.getByTestId('orientation-need-n1')).toBeInTheDocument(); expect(screen.queryByTestId('parcours-add-record')).toBeNull(); cleanup();
    authMe.mockResolvedValue({ session: null });
    mount(OrientationPanel, { orientation, query: 'q' }); await tick();
    expect(screen.queryByTestId('parcours-add-record')).toBeNull();
  });
});

describe('server validation of the record path (before any database access)', () => {
  it('refuses anything that is not 1 to 5 well-formed { type, id }, and a malformed title', async () => {
    const { addManualItem, PARCOURS_RECORD_TYPES, MAX_PARCOURS_RECORDS } = await import('../../api/_services/mon-espace.js');
    expect(PARCOURS_RECORD_TYPES).toEqual(['aide', 'demarche', 'dispositif', 'guide']); expect(MAX_PARCOURS_RECORDS).toBe(5);
    const ok = { type: 'aide', id: 'a1' };
    const invalid = [null, 'aide:a1', {}, [], Array.from({ length: 6 }, () => ok), [null], ['aide:a1'], [[]], [{ type: 'structure', id: 'a1' }], [{ type: 'aide' }], [{ type: 'aide', id: 7 }],
      [{ type: 'aide', id: '' }], [{ type: 'aide', id: 'a 1' }], [{ type: 'aide', id: "a1' OR 1=1" }], [{ type: 'aide', id: '../x' }], [{ type: 'aide', id: 'x'.repeat(121) }], [{ type: ['aide'], id: 'a1' }], [ok, { type: 'Aide', id: 'a1' }]];
    for (const records of invalid) expect((await addManualItem('u1', { records })).code, JSON.stringify(records)).toBe('INVALID_RECORDS');
    for (const title of ['ab', 'x'.repeat(201), 7, {}, '  a  ']) expect((await addManualItem('u1', { records: [ok], title })).code, String(title)).toBe('INVALID_TITLE');
  });
});

describe('Mon Parcours — what a step shows', () => {
  it('a withdrawn record is flagged « n’est plus disponible » with a search for an alternative; an available one links to its page', async () => {
    api.listParcours.mockResolvedValue({ items: [item({ available: false, itemCodes: ['aide:a1', 'demarche:d1'],
      records: [{ code: 'aide:a1', type: 'aide', available: false, title: null, href: null, contact: false }, { code: 'demarche:d1', type: 'demarche', available: true, title: 'Demander un logement social', href: '/demarches/logement-social', contact: true }] })] });
    mount(CompteParcours);
    const gone = await screen.findByTestId('parcours-record-unavailable');
    expect(gone).toHaveTextContent('Cette fiche n’est plus disponible.');
    expect(screen.getByRole('link', { name: 'Chercher une autre fiche' })).toHaveAttribute('href', `/recherche?q=${encodeURIComponent('Aide au logement')}`);
    expect(screen.getByRole('link', { name: 'Demander un logement social' })).toHaveAttribute('href', '/demarches/logement-social');
  });
  it('a plan step keeps who does what next: the organisation, the detail and the internal links', async () => {
    api.listParcours.mockResolvedValue({ items: [item({ origin: 'PLAN', stepKind: 'verify', title: 'Faire vérifier votre situation pour RSA auprès de la CAF',
      plan: { who: 'la CAF', detail: 'Ce plan n’est pas une décision : seul l’organisme compétent peut examiner votre situation.', links: [{ to: '/aides/rsa', label: 'Fiche d’information : RSA' }] } })] });
    mount(CompteParcours);
    const plan = await screen.findByTestId('parcours-plan');
    expect(plan).toHaveTextContent('Auprès de qui : la CAF'); expect(plan).toHaveTextContent('seul l’organisme compétent peut examiner votre situation');
    expect(screen.getByRole('link', { name: 'Fiche d’information : RSA' })).toHaveAttribute('href', '/aides/rsa');
    cleanup();
    api.listParcours.mockResolvedValue({ items: [item()] });
    mount(CompteParcours); await screen.findByTestId('parcours-item');
    expect(screen.queryByTestId('parcours-plan')).toBeNull(); expect(screen.queryByTestId('parcours-records')).toBeNull();
  });
});

describe('after a self-declared unfavourable answer', () => {
  const negative = (o = {}) => item({ status: 'DECISION_NEGATIVE', ...o });
  it('« Que faire ensuite ? »: the record’s contact section when it has one, the search and human help — never an entitlement or an outcome', async () => {
    api.listParcours.mockResolvedValue({ items: [negative({ itemCodes: ['aide:a1', 'dispositif:x1'], records: [{ code: 'aide:a1', type: 'aide', available: true, title: 'Aide au logement', href: '/aides/apl', contact: true },
      { code: 'dispositif:x1', type: 'dispositif', available: true, title: 'Fonds local', href: '/dispositifs/fonds-local', contact: false }] })] });
    mount(CompteParcours);
    const block = await screen.findByTestId('parcours-next');
    expect(screen.getByRole('heading', { name: 'Que faire ensuite ?' })).toBeInTheDocument();
    expect(block).toHaveTextContent('Vous avez indiqué une réponse défavorable'); expect(block).toHaveTextContent('ne connaît pas la décision de l’organisme');
    expect(screen.getAllByTestId('parcours-next-record').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Où s’adresser, d’après la fiche', '/aides/apl#heading-ou-demander'], ['Relire la fiche', '/dispositifs/fonds-local']]);
    expect(screen.getByTestId('parcours-next-search')).toHaveAttribute('href', `/recherche?q=${encodeURIComponent('Aide au logement')}`);
    expect(screen.getByTestId('parcours-next-structures')).toHaveAttribute('href', '/structures');
    expect(screen.getByTestId('parcours-next-human')).toHaveAttribute('href', '/demande-aide');
    const text = block.textContent;
    expect(claimsEntitlement(text)).toBe(false);
    expect(text).not.toMatch(/vous avez droit|vous pouvez contester|recours (est|sera) (possible|accepté)|vous obtiendrez|sera accordé|délai de (deux|2) mois/i);
    expect(screen.getByTestId('parcours-item-status')).toHaveTextContent('indiquée par vous');   // the status stays self-declared
    expect(screen.getByTestId('parcours-done')).toContainElement(block);
  });
  it('without a record, or with a withdrawn one: the search and human help only; in the public beta the closed help form is not offered', async () => {
    env.frontendEnv.flags.publicBeta = true;
    api.listParcours.mockResolvedValue({ items: [negative({ available: false, itemCodes: ['aide:a1'], records: [{ code: 'aide:a1', type: 'aide', available: false, title: null, href: null, contact: false }] })] });
    mount(CompteParcours);
    await screen.findByTestId('parcours-next');
    expect(screen.queryByTestId('parcours-next-record')).toBeNull();
    expect(screen.getByTestId('parcours-next-search')).toBeInTheDocument(); expect(screen.getByTestId('parcours-next-structures')).toBeInTheDocument();
    expect(screen.queryByTestId('parcours-next-human')).toBeNull();
  });
  it('no such block for a favourable answer, a closed step or a step in progress', async () => {
    api.listParcours.mockResolvedValue({ items: [item({ id: 'a', status: 'DECISION_POSITIVE' }), item({ id: 'b', status: 'CLOSED' }), item({ id: 'c', status: 'SUBMITTED' })] });
    mount(CompteParcours); await screen.findAllByTestId('parcours-item');
    expect(screen.queryByTestId('parcours-next')).toBeNull();
  });
});
