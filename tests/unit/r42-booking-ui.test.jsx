// @vitest-environment jsdom
/* global document */
/**
 * R42-BOOK — the account-required journey pieces in French, English and Arabic: the optional message (owner wording, counter, 500 max), the
 * professional choice (no preference / previous / named — never an e-mail), the suitability check (no health question, wrong-structure alternatives),
 * the age statement (never pre-ticked), the real e-mail outcome (never « sent » by assumption), and the booking page in Mode B (a request is never shown
 * as confirmed) with the axe rules. jsdom: no layout.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ adult: true }) })), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));
import BookingMessageField from '../../src/components/rdv/BookingMessageField.jsx';
import ProfessionalChoice from '../../src/components/rdv/ProfessionalChoice.jsx';
import { SuitabilityQuestions, WrongStructure } from '../../src/components/rdv/SuitabilityCheck.jsx';
import AgeDeclarationPrompt from '../../src/components/rdv/AgeDeclarationPrompt.jsx';
import MailOutcomeNote from '../../src/components/rdv/MailOutcomeNote.jsx';
import PublicBooking from '../../src/pages/PublicBooking.jsx';
import { setLanguage } from '../../src/i18n/index.js';

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const TEAM = { choice: true, professionals: [{ id: 'p_abcdefghijklmnopqrstuv', displayName: 'Camille Fictive', role: 'Conseillère' }], previous: { available: true, displayName: null } };
const pieces = () => h(MemoryRouter, null, h('main', null,
  h(BookingMessageField, { value: 'abc', onChange: () => {} }),
  h(ProfessionalChoice, { team: TEAM, value: 'ANY', onChange: () => {} }),
  h(SuitabilityQuestions, { value: { firstContact: 'no', samePerson: false }, onChange: () => {}, teamChoice: true }),
  h(WrongStructure, { structureSlug: 'structure-fictive', onBack: () => {} }),
  h(AgeDeclarationPrompt, { onDeclared: () => {} }),
  h(MailOutcomeNote, { outcome: 'NO_PROVIDER' })));
const axeOk = async () => { const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };

describe('journey pieces', () => {
  it('French: the owner wording of the optional message, a bounded field, no health question, the age box unticked', async () => {
    render(pieces());
    expect(screen.getByText('Précisez brièvement le motif de votre rendez-vous (facultatif)')).toBeInTheDocument();
    expect(screen.getByText('Indiquez uniquement les informations nécessaires à votre demande. Ne transmettez pas de diagnostic ni de document médical dans ce champ.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '500');
    expect(screen.getByText('3 / 500 caractères')).toBeInTheDocument();
    expect(screen.getByTestId('booking-age-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('booking-age-submit')).toBeDisabled();
    expect(screen.getByTestId('booking-professional-PREVIOUS')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Camille Fictive');
    expect(document.body.textContent).not.toMatch(/@/);
    expect(screen.getByText('Aucune question sur votre santé ou votre situation personnelle n’est posée ici.')).toBeInTheDocument();
    expect(screen.getByText('Chercher une autre structure dans l’annuaire').closest('a')).toHaveAttribute('href', '/structures');
    expect(screen.getByTestId('rdv-mail-outcome')).toHaveTextContent('Aucun e-mail n’a été envoyé');
    await axeOk();
  });
  for (const [code, label, noMail] of [['en', 'Briefly describe the reason for your appointment (optional)', 'No e-mail was sent'], ['ar', 'اذكر باختصار سبب موعدك (اختياري)', 'لم تُرسل أي رسالة']]) {
    it(`${code}: translated, no French sentence left, axe rules pass`, async () => {
      await lang(code);
      render(pieces());
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByTestId('rdv-mail-outcome')).toHaveTextContent(noMail);
      expect(document.body.textContent).not.toMatch(/Précisez|Pas de préférence|Je déclare|Aucun e-mail/);
      await axeOk();
    });
  }
  it('the e-mail note never claims a delivery it does not know', () => {
    for (const [o, re] of [['ACCEPTED_BY_PROVIDER', /pas garantie/], ['TEST_RECORDED', /pas été envoyé/], ['NOT_SENT', /n’a pas pu être envoyé/], [undefined, /Mes rendez-vous/]]) {
      cleanup(); render(h(MailOutcomeNote, { outcome: o }));
      expect(screen.getByTestId('rdv-mail-outcome').textContent).toMatch(re);
      expect(screen.getByTestId('rdv-mail-outcome').textContent).not.toMatch(/a été envoyé à/);
    }
  });
});

describe('booking page, Mode B, team choice', () => {
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const bodies = [];
  const stub = () => vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('/services')) return json(200, { teamChoice: true, items: [{ id: 's1', name: 'Accueil social', durationMinutes: 30, modes: ['IN_PERSON'], confirmation: 'APPROVAL' }] });
    if (u.includes('/team')) return json(200, TEAM);
    if (u.includes('/slots')) return json(200, { confirmation: 'APPROVAL', days: [{ date: '2030-01-07', slots: [{ startAt: '2030-01-07T08:00:00.000Z', endAt: '2030-01-07T08:30:00.000Z' }] }] });
    if (u.includes('/api/rdv/appointments')) { bodies.push(JSON.parse(init.body)); return json(201, { id: 'a1abcdef', status: 'REQUESTED', state: 'REQUESTED', awaitingApproval: true, calendar: null, notification: { email: 'TEST_RECORDED' } }); }
    return json(404, {});
  }));
  it('suitability → service → professional → slot → message → « Envoyer la demande » → « en attente », never « confirmé »', async () => {
    stub();
    render(h(MemoryRouter, { initialEntries: ['/rdv/structure-fictive/booking'] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h(PublicBooking) }))));
    fireEvent.click(await screen.findByLabelText('Non, je l’ai déjà rencontrée'));
    fireEvent.click(screen.getByLabelText('Je souhaite, si possible, revoir la même personne'));
    fireEvent.click(await screen.findByTestId('booking-service-s1'));
    expect(await screen.findByTestId('booking-professional-choice')).toBeInTheDocument();
    expect(screen.getByTestId('booking-professional-PREVIOUS')).toBeChecked();   // « same person » preselects the previous professional
    fireEvent.click(screen.getByTestId('booking-professional-continue'));
    const slot = (await screen.findAllByTestId('booking-slot'))[0];
    fireEvent.click(slot);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dossier logement' } });
    expect(screen.getByTestId('booking-approval-notice')).toBeInTheDocument();
    const send = screen.getByTestId('booking-confirm');
    expect(send).toHaveTextContent('Envoyer la demande de rendez-vous');
    fireEvent.click(send);
    const state = await screen.findByTestId('booking-state');
    expect(state).toHaveTextContent('Demande envoyée : en attente de la structure');
    expect(state).not.toHaveTextContent(/confirmé/i);
    expect(screen.getByTestId('booking-requested-note')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-download-ics')).toBeNull();
    expect(screen.getByTestId('rdv-mail-outcome')).toHaveAttribute('data-outcome', 'TEST_RECORDED');
    expect(bodies[0]).toMatchObject({ structureSlug: 'structure-fictive', serviceId: 's1', professional: 'PREVIOUS', message: 'Dossier logement' });
    expect(bodies[0]).not.toHaveProperty('firstContact');   // the suitability answers are never sent
  });
});
