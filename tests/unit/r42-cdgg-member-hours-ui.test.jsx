// @vitest-environment jsdom
/* global document */
/**
 * R42-CDGG — the « working hours per professional » panel in French, English and Arabic: structure hours shown, « follow the structure » by default,
 * weekly ranges and dated exceptions edited and sent as the server expects, the server's validation sentence shown, appointments kept outside the new
 * hours listed, a plain member sees only themself; axe rules. jsdom: no layout.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('@/api/pro-rdv-client', () => ({ proRdvClient: { hours: api } }));
import MemberHoursPanel from '../../src/components/rdv/MemberHoursPanel.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const VIEW = (over = {}) => ({ timezone: 'Europe/Paris', canManageOthers: true, structureHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 2, startTime: '14:00', endTime: '17:00' }],
  members: [{ id: 'm1', label: 'Alix Fictive', mine: true, hours: { weekly: null, exceptions: [] } }, { id: 'm2', label: 'Brune Fictive', mine: false, hours: { weekly: [{ weekday: 3, startTime: '10:00', endTime: '11:00' }], exceptions: [] } }], ...over });
const axeOk = async () => { const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };
afterEach(async () => { cleanup(); vi.clearAllMocks(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('MemberHoursPanel', () => {
  it('French: follows the structure by default; own weekly hours and a dated unavailability are sent; kept appointments are listed', async () => {
    api.get.mockResolvedValue(VIEW());
    api.save.mockResolvedValue({ ok: true, appointmentsOutsideHours: [{ id: 'a1', startAt: '2026-11-10T09:00:00.000Z' }] });
    render(h('main', null, h(MemberHoursPanel)));
    await screen.findByTestId('pro-member-hours');
    expect(screen.getByTestId('pro-member-hours-structure')).toHaveTextContent('Lundi 09:00–12:00 · Mardi 14:00–17:00');
    expect(screen.getByTestId('pro-member-hours-follow')).toBeChecked();
    await axeOk();
    fireEvent.click(screen.getByTestId('pro-member-hours-follow'));   // starts from the structure's hours
    expect(screen.getByLabelText('Début, Lundi')).toHaveValue('09:00');
    fireEvent.click(screen.getByTestId('pro-member-hours-add-exception'));
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Au (inclus)'), { target: { value: '2026-12-31' } });
    await axeOk();
    fireEvent.click(screen.getByTestId('pro-member-hours-save'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][0]).toEqual({ memberId: 'm1', weekly: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 2, startTime: '14:00', endTime: '17:00' }],
      exceptions: [{ kind: 'UNAVAILABLE', from: '2026-12-01', to: '2026-12-31', startTime: null, endTime: null }] });
    expect(await screen.findByTestId('pro-member-hours-outside')).toHaveTextContent('1 rendez-vous déjà pris en dehors de ces horaires reste maintenu');
    expect(screen.getByTestId('pro-member-hours-saved')).toBeInTheDocument();
  });

  it('a manager switches to a colleague; the server\'s sentence is shown on a refusal', async () => {
    api.get.mockResolvedValue(VIEW());
    api.save.mockRejectedValue(Object.assign(new Error('x'), { status: 400, payload: { error: 'Deux plages du même jour se chevauchent.' } }));
    render(h('main', null, h(MemberHoursPanel)));
    const select = await screen.findByTestId('pro-member-hours-member');
    fireEvent.change(select, { target: { value: 'm2' } });
    expect(screen.getByLabelText('Début, Mercredi')).toHaveValue('10:00');
    fireEvent.click(screen.getByTestId('pro-member-hours-save'));
    expect(await screen.findByTestId('pro-member-hours-error')).toHaveTextContent('Deux plages du même jour se chevauchent.');
    expect(api.save.mock.calls[0][0].memberId).toBe('m2');
  });

  it('a plain member: no member selector, only their own hours', async () => {
    api.get.mockResolvedValue(VIEW({ canManageOthers: false, members: [VIEW().members[0]] }));
    render(h('main', null, h(MemberHoursPanel)));
    await screen.findByTestId('pro-member-hours');
    expect(screen.queryByTestId('pro-member-hours-member')).toBeNull();
    expect(document.body.textContent).not.toContain('Brune');
  });

  for (const [code, title, rtl] of [['en', 'Working hours per professional', false], ['ar', 'ساعات العمل لكل مختص', true]]) {
    it(`${code}: translated, no French sentence left, axe rules pass`, async () => {
      await act(async () => { await setLanguage(code, { persist: false }); });
      api.get.mockResolvedValue(VIEW());
      render(h('main', null, h(MemberHoursPanel)));
      expect(await screen.findByText(title)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('pro-member-hours-follow'));
      fireEvent.click(screen.getByTestId('pro-member-hours-add-exception'));
      expect(document.body.textContent).not.toMatch(/Horaires|Ajouter|Indisponible|Enregistrer/);
      if (rtl) expect(document.documentElement.getAttribute('dir')).toBe('rtl');
      await axeOk();
    });
  }
});
