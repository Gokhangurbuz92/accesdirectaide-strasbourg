// @vitest-environment jsdom
/**
 * DTA S8 — professional opening hours (PUT /api/pro/availability + the Disponibilités screen).
 * Before S8: a malformed range ("9h-12h", "12:00-09:00") was DROPPED silently and the save answered 200 (the professional believed the day was open); overlapping ranges were
 * stored; the replace was delete-then-insert outside a transaction (a failed insert left the structure with no availability, two saves could interleave); the screen had no
 * input labels, no success message, no load-error state and unaccented copy.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ calls: [], failInsert: false, rows: [] }));

vi.mock('../../src/db/index.js', () => {
  const tx = {
    execute: async () => { S.calls.push('lock'); },
    delete: () => ({ where: async () => { S.calls.push('delete'); } }),
    insert: () => ({ values: async (v) => { if (S.failInsert) throw new Error('insert failed'); S.calls.push(['insert', v.length]); } }),
  };
  return { db: { transaction: async (fn) => { S.calls.push('begin'); try { const r = await fn(tx); S.calls.push('commit'); return r; } catch (e) { S.calls.push('rollback'); throw e; } }, query: { ProAvailabilityRule: { findMany: async () => S.rows } } } };
});
const audit = vi.hoisted(() => ({ calls: [] }));
// R14: an opening-hours change is journaled (logProAudit)
// R24 (owner decision R18.5): the opening hours are written by the structure's administrator (or a delegated member) — the context is the administrator's
vi.mock('../../api/_utils/auth.js', () => ({ AUTH_ROLE: { STRUCTURE_ADMIN: 'STRUCTURE_ADMIN', SUPERADMIN: 'SUPERADMIN', PRO: 'PRO' }, requireProStructureContext: () => ({ structureId: 'S1', userId: 'U1', role: 'STRUCTURE_ADMIN' }), requireProAuth: (h) => h, logProAudit: async (...a) => { audit.calls.push(a); } }));
vi.mock('../../api/_utils/with-pro-rdv-handler.js', () => ({ withProRdvHandler: (_n, h) => h }));

import handler, { findInvalidSlotsJson, findOverlap } from '../../api/_handlers/pro/availability.js';
import ProAvailability from '../../src/pages/pro/Availability.jsx';
import { findInvalidRange } from '../../src/lib/availabilityRanges.js';

const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
const put = async (body) => { const r = mk(); await handler({ method: 'PUT', body, headers: {} }, r); return r; };
beforeEach(() => { S.calls.length = 0; S.failInsert = false; S.rows = []; });

describe('PUT /api/pro/availability', () => {
  it.each([
    [{ mon: ['9h-12h'] }, /Plage invalide « 9h-12h » \(lundi\)/],
    [{ tue: ['12:00-09:00'] }, /la fin doit être après le début/],
    [{ wed: ['09:00-09:00'] }, /la fin doit être après le début/],
    [{ thu: ['24:00-25:00'] }, /Plage invalide/],
    [{ fri: ['09:00-12:00', '11:00-14:00'] }, /se chevauchent le vendredi/],
    [{ funday: ['09:00-12:00'] }, /Jour inconnu/],
    [{ sat: 'not-a-list' }, /doivent être une liste/],
  ])('%j is refused with 400 and a specific message, and nothing is written', async (slots, message) => {
    const r = await put({ slots_json: slots });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(message);
    expect(S.calls).toEqual([]);
  });
  it('a valid week (touching ranges allowed, blank rows ignored) is saved in ONE transaction under an advisory lock, delete before insert', async () => {
    const r = await put({ slots_json: { mon: ['09:00-12:00', '12:00-14:00', '  '], tue: [], sun: ['10:00-11:30'] }, timezone: 'Europe/Paris' });
    expect(r.statusCode).toBe(200);
    expect(S.calls).toEqual(['begin', 'lock', 'delete', ['insert', 3], 'commit']);
    expect(r.body.slots_json.mon).toEqual(['09:00-12:00', '12:00-14:00']);
  });
  it('closing every day is a legitimate save: delete only, no insert', async () => {
    const r = await put({ slots_json: { mon: [] } });
    expect(r.statusCode).toBe(200);
    expect(S.calls).toEqual(['begin', 'lock', 'delete', 'commit']);
    // R14: even an emptied schedule leaves a trace (who, which organization, how many rules)
    expect(audit.calls.at(-1).slice(0, 4)).toEqual(['RDV_AVAILABILITY_UPDATED', 'U1', 'S1', { rules: 0 }]);
  });
  it('a failing insert rolls the delete back (the previous opening hours survive)', async () => {
    S.failInsert = true;
    await expect(put({ slots_json: { mon: ['09:00-12:00'] } })).rejects.toThrow('insert failed');
    expect(S.calls).toEqual(['begin', 'lock', 'delete', 'rollback']);
  });
  it('rules mode: an impossible clock time is a 400 (it used to be an unhandled 500)', async () => {
    const r = await put({ rules: [{ weekday: 1, startTime: '25:00', endTime: '26:00' }] });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(/Horaire invalide/);
  });
  it('helpers: findInvalidSlotsJson / findOverlap', () => {
    expect(findInvalidSlotsJson({ mon: ['09:00-12:00', ''] })).toBeNull();
    expect(findOverlap([{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 2, startTime: '09:00', endTime: '12:00' }])).toBeNull();
    expect(findOverlap([{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '11:59', endTime: '13:00' }])).toMatch(/lundi/);
  });
});

describe('client mirror of the rule', () => {
  it('accepts valid and blank, refuses malformed / reversed / overlapping', () => {
    expect(findInvalidRange(['09:00-12:00', '', '14:00-17:30'], 'Lundi')).toBeNull();
    expect(findInvalidRange(['9h-12h'], 'Lundi')).toMatch(/Plage invalide/);
    expect(findInvalidRange(['18:00-17:00'], 'Lundi')).toMatch(/fin doit être après/);
    expect(findInvalidRange(['09:00-12:00', '11:00-13:00'], 'Lundi')).toMatch(/chevauchent/);
  });
  it('agrees with the server on a table of cases', () => {
    const cases = [['09:00-12:00'], ['9:00-12:00'], ['09:00-9:30x'], ['23:59-23:59'], ['00:00-23:59'], ['09:00-12:00', '12:00-13:00'], ['09:00-12:00', '11:59-13:00']];
    for (const c of cases) {
      const server = findInvalidSlotsJson({ mon: c }) || findOverlap(c.filter((x) => /^\d\d:\d\d-\d\d:\d\d$/.test(x)).map((x) => ({ weekday: 1, startTime: x.slice(0, 5), endTime: x.slice(6) })));
      expect(Boolean(findInvalidRange(c, 'Lundi')), JSON.stringify(c)).toBe(Boolean(server));
    }
  });
});

describe('Disponibilités screen', () => {
  const answer = (status, body) => Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  beforeEach(() => { window.localStorage.setItem('pro_token', 'SYNTHETIC'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

  it('load error: an alert and a working retry (no endless skeleton, no empty week presented as real)', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(() => (++n === 1 ? answer(500, { error: 'boom' }) : answer(200, { slots_json: { mon: ['09:00-12:00'] } }))));
    render(createElement(ProAvailability));
    await waitFor(() => expect(screen.getByTestId('availability-load-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('availability-retry'));
    await waitFor(() => expect(screen.getByLabelText('Lundi, plage 1 (HH:MM-HH:MM)')).toHaveValue('09:00-12:00'));
  });
  it('every range input and button has an accessible name; saving shows a polite confirmation and the server-stored value', async () => {
    const fetchMock = vi.fn((url, init) => (init && init.method === 'PUT' ? answer(200, { ok: true, slots_json: { mon: ['09:00-12:00'] } }) : answer(200, { slots_json: { mon: ['09:00-12:00'] } })));
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(ProAvailability));
    await waitFor(() => expect(screen.getByLabelText('Lundi, plage 1 (HH:MM-HH:MM)')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Supprimer la plage 1 du lundi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une plage le mardi' })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Disponibilités/);
    fireEvent.click(screen.getByTestId('availability-save'));
    await waitFor(() => expect(screen.getByText('Disponibilités enregistrées.')).toBeInTheDocument());
    expect(screen.getByTestId('availability-status')).toHaveAttribute('role', 'status');
    const put = fetchMock.mock.calls.find(([, init]) => init && init.method === 'PUT');
    expect(put[0]).toBe('/api/pro/availability');
    expect(JSON.parse(put[1].body).slots_json.mon).toEqual(['09:00-12:00']);
  });
  it('a malformed range is refused BEFORE any request, naming the day; editing clears the message', async () => {
    const fetchMock = vi.fn(() => answer(200, { slots_json: { mon: ['09:00-12:00'] } }));
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(ProAvailability));
    const input = await screen.findByLabelText('Lundi, plage 1 (HH:MM-HH:MM)');
    fireEvent.change(input, { target: { value: '9h-12h' } });
    fireEvent.click(screen.getByTestId('availability-save'));
    expect(screen.getByTestId('availability-error')).toHaveTextContent('Plage invalide « 9h-12h » (Lundi)');
    expect(fetchMock.mock.calls.filter(([, init]) => init && init.method === 'PUT')).toHaveLength(0);
    fireEvent.change(input, { target: { value: '09:00-12:00' } });
    expect(screen.queryByTestId('availability-error')).toBeNull();
  });
  it('a server refusal (400) shows the server sentence; 401 says the session expired; a 500 stays neutral', async () => {
    for (const [status, body, text] of [[400, { error: 'Plages qui se chevauchent le lundi : 09:00-12:00 et 11:00-13:00.' }, 'se chevauchent le lundi'], [401, { error: 'Unauthorized' }, 'session a expiré'], [500, { error: 'stack trace here' }, "Impossible d'enregistrer"]]) {
      vi.stubGlobal('fetch', vi.fn((url, init) => (init && init.method === 'PUT' ? answer(status, body) : answer(200, { slots_json: { mon: ['09:00-12:00'] } }))));
      const { unmount } = render(createElement(ProAvailability));
      await screen.findByLabelText('Lundi, plage 1 (HH:MM-HH:MM)');
      fireEvent.click(screen.getByTestId('availability-save'));
      await waitFor(() => expect(screen.getByTestId('availability-error')).toHaveTextContent(text));
      expect(screen.getByTestId('availability-error').textContent).not.toMatch(/stack trace/);
      unmount();
    }
  });
});
