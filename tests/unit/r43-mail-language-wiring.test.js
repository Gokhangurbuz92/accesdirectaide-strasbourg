/**
 * R43-MAIL follow-up — every citizen e-mail of the booking flows takes its subject (and, in another language, its opening) from the six-language
 * catalogue, in the person's stored language (CitizenProfile.preferredLanguage), French otherwise: noticeCitizen (request, confirmation, refusal, expiry,
 * cancellation by either side, reschedule, reminder, video), the Mode A confirmation of rdv.js, the new-message alert, the professional invitations.
 * A caller's subject naming a structure or a date never reaches the provider. Fakes only (no database, no network).
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MAIL_KINDS, mailText } from '../../api/_utils/mail-catalogue.js';
import { localizeNotice, noticeCitizen } from '../../api/_services/appointment-notices.js';
import { citizenMailLanguage } from '../../api/_services/mail-language.js';

afterEach(() => { vi.restoreAllMocks(); vi.doUnmock('../../src/db/index.js'); vi.doUnmock('../../api/_utils/mailer.js'); });

/** a fake db: the account row for the CitizenUser lookup, the profile row for the language lookup */
function fakeDb(lang) {
  const ledger = [];
  let call = 0;
  return {
    ledger,
    insert: () => ({ values: async (v) => { ledger.push(v); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (call++ % 2 === 0 ? [{ email: 'person@example.test', verified: new Date() }] : (lang === undefined ? [] : [{ lang }])) }) }) }),
  };
}
const LEAKY = { subject: 'Annulation chez Centre Addictologie le 12/11 à 10:00', text: 'Votre rendez-vous du mercredi 12 novembre à 10:00 avec Centre Addictologie est annulé.' };

describe('R43 citizen notices in the stored language', () => {
  it('maps every notice kind of the booking flows onto a catalogue kind (GUEST_CODE excepted)', () => {
    for (const k of ['REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED', 'REQUEST_EXPIRED', 'BOOKED_BY_STRUCTURE', 'BOOKED_BY_CITIZEN', 'BOOKED_BY_GUEST',
      'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED']) expect(() => mailText(NOTICE_MAIL_KINDS[k], 'fr'), k).not.toThrow();
    expect(NOTICE_MAIL_KINDS.GUEST_CODE).toBeUndefined();
    expect(localizeNotice('GUEST_CODE', { subject: 'Votre code', text: 't' }, 'ar')).toEqual({ subject: 'Votre code', text: 't' });
    expect(localizeNotice('REQUEST_REFUSED', LEAKY, 'fr').subject).toBe('Réponse à votre demande de rendez-vous - Accès Direct Aide');
    expect(localizeNotice('RESCHEDULED', { ...LEAKY, mailKind: 'appointment_request' }, 'de').subject).toBe(mailText('appointment_request', 'de').subject);
  });
  it('a person who chose Arabic gets the Arabic subject and opening, then the French text; the caller subject never leaves', async () => {
    const db = fakeDb('ar'); const sendMail = vi.fn(async () => ({ outcome: 'PROVIDER_ACCEPTED', delivered: true }));
    expect(await noticeCitizen({ id: 'a1', citizenUserId: 'u1' }, 'CANCELLED_BY_STRUCTURE', LEAKY, { db, sendMail, canNotify: async () => true })).toBe('PROVIDER_ACCEPTED');
    const sent = sendMail.mock.calls[0][0];
    expect(sent.subject).toBe(mailText('appointment_cancellation', 'ar').subject);
    expect(sent.subject).not.toMatch(/Addictologie|\d/);
    expect(sent.text.startsWith(mailText('appointment_cancellation', 'ar').heading)).toBe(true);
    expect(sent.text).toContain(LEAKY.text);
  });
  it('no profile, an unknown language or a failed lookup → French, the text unchanged', async () => {
    for (const lang of [undefined, 'es', null]) {
      const sendMail = vi.fn(async () => ({ outcome: 'TEST_RECORDED' }));
      await noticeCitizen({ id: 'a1', citizenUserId: 'u1' }, 'REMINDER_J1', LEAKY, { db: fakeDb(lang), sendMail, canNotify: async () => true });
      expect(sendMail.mock.calls[0][0]).toMatchObject({ subject: 'Rappel de votre rendez-vous - Accès Direct Aide', text: LEAKY.text });
    }
    expect(await citizenMailLanguage('u1', { select: () => { throw new Error('db down'); } })).toBe('fr');
    expect(await citizenMailLanguage(null)).toBe('fr');
    expect(await citizenMailLanguage('u1', fakeDbProfile('uk'))).toBe('uk');
  });
  it('every kind sent by the booking handlers reads neutrally in all six languages', async () => {
    for (const lang of ['fr', 'en', 'tr', 'ar', 'de', 'uk']) for (const kind of Object.keys(NOTICE_MAIL_KINDS)) {
      const sendMail = vi.fn(async () => ({ outcome: 'TEST_RECORDED' }));
      await noticeCitizen({ id: 'a1', citizenUserId: 'u1' }, kind, LEAKY, { db: fakeDb(lang), sendMail, canNotify: async () => true });
      const subject = sendMail.mock.calls[0][0].subject;
      expect(subject, `${lang}/${kind}`).toBe(mailText(NOTICE_MAIL_KINDS[kind], lang).subject);
      expect(subject).not.toMatch(/Addictologie|\d/);
    }
  });
});
function fakeDbProfile(lang) { return { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ lang }] }) }) }) }; }

