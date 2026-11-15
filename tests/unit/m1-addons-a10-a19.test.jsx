// @vitest-environment jsdom
/**
 * Add-ons to M1 from the public / citizen reconciliation of 15/11/2026:
 *  A-10 — a place (structure) and a guide page can become a step of Mon Parcours (the server accepted aide / démarche / dispositif / guide only, and the
 *         button was mounted on three pages only);
 *  A-19 — a Mon Parcours deadline can never be reminded by SMS (that job texts only a verified account number and nothing verifies a number; no SMS
 *         provider is approved, phone verification is deliberately not built): the screens no longer offer what cannot be sent — « SMS × rappels » is
 *         open only where appointments are, it says that it concerns appointments only, and the deadline form names the channel that works.
 * The server rules on a real PostgreSQL: tests/integration/m1-addons-a10-a19-db.test.js.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn(), getProfile: vi.fn(), setPreference: vi.fn(), updateProfile: vi.fn(), listGrants: vi.fn() }));
const authMe = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({ frontendEnv: null }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error { constructor(m, s, c) { super(m); this.status = s; this.code = c; } } }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe } }));
vi.mock('../../src/config/env.js', async (importOriginal) => { const real = await importOriginal(); env.frontendEnv = { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, publicBeta: false } }; return { ...real, frontendEnv: env.frontendEnv }; });
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import AddToParcoursButton from '../../src/components/AddToParcoursButton.jsx';
import CompteParcours from '../../src/pages/CompteParcours.jsx';
import CompteProfil from '../../src/pages/CompteProfil.jsx';
import { notificationOptionOpen, notificationOptionsOpen, smsReminderOpen, setPreference, NOTIFICATION_OPTION_CLOSED } from '../../api/_services/citizen-account.js';
import { capabilityOpen } from '../../api/_utils/capabilities.js';

const mount = (C, props = {}) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, h(C, props)))));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); authMe.mockReset(); api.listShares.mockResolvedValue({ shares: [] }); api.parcoursHistory.mockResolvedValue({ events: [] }); env.frontendEnv.flags.publicBeta = false; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('A-10 — a place or a guide page becomes a step', () => {
  it('the server accepts « structure » among the record types, and still refuses any other type before touching the database', async () => {
    const { addManualItem, PARCOURS_RECORD_TYPES } = await import('../../api/_services/mon-espace.js');
    expect(PARCOURS_RECORD_TYPES).toEqual(['aide', 'demarche', 'dispositif', 'guide', 'structure']);
    for (const type of ['actualite', 'Structure', 'structures', 'organisation', '']) expect((await addManualItem('u1', { records: [{ type, id: 's1' }] })).code, type).toBe('INVALID_RECORDS');
    // a well-formed structure record passes the input validation: the next thing the service does is read the database (the double throws)
    await expect(addManualItem('u1', { records: [{ type: 'structure', id: 's1' }] })).rejects.toThrow('database touched');
    await expect(addManualItem('u1', { records: [{ type: 'guide', id: 'g1' }] })).rejects.toThrow('database touched');
  });
  it('the control sends a structure and a guide like any other record', async () => {
    authMe.mockResolvedValue({ session: { kind: 'user' }, user: { email: 'x@example.test' } }); api.parcours.mockResolvedValue({ added: true });
    mount(AddToParcoursButton, { type: 'structure', id: 'st-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à mon parcours' }));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'add', records: [{ type: 'structure', id: 'st-1' }] }));
    cleanup(); api.parcours.mockClear();
    mount(AddToParcoursButton, { type: 'guide', id: 'mon-guide' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à mon parcours' }));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'add', records: [{ type: 'guide', id: 'mon-guide' }] }));
  });
  it('the place page and the guide page mount the control (as the aide, démarche and dispositif pages do)', () => {
    const src = (f) => fs.readFileSync(`src/pages/${f}`, 'utf8');
    expect(src('StructureDetail.jsx')).toMatch(/<AddToParcoursButton type="structure" id=\{structure\.id\}/);
    expect(src('GuideDetail.jsx')).toMatch(/<AddToParcoursButton type="guide" id=\{guide\.slug \|\| slug\}/);
    for (const [f, type] of [['AideDetail.jsx', 'aide'], ['DemarcheDetail.jsx', 'demarche'], ['DispositifDetail.jsx', 'dispositif']]) expect(src(f)).toContain(`<AddToParcoursButton type="${type}"`);
  });
  it('a step that points at a place shows its name with a link to its page, and a withdrawn place is flagged like any record', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [
      { id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aller à la permanence', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: ['structure:st-1'], available: true, plan: null, step: null, dependsOn: null, waiting: false,
        records: [{ code: 'structure:st-1', type: 'structure', available: true, title: 'Maison France services de test', href: '/structures/maison-test', contact: true }] },
      { id: 'p2', origin: 'MANUAL', stepKind: 'custom', title: 'Lieu retiré', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: ['structure:st-2'], available: false, plan: null, step: null, dependsOn: null, waiting: false,
        records: [{ code: 'structure:st-2', type: 'structure', available: false, title: null, href: null, contact: false }] }] });
    mount(CompteParcours);
    expect(await screen.findByRole('link', { name: 'Maison France services de test' })).toHaveAttribute('href', '/structures/maison-test');
    expect(screen.getByTestId('parcours-record-unavailable')).toHaveTextContent('Cette fiche n’est plus disponible.');
  });
});

describe('A-19 — an SMS reminder is offered only where one can be sent', () => {
  // the restricted beta with the accounts surface in its full scope: Mon Parcours is open, appointments are not; the number is collected by a separate decision
  const PARCOURS_ONLY = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_CAPABILITIES_OPEN: 'citizen.parcours', ADA_CITIZEN_PHONE_COLLECTION: 'open' };
  it('the fact behind it: the Parcours reminder texts only a verified account number, and no code ever verifies one', () => {
    expect(fs.readFileSync('api/_handlers/cron/parcours-reminder.js', 'utf8')).toMatch(/CASE WHEN u\."phoneVerifiedAt" IS NOT NULL THEN u\.phone END AS phone/);
    const writers = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'tests') walk(p); } else if (/\.(js|ts)$/.test(e.name) && !/\.test\./.test(e.name)) { const s = fs.readFileSync(p, 'utf8'); for (const m of s.matchAll(/phoneVerifiedAt\s*:\s*([^,}\n]+)/g)) writers.push([p, m[1].trim()]); } } };
    walk('api');
    // the only writer clears it (a changed number is unverified); if a verification is ever built, this test must be revisited together with the offer
    expect(writers).toEqual([['api/_services/email-change.js', 'null']]);
  });
  it('« SMS × rappels » is open only where the number is collected AND appointments are open; Mon Parcours alone does not open it', () => {
    expect(capabilityOpen('citizen.parcours', PARCOURS_ONLY)).toBe(true); expect(capabilityOpen('citizen.booking', PARCOURS_ONLY)).toBe(false);
    expect(notificationOptionsOpen(PARCOURS_ONLY)).toEqual({ sms: true, reminder: true, marketing: false });
    expect(smsReminderOpen(PARCOURS_ONLY)).toBe(false);
    expect(notificationOptionOpen('sms', 'reminder', PARCOURS_ONLY)).toBe(false);
    expect(notificationOptionOpen('email', 'reminder', PARCOURS_ONLY)).toBe(true);   // the channel that works stays offered
    expect(notificationOptionOpen('sms', 'service', PARCOURS_ONLY)).toBe(true);
    // the LAB (nothing enforced: appointments open) keeps it, as does an environment where appointments are open
    expect(smsReminderOpen({})).toBe(true); expect(notificationOptionOpen('sms', 'reminder', {})).toBe(true);
    expect(smsReminderOpen({ ...PARCOURS_ONLY, ADA_CITIZEN_PHONE_COLLECTION: '' })).toBe(false);
  });
  it('switching it ON where it cannot be sent is refused before anything is stored', async () => {
    for (const [k, v] of Object.entries(PARCOURS_ONLY)) vi.stubEnv(k, v);
    const out = await setPreference('u1', { channel: 'sms', category: 'reminder', enabled: true, consentGiven: true });
    expect(out).toMatchObject({ ok: false, status: 409, code: NOTIFICATION_OPTION_CLOSED });
  });
  const PREFS = { 'email.service': true, 'email.reminder': true, 'email.marketing': false, 'inapp.service': true, 'inapp.reminder': true, 'inapp.marketing': false, 'sms.service': false, 'sms.reminder': false, 'sms.marketing': false, 'push.service': false, 'push.reminder': false, 'push.marketing': false };
  const account = (o = {}) => ({ profile: { displayName: null, preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false }, household: [], preferences: { ...PREFS }, agePolicy: { accountFeatures: 'ALLOWED', allowed: true },
    notificationOptions: { sms: true, reminder: true, marketing: true }, ...o });
  it('the profile does not offer the box where it cannot be sent, keeps the e-mail reminder, and says what an SMS reminder is about', async () => {
    api.getProfile.mockResolvedValue(account({ smsReminderOpen: false }));
    mount(CompteProfil);
    await screen.findByTestId('prefs-table');
    expect(screen.queryByTestId('pref-sms-reminder')).toBeNull(); expect(screen.queryByTestId('consent-sms-reminder')).toBeNull();
    expect(screen.getByTestId('pref-sms-reminder-closed')).toHaveTextContent('Non proposé');
    expect(screen.getByTestId('pref-email-reminder')).toBeChecked(); expect(screen.getByTestId('pref-sms-service')).toBeInTheDocument();
    expect(screen.getByTestId('prefs-sms-reminder-scope')).toHaveTextContent('Par SMS, les rappels concernent uniquement vos rendez-vous. Les échéances de Mon Parcours sont rappelées par e-mail, jamais par SMS.');
  });
  it('where appointments are open the box is offered with the same explanation; an older server answer keeps the former table', async () => {
    api.getProfile.mockResolvedValue(account({ smsReminderOpen: true }));
    mount(CompteProfil);
    expect(await screen.findByTestId('pref-sms-reminder')).not.toBeChecked();
    expect(screen.getByTestId('prefs-sms-reminder-scope')).toBeInTheDocument();
    cleanup(); api.getProfile.mockResolvedValue(account());
    mount(CompteProfil);
    expect(await screen.findByTestId('pref-sms-reminder')).toBeInTheDocument(); expect(screen.queryByTestId('pref-sms-reminder-closed')).toBeNull();
  });
  it('a box that is already on stays, so that it can be switched off; where SMS is not shown at all the explanation is not either', async () => {
    api.getProfile.mockResolvedValue(account({ smsReminderOpen: false, preferences: { ...PREFS, 'sms.reminder': true } })); api.setPreference.mockResolvedValue({ preferences: { ...PREFS } });
    mount(CompteProfil);
    const box = await screen.findByTestId('pref-sms-reminder');
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(api.setPreference).toHaveBeenCalledWith({ channel: 'sms', category: 'reminder', enabled: false, consentGiven: undefined }));
    cleanup(); api.getProfile.mockResolvedValue(account({ smsReminderOpen: false, notificationOptions: { sms: false, reminder: true, marketing: false } }));
    mount(CompteProfil); await screen.findByTestId('prefs-table');
    expect(screen.queryByTestId('prefs-sms-reminder-scope')).toBeNull(); expect(screen.queryByTestId('pref-sms-reminder-closed')).toBeNull();
  });
  it('the deadline form of a step names the channel that carries the reminder, and says that none is sent by SMS', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [{ id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: [], records: [], available: true, plan: null, step: null, dependsOn: null, waiting: false }] });
    mount(CompteParcours);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    const line = await screen.findByTestId('parcours-reminder-channels');
    expect(line).toHaveTextContent('Rappel d’échéance : par e-mail, selon vos réglages de notification (page Mon profil). Aucun rappel d’échéance n’est envoyé par SMS.');
    await tick();
  });
});
