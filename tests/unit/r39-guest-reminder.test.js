/**
 * R39 — the optional J-1 reminder of an account-free booking: the pure rules (explicit consent only, who may be written to for which notice category,
 * what the cron does with its claim after a pass, bounded retries) and noticeCitizen's decisions with injected dependencies (no database, no network).
 * The database behaviour is proven in tests/integration/r39-guest-reminder-db.test.js.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
  REMINDER_MAX_ATTEMPTS_PER_DAY, guestNoticeDecision, readReminderConsent, reminderClaimOutcome,
} from '../../api/_utils/rdv-guest-core.js';
import { noticeCitizen } from '../../api/_services/appointment-notices.js';
import { encrypt } from '../../api/lib/crypto.js';

const booked = { guestEmail: 'v1:x', guestConfirmedAt: new Date(), guestMailConsentAt: new Date() };

describe('the reminder consent of the hold request', () => {
  it('only an explicit boolean true is a consent (never implied, never a truthy string)', () => {
    expect(readReminderConsent({ reminderConsent: true })).toBe(true);
    for (const v of [false, 'true', 'on', 1, 'yes', null, undefined, {}]) expect(readReminderConsent({ reminderConsent: v }), String(v)).toBe(false);
    expect(readReminderConsent({})).toBe(false);
    expect(readReminderConsent(null)).toBe(false);
    expect(readReminderConsent('reminderConsent')).toBe(false);
  });
});

describe('who may be written to (account-free booking)', () => {
  it("'service' notices need a confirmed booking with the booking-mails consent (R38 unchanged)", () => {
    expect(guestNoticeDecision(booked, 'service')).toBe('SEND');
    expect(guestNoticeDecision({ ...booked, guestConfirmedAt: null }, 'service')).toBe('NO_RECIPIENT');
    expect(guestNoticeDecision({ ...booked, guestMailConsentAt: null }, 'service')).toBe('NO_RECIPIENT');
    expect(guestNoticeDecision({ ...booked, guestEmail: null }, 'service')).toBe('NO_RECIPIENT');
    expect(guestNoticeDecision(null, 'service')).toBe('NO_RECIPIENT');
  });
  it("the J-1 reminder needs ALL three: confirmed, booking-mails consent AND the separate reminder consent; otherwise NO_CONSENT", () => {
    expect(guestNoticeDecision({ ...booked, guestReminderConsentAt: new Date() }, 'reminder')).toBe('SEND');
    expect(guestNoticeDecision(booked, 'reminder')).toBe('NO_CONSENT');
    expect(guestNoticeDecision({ ...booked, guestReminderConsentAt: null }, 'reminder')).toBe('NO_CONSENT');
    // without a confirmed, consented booking there is nobody to remind, whatever the reminder box says
    expect(guestNoticeDecision({ ...booked, guestConfirmedAt: null, guestReminderConsentAt: new Date() }, 'reminder')).toBe('NO_RECIPIENT');
    expect(guestNoticeDecision({ ...booked, guestMailConsentAt: null, guestReminderConsentAt: new Date() }, 'reminder')).toBe('NO_RECIPIENT');
    expect(guestNoticeDecision({ ...booked, guestReminderConsentAt: new Date() }, 'other')).toBe('NO_RECIPIENT');
  });
});

describe('the claim of the J-1 reminder cron after one pass', () => {
  it('closes when something reached its recipient or nothing failed; releases a fully failed pass (retry the same J-1 day)', () => {
    expect(reminderClaimOutcome({ sendFailed: false, reached: 0 })).toBe('close');   // NO_CONSENT / NO_RECIPIENT only: nothing to retry
    expect(reminderClaimOutcome({ sendFailed: false, reached: 1 })).toBe('close');
    // R41-E / G6: the agent reached no longer closes the claim of a person whose e-mail failed (retryable); a permanent refusal does
    expect(reminderClaimOutcome({ sendFailed: true, reached: 1, citizenFailed: true, citizenFailuresToday: 1 })).toBe('release');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 1, citizenFailed: true, citizenRetryable: false, citizenFailuresToday: 1 })).toBe('close');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 0, citizenFailed: true, citizenRetryable: false, citizenFailuresToday: 1 })).toBe('close');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 1, citizenFailed: true, citizenFailuresToday: REMINDER_MAX_ATTEMPTS_PER_DAY })).toBe('close');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 0, citizenFailed: true, citizenFailuresToday: 1 })).toBe('release');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 0 })).toBe('release');   // agent-only failures: unchanged
  });
  it(`bounded: after ${REMINDER_MAX_ATTEMPTS_PER_DAY} failed e-mails the same day the claim is closed`, () => {
    expect(REMINDER_MAX_ATTEMPTS_PER_DAY).toBe(3);
    for (let n = 1; n < REMINDER_MAX_ATTEMPTS_PER_DAY; n += 1) expect(reminderClaimOutcome({ sendFailed: true, reached: 0, citizenFailed: true, citizenFailuresToday: n })).toBe('release');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 0, citizenFailed: true, citizenFailuresToday: REMINDER_MAX_ATTEMPTS_PER_DAY })).toBe('close');
    expect(reminderClaimOutcome({ sendFailed: true, reached: 0, citizenFailed: true, citizenFailuresToday: REMINDER_MAX_ATTEMPTS_PER_DAY + 2 })).toBe('close');
  });
  it('the cron counts the person\'s e-mail like the agent\'s (noop / refused = failure) and only selects tomorrow\'s Paris day', () => {
    const src = fs.readFileSync('api/_handlers/cron/rdv-reminder.js', 'utf8');
    expect(src).toMatch(/parisDayWindow\(new Date\(\), 1\)/);
    expect(src).toMatch(/citizenStatus === 'PROVIDER_ACCEPTED' \|\| citizenStatus === 'TEST_RECORDED'/);
    expect(src).toMatch(/citizenStatus === 'NOT_DELIVERED' \|\| citizenStatus === 'FAILED'/);
    expect(src).toMatch(/reminderClaimOutcome\(/);
    // the claim re-checks the selection (and returns the row as claimed: a consent withdrawn after the selection is honoured)
    expect(src).toMatch(/gte\(ProAppointment\.startAt, tomorrowStart\),\s*lt\(ProAppointment\.startAt, tomorrowEnd\)/);
    // R40 / G10: every column the database has (all of them from migration 0044 on) — still the whole row as claimed
    expect(src).toMatch(/\.returning\(appointmentColumns\(guestSchema\)\);/);
  });
});

describe('noticeCitizen for an account-free booking (injected db / mailer)', () => {
  const ledger = [];
  const db = { insert: () => ({ values: async (v) => { ledger.push(v); } }), select: () => { throw new Error('no account lookup for a guest'); } };
  const out = (outcome) => vi.fn(async () => ({ accepted: true, delivered: outcome !== 'NOT_SENT', provider: outcome === 'TEST_RECORDED' ? 'test' : 'x', outcome }));
  const guest = (extra = {}) => ({ id: `a-${Math.random()}`, citizenUserId: null, guestEmail: encrypt('guest@example.test'), guestConfirmedAt: new Date(), guestMailConsentAt: new Date(), ...extra });
  const msg = { subject: 'Rappel', text: 'Rappel : vous avez rendez-vous demain.' };

  it('REMINDER_J1 with the reminder consent: one e-mail to the sealed address, ledger TEST_RECORDED (never DELIVERED)', async () => {
    const sendMail = out('TEST_RECORDED'); const a = guest({ guestReminderConsentAt: new Date() });
    expect(await noticeCitizen(a, 'REMINDER_J1', msg, { db, sendMail })).toBe('TEST_RECORDED');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'guest@example.test', category: 'appointment-reminder_j1' });
    expect(ledger.at(-1)).toEqual({ appointmentId: a.id, kind: 'REMINDER_J1', recipient: 'citizen', channel: 'email', status: 'TEST_RECORDED' });
  });
  it('REMINDER_J1 without the reminder consent: nothing sent, NO_CONSENT recorded', async () => {
    const sendMail = out('TEST_RECORDED'); const a = guest();
    expect(await noticeCitizen(a, 'REMINDER_J1', msg, { db, sendMail })).toBe('NO_CONSENT');
    expect(sendMail).not.toHaveBeenCalled();
    expect(ledger.at(-1)).toMatchObject({ appointmentId: a.id, kind: 'REMINDER_J1', status: 'NO_CONSENT' });
  });
  it('a noop mailer is NOT_DELIVERED, a provider acceptance PROVIDER_ACCEPTED (mailLedgerStatus)', async () => {
    expect(await noticeCitizen(guest({ guestReminderConsentAt: new Date() }), 'REMINDER_J1', msg, { db, sendMail: out('NOT_SENT') })).toBe('NOT_DELIVERED');
    expect(await noticeCitizen(guest({ guestReminderConsentAt: new Date() }), 'REMINDER_J1', msg, { db, sendMail: out('PROVIDER_ACCEPTED') })).toBe('PROVIDER_ACCEPTED');
  });
  it("'service' notices are unchanged (no reminder consent needed); an unconfirmed hold gets nothing", async () => {
    const sendMail = out('TEST_RECORDED');
    expect(await noticeCitizen(guest(), 'RESCHEDULED', msg, { db, sendMail })).toBe('TEST_RECORDED');
    expect(await noticeCitizen(guest({ guestConfirmedAt: null, guestReminderConsentAt: new Date() }), 'REMINDER_J1', msg, { db, sendMail })).toBe('NO_RECIPIENT');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('the routes and the purge (source pins)', () => {
  it('POST rdv/guest/manage/reminder is routed, checks the token like cancel, and audits without personal data', () => {
    const src = fs.readFileSync('api/_services/rdv-guest.js', 'utf8');
    expect(src).toMatch(/seg\[0\] === 'manage' && seg\[1\] === 'reminder'\) return reminder\(req, res\)/);
    const body = src.slice(src.indexOf('async function reminder('), src.indexOf('/** rdv/guest/<rest>'));
    expect(body).toMatch(/limited\(res, 'RDV_GUEST_MANAGE', `\$\{getClientIp\(req\)\}:\$\{digest\(req\.body\?\.token\)\}`\)/);
    expect(body).toMatch(/await byToken\(req\)/);
    expect(body).toMatch(/RDV_GUEST_REMINDER_CONSENT_GIVEN/);
    expect(body).not.toMatch(/openEmail|guestEmail\b|maskEmail|ip_hash/);
  });
  it('gdpr-purge step 13 (and 13b) clear the reminder consent', () => {
    const src = fs.readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
    const step13 = src.slice(src.indexOf('// 13. Anonymise'), src.indexOf('// 13b.'));
    expect(step13).toMatch(/guestReminderConsentAt: null/);
    expect(src.slice(src.indexOf('// 13b.'))).toMatch(/guestReminderConsentAt: null/);
  });
});

describe('the new route behind the fail-closed switch', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('switch off: POST rdv/guest/manage/reminder answers 503 GUEST_BOOKING_DISABLED', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', '');
    const { default: handler } = await import('../../api/_handlers/rdv.js');
    const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method: 'POST', url: '/api/rdv/guest/manage/reminder', query: {}, body: { appointmentId: 'a', token: 'A'.repeat(43), consent: true }, headers: { host: 'localhost' } }, res);
    expect([res.statusCode, res.body.code]).toEqual([503, 'GUEST_BOOKING_DISABLED']);
  });
});
