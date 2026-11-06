/**
 * R47 finish — the pure rules of: a professional's public display name (api/_services/pro-public-profile.js), a move by the structure
 * (api/_services/rdv-pro-reschedule.js proMoveRefusal, cancel reason codes), the routes / capability / validation registrations, and the calendar
 * SEQUENCE that counts the structure's moves (api/_services/appointment-notices.js buildCitizenNoticeMail).
 */
import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX, JOB_TITLE_MAX, validatePublicProfile } from '../../api/_services/pro-public-profile.js';
import { CANCEL_REASONS, cancelReasonCode, proMoveRefusal } from '../../api/_services/rdv-pro-reschedule.js';
import { capabilitiesOfRoute } from '../../api/_utils/capabilities.js';
import { validationRegistry } from '../../api/_utils/validation-registry.js';
import { buildCitizenNoticeMail } from '../../api/_services/appointment-notices.js';
import { teamMoveCount } from '../../api/_services/rdv-team-moves.js';

describe('R47 public display name — validation', () => {
  const ok = (displayName, jobTitle) => validatePublicProfile({ displayName, jobTitle });
  it('accepts names in every interface script, trimmed, NFC, inner spaces collapsed', () => {
    expect(ok('  Camille   D. ', 'Conseillère emploi')).toEqual({ ok: true, value: { displayName: 'Camille D.', jobTitle: 'Conseillère emploi' } });
    for (const n of ['Zeynep Yılmaz', 'محمد العلي', 'Олена Коваль', 'Jörg Müller-Lüdenscheidt', 'Anne-Marie O’Neill', 'Équipe (accueil) & co']) expect(ok(n).ok, n).toBe(true);
    const decomposed = 'José';   // « José » with a combining accent
    expect(ok(decomposed)).toMatchObject({ ok: true, value: { displayName: 'José' } });
  });
  it('empty or missing = removed (null), which makes the member not selectable by name', () => {
    expect(ok('', '')).toEqual({ ok: true, value: { displayName: null, jobTitle: null } });
    expect(ok(undefined, null)).toEqual({ ok: true, value: { displayName: null, jobTitle: null } });
  });
  it('length bounds (code points, not UTF-16 units)', () => {
    expect(ok('A')).toMatchObject({ ok: false, field: 'displayName', code: 'DISPLAYNAME_TOO_SHORT' });
    expect(ok('a'.repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(ok('a'.repeat(DISPLAY_NAME_MAX + 1))).toMatchObject({ ok: false, code: 'DISPLAYNAME_TOO_LONG' });
    expect(ok('Camille', 'b'.repeat(JOB_TITLE_MAX + 1))).toMatchObject({ ok: false, field: 'jobTitle', code: 'JOBTITLE_TOO_LONG' });
  });
  it('no HTML, no markup, no control character, no e-mail address, no link, no non-string', () => {
    for (const bad of ['<b>Camille</b>', 'Camille<script>', 'a"onmouseover=x', 'camille@example.test', 'https://exemple.fr', 'www.exemple', 'Camille exemple.fr', 'Ca\u0000mille', '-Camille', '{{name}}', 'Camille; DROP']) {
      expect(ok(bad), bad).toMatchObject({ ok: false, field: 'displayName', code: 'DISPLAYNAME_INVALID' });
    }
    expect(ok('Camille', '<i>x</i>')).toMatchObject({ ok: false, field: 'jobTitle', code: 'JOBTITLE_INVALID' });
    expect(validatePublicProfile({ displayName: 42 })).toMatchObject({ ok: false, code: 'DISPLAYNAME_INVALID' });
    expect(validatePublicProfile({ displayName: ['Camille'] })).toMatchObject({ ok: false, code: 'DISPLAYNAME_INVALID' });
  });
});

describe('R47 move by the structure — refusals (pure, also applied under the locks)', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const future = '2026-11-12T09:00:00.000Z';
  it('a confirmed or booked future appointment can be moved', () => {
    expect(proMoveRefusal({ status: 'confirmed', startAt: future }, { now })).toBeNull();
    expect(proMoveRefusal({ status: 'booked', startAt: future }, { now, expectedStartAt: future })).toBeNull();
  });
  it('a pending request is answered first; inactive, unconfirmed holds and started ones are refused', () => {
    expect(proMoveRefusal({ status: 'requested', startAt: future }, { now })?.body.code).toBe('REQUEST_PENDING');
    for (const status of ['cancelled', 'refused', 'expired', 'done', 'no_show', 'pending']) expect(proMoveRefusal({ status, startAt: future }, { now })?.body.code, status).toBe('APPOINTMENT_NOT_ACTIVE');
    expect(proMoveRefusal({ status: 'confirmed', startAt: future, guestHoldExpiresAt: future }, { now })?.body.code).toBe('APPOINTMENT_NOT_ACTIVE');
    expect(proMoveRefusal({ status: 'confirmed', startAt: '2026-11-10T09:59:00Z' }, { now })?.body.code).toBe('APPOINTMENT_STARTED');
  });
  it('a time changed since the screen was loaded is refused (reload)', () => {
    expect(proMoveRefusal({ status: 'confirmed', startAt: future }, { now, expectedStartAt: '2026-11-12T10:00:00.000Z' })?.body.code).toBe('APPOINTMENT_CHANGED');
    expect(proMoveRefusal({ status: 'confirmed', startAt: future }, { now, expectedStartAt: 'not-a-date' })?.body.code).toBe('APPOINTMENT_CHANGED');
  });
  it('the cancellation journal keeps a fixed reason code only', () => {
    for (const c of CANCEL_REASONS) expect(cancelReasonCode(c)).toBe(c);
    for (const c of [undefined, '', 'free text by the team', 'NO_CAPACITY', 42]) expect(cancelReasonCode(c)).toBe('NOT_GIVEN');
  });
});

describe('R47 registrations', () => {
  it('the profile is a pro-account route, the move a pro-agenda route', () => {
    expect(capabilitiesOfRoute('pro/profile')).toEqual(['pro.account']);
    expect(capabilitiesOfRoute('pro/appointments/reschedule')).toEqual(['pro.agenda']);
  });
  it('both routes exist and their bodies are validated at the API entry', async () => {
    const text = (await import('node:fs')).readFileSync(new URL('../../api/routes.js', import.meta.url), 'utf8');
    expect(text).toContain("path: 'pro/profile', match: 'exact'");
    expect(text).toContain("path: 'pro/appointments/reschedule', match: 'exact'");
    const r = validationRegistry['pro/appointments/reschedule'];
    expect(r.safeParse({ id: 'a1', startAt: '2026-11-12T09:00:00Z' }).success).toBe(true);
    expect(r.safeParse({ id: '', startAt: 'x' }).success).toBe(false);
    expect(r.safeParse({ id: 'a1' }).success).toBe(false);
    const p = validationRegistry['pro/profile'];
    expect(p.safeParse({ displayName: 'Camille', jobTitle: null }).success).toBe(true);
    expect(p.safeParse({ displayName: 'x'.repeat(500) }).success).toBe(false);
    expect(p.safeParse({ memberId: 'y'.repeat(101) }).success).toBe(false);
  });
});

describe('R47 calendar SEQUENCE counts the structure’s moves', () => {
  const appt = { id: 'appt-r47', structureId: 's1', citizenUserId: 'c1' };
  const message = { subject: 's', text: 't', calendar: { appointmentId: 'appt-r47', startAt: new Date('2026-11-12T09:00:00Z'), endAt: new Date('2026-11-12T10:00:00Z'), structureName: 'S', serviceName: 'Rendez-vous', sequence: 1 } };
  const seqOf = (mail) => Number(/SEQUENCE:(\d+)/.exec(String(mail.attachments[0].content))?.[1]);
  it('reduced level: person moves + journaled team moves', async () => {
    const db = { execute: async () => ({ rows: [{ n: 2 }] }) };
    const mail = await buildCitizenNoticeMail(appt, 'RESCHEDULED', message, { lang: 'fr', to: 'p@example.test', resolveSensitivity: () => 'ordinary', db });
    expect(mail.level).toBe('reduced');
    expect(seqOf(mail)).toBe(3);
    const without = await buildCitizenNoticeMail(appt, 'RESCHEDULED', message, { lang: 'fr', to: 'p@example.test', resolveSensitivity: () => 'ordinary' });
    expect(seqOf(without)).toBe(1);
  });
  it('minimal level (the default): no calendar file at all', async () => {
    const mail = await buildCitizenNoticeMail(appt, 'RESCHEDULED', message, { lang: 'fr', to: 'p@example.test', resolveSensitivity: () => 'unknown', db: { execute: async () => ({ rows: [{ n: 5 }] }) } });
    expect(mail.level).toBe('minimal'); expect(mail.attachments).toEqual([]);
  });
  it('an unreadable journal counts nothing (never throws)', async () => {
    expect(await teamMoveCount('x', { execute: async () => { throw new Error('down'); } })).toBe(0);
    expect(await teamMoveCount('x', {})).toBe(0);
    expect(await teamMoveCount('', { execute: async () => ({ rows: [{ n: 3 }] }) })).toBe(0);
  });
});