describe('R43 the new-message alert', () => {
  it('a person gets the alert in their language; a professional in French; no message text in either', async () => {
    let profileLang = 'tr';
    vi.doMock('../../src/db/index.js', () => ({ db: {
      insert: () => ({ values: async () => {} }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ lang: profileLang }] }) }) }),
    } }));
    const sent = [];
    vi.doMock('../../api/_utils/mailer.js', async (orig) => ({ ...(await orig()), sendMail: async (m) => { sent.push(m); return { outcome: 'TEST_RECORDED' }; } }));
    vi.resetModules();
    const { notifyConversationMessage } = await import('../../api/_utils/rdv-messaging.js');
    const base = { conversationId: 'c1', messageId: 'm1', recipientEmail: 'person@example.test', recipientEnabled: true, structureName: 'Centre X', appointmentStartAt: new Date('2026-11-12T09:00:00Z') };
    expect(await notifyConversationMessage({ ...base, recipientType: 'USER', recipientUserId: 'u1' })).toMatchObject({ sent: true });
    expect(sent[0].subject).toBe(mailText('appointment_message', 'tr').subject);
    profileLang = 'ar';
    await notifyConversationMessage({ ...base, recipientType: 'PRO', recipientUserId: null });
    expect(sent[1].subject).toBe(mailText('appointment_message', 'fr').subject);
    for (const m of sent) expect(m.subject).not.toContain('Centre X');
  });
});

describe('R43 source: the remaining send sites take the catalogue subject', () => {
  const src = (f) => fs.readFileSync(f, 'utf8');
  it('rdv.js confirms through localizedMail in the stored language; the move-back-to-request reads as a request', () => {
    const rdv = src('api/_handlers/rdv.js');
    expect(rdv).toMatch(/localizedMail\('appointment_confirmation', await citizenMailLanguage\(input\.appointment\?\.citizenUserId\), text\)/);
    expect(rdv).not.toMatch(/subject: 'Confirmation de votre rendez-vous/);
    expect(rdv).toMatch(/mailKind: 'appointment_request'/);
  });
  it('both invitation handlers use the catalogue (no stored language for an invited person: French)', () => {
    for (const f of ['api/_handlers/pro/invite.js', 'api/_handlers/pro/resend-invite.js']) expect(src(f)).toContain("subject: mailText('pro_invitation', 'fr').subject");
  });
  it('the pro message handlers pass the person id so the alert finds their language', () => {
    expect(src('api/_handlers/pro/messages.js')).toContain('recipientUserId: appointment.citizenUserId');
    expect(src('api/_handlers/pro/messages-conversations.js')).toContain('recipientUserId: created.conversation.citizenUser?.id');
  });
});
