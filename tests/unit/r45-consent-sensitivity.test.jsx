// @vitest-environment jsdom
/* global document */
/**
 * R45 — ENG-LR-1 (message withdrawal at any time, art. 7(3)) and ENG-LR-2 (sensitive-service booking, art. 9), units without a database:
 * the service-sensitivity module (values, resolution, the CLOSED art. 9 gate, the review-enforcement predicate, the booking rule, the heuristic that only
 * suggests), the administrator route's authorization (citizen / professional / administrator without MFA / without elevation refused), the separate
 * explicit-consent box (never pre-ticked, linked error, six languages, axe), the neutral « contact the structure » notice, and « Mes rendez-vous »
 * (withdrawal offered for a past appointment, the scope of the erasure said; withdrawal of the art. 9 consent).
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));
const api = vi.hoisted(() => ({ myAppointments: vi.fn(), withdrawAppointmentMessage: vi.fn(), withdrawSensitiveConsent: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { user: { getOrCreateFromAppointment: vi.fn() } } }));
vi.mock('@/components/Visio/VisioWindow', () => ({ default: () => null }));

import {
  SENSITIVE_BOOKING_APPROVAL_VALUE, SENSITIVITY, bookingDecision, resolveServiceSensitivity, sensitiveBookingOpen, sensitivityReviewEnforced, suggestSensitivity, treatAsSensitive,
} from '../../api/lib/service-sensitivity.js';
import { bookingRefusal } from '../../src/lib/bookingModalities.js';
import SensitiveConsentField, { ContactStructureNotice } from '../../src/components/rdv/SensitiveConsentField.jsx';
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';
import { setLanguage } from '../../src/i18n/index.js';
import { BOOKING_MESSAGE_CONSENT, BOOKING_MESSAGE_CONSENT_VERSION, BOOKING_MESSAGE_MAX_LENGTH } from '../../api/_utils/rdv-message.js';
import { CATALOGUE } from '../../api/_services/pro-notifications.js';

afterEach(async () => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('../../api/_utils/auth.js'); vi.doUnmock('../../api/_utils/rateLimit.js'); vi.doUnmock('../../api/_services/service-sensitivity-review.js'); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const axeOk = async (ctx = document.body) => { const r = await axe.run(ctx, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };
const OPEN = { ADA_SENSITIVE_BOOKING_APPROVED: SENSITIVE_BOOKING_APPROVAL_VALUE, ADA_HDS_BOOKING_ASSESSED: '1' };
const reviewed = (value) => ({ value, reviewedAt: '2026-11-05T10:00:00.000Z', reviewedBy: 'ops@example.test', reason: 'Revue fictive' });

describe('ENG-LR-1: the consent wording (D3 v2) and the withdrawal notice', () => {
  it('the box says « à tout moment », a new wording version, the 500-character limit kept; the withdrawal notice is in-app only, never e-mailed', () => {
    expect(BOOKING_MESSAGE_CONSENT).toContain('à tout moment');
    expect(BOOKING_MESSAGE_CONSENT).not.toContain('avant le rendez-vous');
    expect(BOOKING_MESSAGE_CONSENT_VERSION).toBe('r45-d3v2-2026-11-05');
    expect(BOOKING_MESSAGE_MAX_LENGTH).toBe(500);
    expect(CATALOGUE.rdv_message_withdrawn).toMatchObject({ category: 'appointments', email: false });
  });
});

describe('ENG-LR-2: api/lib/service-sensitivity.js', () => {
  it('three values; only a complete administrator review resolves to sensitive / ordinary — anything else is unknown', () => {
    expect(SENSITIVITY).toEqual({ SENSITIVE: 'sensitive', ORDINARY: 'ordinary', UNKNOWN: 'unknown' });
    expect(Object.isFrozen(SENSITIVITY)).toBe(true);
    for (const r of [undefined, null, 'ordinary', [], {}, { value: 'ordinary' }, { value: 'ordinary', reviewedAt: 'x', reviewedBy: 'a' }, { value: 'ordinary', reviewedAt: '2026-11-05T10:00:00Z', reviewedBy: ' ' },
      { value: 'SAFE', reviewedAt: '2026-11-05T10:00:00Z', reviewedBy: 'a' }, { value: 'unknown', reviewedAt: '2026-11-05T10:00:00Z', reviewedBy: 'a' }]) {
      expect(resolveServiceSensitivity(r), JSON.stringify(r)).toBe('unknown');
    }
    expect(resolveServiceSensitivity(reviewed('ordinary'))).toBe('ordinary');
    expect(resolveServiceSensitivity(reviewed('sensitive'))).toBe('sensitive');
  });
  it('the art. 9 gate is CLOSED unless the exact approved token AND the HDS assessment are both set', () => {
    expect(sensitiveBookingOpen({})).toBe(false);
    expect(sensitiveBookingOpen({ ADA_SENSITIVE_BOOKING_APPROVED: SENSITIVE_BOOKING_APPROVAL_VALUE })).toBe(false);
    expect(sensitiveBookingOpen({ ADA_HDS_BOOKING_ASSESSED: '1' })).toBe(false);
    for (const v of ['1', 'true', 'yes', `${SENSITIVE_BOOKING_APPROVAL_VALUE} `, 'ART9-EXPLICIT-CONSENT-V1']) expect(sensitiveBookingOpen({ ADA_SENSITIVE_BOOKING_APPROVED: v, ADA_HDS_BOOKING_ASSESSED: '1' }), v).toBe(false);
    expect(sensitiveBookingOpen({ ...OPEN, ADA_HDS_BOOKING_ASSESSED: 'true' })).toBe(false);
    expect(sensitiveBookingOpen(OPEN)).toBe(true);
    expect(sensitiveBookingOpen()).toBe(false);   // the process env of the tests
  });
  it('review enforcement: always on in production / preview (no variable switches it off) and in the restricted beta; off in development / test (LAB)', () => {
    for (const VERCEL_ENV of ['production', 'preview', 'Production']) expect(sensitivityReviewEnforced({ VERCEL_ENV, ADA_SENSITIVITY_REVIEW_ENFORCED: '0', ADA_PUBLIC_BETA_RESTRICTED: '0' }), VERCEL_ENV).toBe(true);
    expect(sensitivityReviewEnforced({ VERCEL_ENV: 'development', ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe(true);
    expect(sensitivityReviewEnforced({ VERCEL_ENV: 'development', ADA_SENSITIVITY_REVIEW_ENFORCED: '1' })).toBe(true);
    expect(sensitivityReviewEnforced({ VERCEL_ENV: 'development', NODE_ENV: 'test' })).toBe(false);
    expect(sensitivityReviewEnforced({})).toBe(false);
  });
  it('the booking rule: sensitive never books while the gate is closed (every environment); unknown is refused where review is enforced; ordinary books', () => {
    const PROD = { VERCEL_ENV: 'production' }; const LAB = { VERCEL_ENV: 'development', NODE_ENV: 'test' };
    expect(bookingDecision('sensitive', PROD)).toEqual({ allowed: false, code: 'SENSITIVE_BOOKING_NOT_OPEN' });
    expect(bookingDecision('sensitive', LAB)).toEqual({ allowed: false, code: 'SENSITIVE_BOOKING_NOT_OPEN' });
    expect(bookingDecision('sensitive', { ...LAB, ...OPEN })).toEqual({ allowed: true, requiresConsent: true });
    expect(bookingDecision('unknown', PROD)).toEqual({ allowed: false, code: 'SERVICE_SENSITIVITY_UNREVIEWED' });
    expect(bookingDecision('unknown', { ...PROD, ...OPEN })).toEqual({ allowed: false, code: 'SERVICE_SENSITIVITY_UNREVIEWED' });
    expect(bookingDecision('anything', PROD)).toEqual({ allowed: false, code: 'SERVICE_SENSITIVITY_UNREVIEWED' });
    expect(bookingDecision('unknown', LAB)).toEqual({ allowed: true, requiresConsent: false });
    expect(bookingDecision('ordinary', PROD)).toEqual({ allowed: true, requiresConsent: false });
    expect([treatAsSensitive('unknown'), treatAsSensitive('sensitive'), treatAsSensitive(undefined), treatAsSensitive('ordinary')]).toEqual([true, true, true, false]);
  });
  it('the heuristic only SUGGESTS « sensitive » or « no_signal » — never a verified value, never « ordinary »', () => {
    expect(suggestSensitivity({ serviceName: 'Consultation en addictologie (CSAPA)' })).toEqual({ suggestion: 'sensitive', matched: ['addict', 'csapa'] });
    expect(suggestSensitivity({ serviceName: 'Dossier MDPH', structure: { type_structure: 'association' } }).suggestion).toBe('sensitive');
    expect(suggestSensitivity({ serviceName: 'Santé mentale — écoute' }).matched).toContain('sante mentale');
    expect(suggestSensitivity({ serviceName: 'Accueil social' })).toEqual({ suggestion: 'no_signal', matched: [] });
    expect(suggestSensitivity({ serviceName: 'Régime alimentaire' }).suggestion).toBe('no_signal');   // « ime » only as a whole word
    expect(suggestSensitivity({}).suggestion).toBe('no_signal');
  });
  it('the booking page maps the refusals: not bookable online → contact the structure; the art. 9 box → its field (never « slot taken »)', () => {
    expect(bookingRefusal(409, { code: 'SENSITIVE_BOOKING_NOT_OPEN' })).toBe('CONTACT_STRUCTURE');
    expect(bookingRefusal(409, { code: 'SERVICE_SENSITIVITY_UNREVIEWED' })).toBe('CONTACT_STRUCTURE');
    expect(bookingRefusal(400, { code: 'SENSITIVE_CONSENT_REQUIRED' })).toBe('SENSITIVE_CONSENT');
    expect(bookingRefusal(409, {})).toBe('SLOT_TAKEN');
  });
});

describe('ENG-LR-2: the administrator review route (MFA + elevation)', () => {
  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; } }; } }); };
  async function route(auth, review = vi.fn(async () => ({ ok: true, previous: 'unknown', value: 'ordinary', reviewedAt: '2026-11-05T10:00:00.000Z' }))) {
    vi.resetModules();
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '192.0.2.9' }));
    vi.doMock('../../api/_utils/auth.js', async (orig) => ({ ...(await orig()), resolveAuthContext: async () => auth }));
    vi.doMock('../../api/_services/service-sensitivity-review.js', () => ({ reviewServiceSensitivity: review, listForReview: async () => ({ structure: { id: 's' }, items: [], reviewComplete: false }) }));
    return { h: (await import('../../api/_handlers/admin/service-sensitivity.js')).default, review };
  }
  const BODY = { action: 'review', structureId: 's1', serviceId: 'v1', value: 'ordinary', reason: 'Accueil social généraliste, revue fictive' };
  const human = { role: 'ADMIN', authType: 'admin_jwt', mfa_verified: true, email: 'ops@example.test' };
  it('citizen, professional, structure administrator and anonymous: 401; administrator without MFA / without elevation: 403; elevated: reviewed, named', async () => {
    for (const auth of [null, { role: 'USER', authType: 'user_session', email: 'c@example.test' }, { role: 'PRO', authType: 'pro_jwt', structureId: 's1' }, { role: 'STRUCTURE_ADMIN', authType: 'pro_jwt', structureId: 's1' }]) {
      const { h, review } = await route(auth);
      const r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: BODY }, r);
      expect(r.code, JSON.stringify(auth)).toBe(401); expect(review).not.toHaveBeenCalled();
    }
    let { h, review } = await route({ ...human, mfa_verified: false });
    let r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: BODY }, r);
    expect([r.code, r.body.error]).toEqual([403, 'HUMAN_MFA_SESSION_REQUIRED']); expect(review).not.toHaveBeenCalled();
    ({ h, review } = await route(human));
    r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: BODY }, r);
    expect([r.code, r.body.error]).toEqual([403, 'ELEVATION_REQUIRED']); expect(review).not.toHaveBeenCalled();
    const elevated = { ...human, elevatedUntil: Math.floor(Date.now() / 1000) + 600, elevationKind: 'jit' };
    ({ h, review } = await route(elevated));
    r = res(); await h({ method: 'GET', url: '/api/admin/service-sensitivity', headers: {} }, r); expect(r.code).toBe(405);
    r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: BODY }, r);
    expect(r.code).toBe(200);
    expect(review).toHaveBeenCalledWith({ structureId: 's1', serviceId: 'v1', value: 'ordinary', reason: BODY.reason, by: 'ops@example.test' });
    r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: { action: 'list', structureId: 's1' } }, r);
    expect([r.code, r.body.gate]).toEqual([200, { sensitiveBookingOpen: false, reviewEnforced: false }]);
    ({ h } = await route(elevated, vi.fn(async () => ({ ok: false, status: 400, code: 'reason_required' }))));
    r = res(); await h({ method: 'POST', url: '/api/admin/service-sensitivity', headers: {}, body: { ...BODY, reason: '' } }, r);
    expect([r.code, r.body.error]).toEqual([400, 'reason_required']);
    const { routes } = await import('../../api/routes.js');
    expect(routes.find((x) => x.path === 'admin/service-sensitivity')).toMatchObject({ match: 'exact' });
  });
});

describe('ENG-LR-2: the separate explicit consent and the neutral notice (six languages, accessible)', () => {
  it('fr: an unticked box with the draft wording; the error is announced and linked; axe passes', async () => {
    const { rerender } = render(h('main', null, h(SensitiveConsentField, { checked: false, onChange: () => {} })));
    const box = screen.getByRole('checkbox', { name: /J’accepte que la plateforme transmette ma demande de rendez-vous à ce service/ });
    expect(box).not.toBeChecked();
    expect(box).not.toHaveAttribute('aria-invalid');
    rerender(h('main', null, h(SensitiveConsentField, { checked: false, onChange: () => {}, error: true })));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toContain(screen.getByTestId('booking-sensitive-consent-error').id);
    expect(document.body.textContent).not.toMatch(/diagnostic|maladie|traitement médical/i);
    await axeOk();
  });
  for (const code of ['en', 'tr', 'ar', 'de', 'uk']) {
    it(`${code}: the consent, its error and the « contact the structure » notice are translated (no French left)`, async () => {
      await lang(code);
      render(h('main', null, h(SensitiveConsentField, { checked: false, onChange: () => {}, error: true }), h(ContactStructureNotice)));
      expect(screen.getByRole('checkbox')).not.toBeChecked();
      expect(document.body.textContent).not.toMatch(/J’accepte|Cochez la case|prise de rendez-vous en ligne/);
      if (code === 'ar') expect(document.documentElement.getAttribute('dir')).toBe('rtl');
      await axeOk();
    });
  }
});

describe('« Mes rendez-vous »: withdrawal at any time', () => {
  const item = (extra) => ({ id: 'a1', state: 'COMPLETED', status: 'DONE', mode: 'IN_PERSON', startsAt: '2026-10-07T08:00:00.000Z', structure: { name: 'Structure fictive', slug: 's' }, service: { id: 's1', name: 'Accueil' }, canCancel: false, canReschedule: false, ...extra });
  it('a PAST appointment still offers the message withdrawal; the panel and the result say what is erased and what stays with the structure', async () => {
    api.myAppointments.mockReset().mockResolvedValueOnce({ appointments: [item({ hasMessage: true, canWithdrawMessage: true })] }).mockResolvedValueOnce({ appointments: [item({ hasMessage: false, canWithdrawMessage: false })] });
    api.withdrawAppointmentMessage.mockReset().mockResolvedValue({ ok: true, hasMessage: false });
    render(h(MemoryRouter, null, h(CompteRendezVous)));
    fireEvent.click(await screen.findByTestId('rdv-message-withdraw'));
    expect(screen.getByTestId('rdv-message-withdraw-scope')).toHaveTextContent('avant ou après le rendez-vous');
    await axeOk(screen.getByTestId('rdv-message'));
    fireEvent.click(screen.getByTestId('rdv-message-withdraw-confirm'));
    await waitFor(() => expect(api.withdrawAppointmentMessage).toHaveBeenCalledWith('a1'));
    expect(await screen.findByText('Votre message a été effacé. La structure ne le voit plus.')).toBeInTheDocument();
    expect(screen.getByTestId('rdv-message-withdrawn-scope')).toHaveTextContent('relève de sa responsabilité');
    expect(screen.getByTestId('rdv-message-withdrawn-scope')).toHaveTextContent('demander directement');
  });
  it('the art. 9 consent of a booking is withdrawable in two steps (an upcoming appointment is then cancelled)', async () => {
    api.myAppointments.mockReset().mockResolvedValueOnce({ appointments: [item({ state: 'CONFIRMED', status: 'CONFIRMED', startsAt: '2030-01-07T08:00:00.000Z', canCancel: true, sensitiveConsent: true })] })
      .mockResolvedValueOnce({ appointments: [item({ state: 'CANCELLED', status: 'CANCELLED', startsAt: '2030-01-07T08:00:00.000Z' })] });
    api.withdrawSensitiveConsent.mockReset().mockResolvedValue({ id: 'a1', status: 'CANCELLED' });
    render(h(MemoryRouter, null, h(CompteRendezVous)));
    const btn = await screen.findByTestId('rdv-sensitive-consent-withdraw');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(api.withdrawSensitiveConsent).not.toHaveBeenCalled();
    await axeOk(screen.getByTestId('rdv-sensitive-consent'));
    fireEvent.click(screen.getByTestId('rdv-sensitive-consent-confirm'));
    await waitFor(() => expect(api.withdrawSensitiveConsent).toHaveBeenCalledWith('a1'));
    expect(await screen.findByText(/Votre accord est retiré/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('rdv-sensitive-consent')).toBeNull());
  });
});
