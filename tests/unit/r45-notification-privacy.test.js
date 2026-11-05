/**
 * R45 / ENG-LR-3 — threat-case regression tests for the privacy levels of appointment notifications (AIPD risk A8, measure P-6).
 *
 * Threat: a relative or someone sharing the device / mailbox learns that the person has an appointment with a sensitive organisation (addiction, mental
 * health, MDPH…) from the e-mail (subject, preview, body, attachment, link), a forwarded copy, an SMS or a lock-screen notification.
 *
 * For EVERY language (fr en tr ar de uk) × EVERY notice kind a person receives (confirmation, request, reschedule, cancellation by either side,
 * refusal / expiry, J-1 reminder, video access), at the minimal level (the default): subject, preheader, text, HTML, attachments and links name no
 * structure, service, category keyword (in all six languages), professional, booking message, address, date or time, and the kind of event is not
 * revealed either (one identical message). The reduced level (verified « ordinary ») never carries the booking message.
 * Fakes only: no database, no network, no provider (the sendMail of each test is a stub; the test outbox path is the noop/sandbox path).
 */
import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MINIMAL_CATEGORY, MINIMAL_PATH, NOTIFICATION_PRIVACY_LEVELS, SENSITIVITY_VALUES, defaultResolveSensitivity, minimalCatalogue, minimalMail, minimalPush,
  minimalSms, minimalTexts, privacyLevelFor, resolveNotificationPrivacy, withoutPersonalFreeText,
} from '../../api/lib/notification-privacy.js';
import { NOTICE_MAIL_KINDS, mailText } from '../../api/_utils/mail-catalogue.js';
import { buildCitizenNoticeMail, noticeCitizen } from '../../api/_services/appointment-notices.js';
import { withOptOut } from '../../api/lib/sms-policy.js';
import { encrypt } from '../../api/lib/crypto.js';
import { LANGUAGE_CODES } from '../../src/i18n/languages.js';

const BASE = 'https://ada.example.test';
const ACCOUNT_URL = `${BASE}${MINIMAL_PATH}`;
let savedBase;
beforeAll(() => { savedBase = process.env.APP_BASE_URL; process.env.APP_BASE_URL = BASE; });
afterAll(() => { if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase; });
afterEach(() => { vi.restoreAllMocks(); vi.doUnmock('../../src/db/index.js'); vi.doUnmock('../../api/_utils/mailer.js'); });

// ---- synthetic fixture: everything a careless template could leak
const STRUCTURE = 'Centre Horizon Addictologie';
const SLUG = 'centre-horizon-addictologie';
const SERVICE = 'Consultation santé mentale';
const PRO = 'Dr Camille Exemple';
const BOOKING_MESSAGE = 'Je souhaite parler de mon sevrage';
const ADDRESS = '12 rue de l’Exemple, 67000 Strasbourg';
const APPT_ID = 'appt-7f3a9c';
const START = new Date('2026-11-12T09:00:00Z');
const END = new Date('2026-11-12T09:30:00Z');

const LEAKY = {
  subject: `Rendez-vous chez ${STRUCTURE} (${SERVICE}) le 12/11 à 10:00`,
  text: `Votre rendez-vous du jeudi 12 novembre 2026 à 10:00 avec ${STRUCTURE} (${SERVICE}), ${PRO}, au ${ADDRESS}. Votre message : « ${BOOKING_MESSAGE} ». Gérer : ${BASE}/rdv/${SLUG}/booking?appointment=${APPT_ID}`,
  calendar: { appointmentId: APPT_ID, startAt: START, endAt: END, structureName: STRUCTURE, serviceName: SERVICE, location: ADDRESS, manageUrl: `${BASE}/rdv/${SLUG}/booking?appointment=${APPT_ID}`, sequence: 0 },
  attachments: [{ filename: `compte-rendu-${SLUG}.pdf`, contentType: 'application/pdf', content: `${STRUCTURE} ${SERVICE}` }],
};
const APPOINTMENT = { id: APPT_ID, citizenUserId: 'u1', structureId: 's1', notes: BOOKING_MESSAGE, structure: { nom: STRUCTURE, slug: SLUG, adresse: ADDRESS }, service: { name: SERVICE }, startAt: START, endAt: END };

/** the category keywords in the six languages (lower-case substrings) */
const CATEGORY_WORDS = [
  'santé mentale', 'sante mentale', 'addiction', 'addicto', 'mdph', 'handicap', 'psychiatr', 'psycholog', 'sevrage',
  'mental health', 'disabilit', 'substance',
  'ruh sağlığı', 'bağımlılık', 'engelli', 'psikiyatr',
  'الصحة النفسية', 'إدمان', 'إعاقة', 'نفسي',
  'psychisch', 'sucht', 'behinderung',
  'психічн', 'залежн', 'інвалідн', 'психіатр',
];
const NAMED = [STRUCTURE, SLUG, SERVICE, PRO, 'Camille', 'Horizon', BOOKING_MESSAGE, 'rue de l’Exemple', 'Strasbourg', '67000', APPT_ID];
/** month and weekday names of the fixture date in every language (and French), long and short */
const DATE_WORDS = LANGUAGE_CODES.flatMap((l) => ['long', 'short'].flatMap((w) => [
  new Intl.DateTimeFormat(l, { month: /** @type {any} */ (w), timeZone: 'Europe/Paris' }).format(START),
  new Intl.DateTimeFormat(l, { weekday: /** @type {any} */ (w), timeZone: 'Europe/Paris' }).format(START),
])).map((s) => s.toLowerCase().replace(/\.$/, '')).filter((s) => s.length >= 3);

const visible = (html) => String(html || '').replace(/<head>[\s\S]*?<\/head>/i, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const linksOf = (s) => [...String(s || '').matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);

/** every leak check of the brief, on one piece of text the threat actor can read */
function expectNoLeak(label, s, { allowDigitsInUrl = true } = {}) {
  const low = String(s).toLowerCase();
  for (const w of NAMED) expect(low.includes(w.toLowerCase()), `${label}: names « ${w} »`).toBe(false);
  for (const w of CATEGORY_WORDS) expect(low.includes(w), `${label}: category word « ${w} »`).toBe(false);
  for (const w of DATE_WORDS) expect(new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(low), `${label}: date word « ${w} »`).toBe(false);
  const withoutUrls = allowDigitsInUrl ? low.replace(/https?:\/\/[^\s"'<>]+/g, '') : low;
  expect(/\d/.test(withoutUrls), `${label}: a digit (date, time, number) in « ${withoutUrls.slice(0, 120)} »`).toBe(false);
  for (const l of linksOf(s)) expect(l, `${label}: link`).toBe(ACCOUNT_URL);
}

/** the citizen notice kinds the booking flows send (every kind with a catalogue entry; GUEST_CODE is a requested code, see PRIVACY_EXEMPT_KINDS) */
const KINDS = Object.keys(NOTICE_MAIL_KINDS);
const fakeDb = (lang) => {
  let call = 0;
  return {
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (call++ % 2 === 0 ? [{ email: 'test.citizen+r45@example.test', verified: new Date() }] : [{ lang }]) }) }) }),
  };
};
const sendStub = () => vi.fn(async () => ({ outcome: 'TEST_RECORDED', provider: 'test' }));
const recordStatus = async () => {};

describe('R45 privacy levels: fail-closed resolution', () => {
  it('only a verified « ordinary » service is reduced; sensitive, unknown and anything else are minimal', () => {
    expect(SENSITIVITY_VALUES).toEqual(['sensitive', 'ordinary', 'unknown']);
    expect(NOTIFICATION_PRIVACY_LEVELS).toEqual(['minimal', 'reduced']);
    expect(privacyLevelFor('ordinary')).toBe('reduced');
    for (const v of ['sensitive', 'unknown', 'ORDINARY', 'Ordinary ', '', null, undefined, 0, {}, ['ordinary']]) expect(privacyLevelFor(v), String(v)).toBe('minimal');
  });
  it('the default resolver answers « unknown »: today every appointment is minimal', async () => {
    expect(defaultResolveSensitivity({ service: { name: SERVICE } })).toBe('unknown');
    expect(await resolveNotificationPrivacy(APPOINTMENT)).toEqual({ sensitivity: 'unknown', level: 'minimal' });
    expect(await resolveNotificationPrivacy(APPOINTMENT, {})).toEqual({ sensitivity: 'unknown', level: 'minimal' });
  });
  it('an injected resolver gets the record; a throw, a rejection or an unknown value is minimal', async () => {
    const seen = [];
    expect(await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: (r) => { seen.push(r); return 'ordinary'; } })).toEqual({ sensitivity: 'ordinary', level: 'reduced' });
    expect(seen[0]).toBe(APPOINTMENT);
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: async () => 'ordinary' })).level).toBe('reduced');
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: async () => 'sensitive' })).level).toBe('minimal');
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: () => { throw new Error('classification down'); } })).level).toBe('minimal');
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: async () => { throw new Error('x'); } })).level).toBe('minimal');
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: () => 'safe' })).level).toBe('minimal');
    expect((await resolveNotificationPrivacy(APPOINTMENT, { resolveSensitivity: /** @type {any} */ ('ordinary') })).level).toBe('minimal');
  });
});

describe('R45 minimal texts: six languages, neutral, Arabic right-to-left', () => {
  it('every field exists in every language, is translated, has no placeholder and leaks nothing', () => {
    const cat = minimalCatalogue();
    expect(Object.keys(cat).sort()).toEqual([...LANGUAGE_CODES].sort());
    for (const lang of LANGUAGE_CODES) for (const [f, v] of Object.entries(cat[lang])) {
      expect(String(v).trim().length, `${lang}/${f}`).toBeGreaterThan(3);
      expect(v, `${lang}/${f}`).not.toMatch(/[{}$<>]|%s/);
      if (lang !== 'fr' && f !== 'pushTitle') expect(v, `${lang}/${f} is translated`).not.toBe(cat.fr[f]);
      expectNoLeak(`${lang}/${f}`, v);
      expect(v.toLowerCase(), `${lang}/${f} names no appointment`).not.toMatch(/rendez|appointment|randevu|موعد|termin|зустріч|rdv/);
    }
    expect(minimalTexts('ar')).toMatchObject({ lang: 'ar', dir: 'rtl' });
    expect(minimalTexts('ar-MA').lang).toBe('ar');
    expect(minimalTexts('es')).toMatchObject({ lang: 'fr', dir: 'ltr' });
  });
  it('the French subject is the neutral one of the brief; the HTML carries lang/dir, a hidden preheader, and the French version below another language', () => {
    expect(minimalMail('fr').subject).toBe('Accès Direct Aide — vous avez une nouvelle information dans votre espace');
    const ar = minimalMail('ar', { url: ACCOUNT_URL });
    expect(ar.html).toMatch(/^<!doctype html>\n<html lang="ar" dir="rtl">/);
    expect(ar.html).toContain('<div dir="rtl" lang="ar"');
    expect(ar.html).toContain('<div dir="ltr" lang="fr"');
    expect(ar.html).toContain(`display: none; max-height: 0; overflow: hidden; opacity: 0;">${minimalTexts('ar').preheader}</div>`);
    expect(ar.text.startsWith(minimalTexts('ar').heading)).toBe(true);
    expect(ar.text).toContain(minimalTexts('fr').body);
    const fr = minimalMail('fr', { url: ACCOUNT_URL });
    expect(fr.html).not.toContain('lang="ar"');
    expect(fr.text).not.toContain('---');
  });
  it('a link with a query, a fragment or credentials is reduced to the bare page; a non-http link is dropped', () => {
    expect(linksOf(minimalMail('fr', { url: `${ACCOUNT_URL}?appointment=${APPT_ID}#token=x` }).text)).toEqual([ACCOUNT_URL]);
    expect(linksOf(minimalMail('fr', { url: 'javascript:alert(1)' }).html)).toEqual([]);
    expect(linksOf(minimalMail('fr', { url: `https://u:p@ada.example.test/compte` }).text)).toEqual([]);
  });
});

describe('R45 threat matrix: minimal e-mail for every language × notice kind (default resolver)', () => {
  for (const lang of LANGUAGE_CODES) {
    it(`${lang}: subject, preheader, text, HTML, attachments and links leak nothing; every kind reads the same`, async () => {
      const seen = new Set();
      for (const kind of KINDS) {
        const sendMail = sendStub();
        const status = await noticeCitizen(APPOINTMENT, kind, LEAKY, { db: fakeDb(lang), sendMail, canNotify: async () => true, recordStatus });
        expect(status, `${lang}/${kind}`).toBe('TEST_RECORDED');
        const m = sendMail.mock.calls[0][0];
        const label = `${lang}/${kind}`;
        expect(m.to).toBe('test.citizen+r45@example.test');
        expect(m.attachments, `${label}: no .ics, no attachment`).toBeUndefined();
        expect(m.category, `${label}: neutral provider category`).toBe(MINIMAL_CATEGORY);
        expect(m.subject).toBe(minimalTexts(lang).subject);
        expectNoLeak(`${label} subject`, m.subject);
        expectNoLeak(`${label} text`, m.text);
        expectNoLeak(`${label} html`, visible(m.html));
        for (const href of [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1])) expect(href, `${label} href`).toBe(ACCOUNT_URL);
        expect(m.html, `${label}: the hidden preheader`).toContain(minimalTexts(lang).preheader);
        expect(m.text).toContain(ACCOUNT_URL);
        seen.add(JSON.stringify([m.subject, m.text, m.html]));
      }
      expect(seen.size, `${lang}: a cancellation, a refusal and a confirmation are indistinguishable`).toBe(1);
    });
  }

  it('an account-free booking (sealed address) gets the minimal guest text: no account link, nothing named', async () => {
    for (const lang of LANGUAGE_CODES) for (const kind of ['REMINDER_J1', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED']) {
      const sendMail = sendStub();
      const guest = { ...APPOINTMENT, citizenUserId: null, guestEmail: encrypt('test.guest+r45@example.test'), guestConfirmedAt: new Date(), guestMailConsentAt: new Date(), guestReminderConsentAt: new Date() };
      expect(await noticeCitizen(guest, kind, LEAKY, { db: fakeDb(lang), sendMail, lang, recordStatus })).toBe('TEST_RECORDED');
      const m = sendMail.mock.calls[0][0];
      expect(m.attachments).toBeUndefined();
      expect(m.text).toContain(minimalTexts(lang).bodyGuest);
      expect(linksOf(m.text)).toEqual([]);
      for (const part of [m.subject, m.text, visible(m.html)]) expectNoLeak(`guest ${lang}/${kind}`, part);
    }
  });

  it('forwarded-message case: the whole rendered message as forwarded text leaks nothing', async () => {
    for (const lang of LANGUAGE_CODES) {
      const m = await buildCitizenNoticeMail(APPOINTMENT, 'REQUEST_ACCEPTED', LEAKY, { lang, to: 'test.citizen+r45@example.test' });
      const forwarded = [
        '---------- Forwarded message ---------', 'From: Accès Direct Aide <noreply@accesdirectaide.fr>', `Subject: ${m.subject}`, '',
        m.text, '', visible(m.html), ...(m.attachments || []).map((a) => `[attachment: ${a.filename}]`),
      ].join('\n');
      expectNoLeak(`forwarded ${lang}`, forwarded);
      expect(m.attachments).toEqual([]);
    }
  });

  it('shared-device case: the inbox preview, the SMS and the lock-screen push leak nothing', async () => {
    for (const lang of LANGUAGE_CODES) {
      const m = await buildCitizenNoticeMail(APPOINTMENT, 'REMINDER_J1', LEAKY, { lang, to: 'test.citizen+r45@example.test' });
      const inboxPreview = `Accès Direct Aide · ${m.subject} — ${minimalTexts(lang).preheader} ${m.text.split('\n').slice(0, 3).join(' ')}`;   // what a mail client shows on a locked phone / in a shared inbox list
      expectNoLeak(`preview ${lang}`, inboxPreview);
      expectNoLeak(`sms ${lang}`, withOptOut(minimalSms(lang)));
      const push = minimalPush(lang);
      expect(push.url).toBe(MINIMAL_PATH);
      expectNoLeak(`push ${lang}`, `${push.title} ${push.body} ${push.url}`);
    }
  });

  it('the new-message alert to a person is minimal by default (no structure, no date, no conversation link); a professional’s is unchanged', async () => {
    vi.doMock('../../src/db/index.js', () => ({ db: {
      insert: () => ({ values: async () => {} }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ lang: 'uk' }] }) }) }),
    } }));
    const sent = [];
    vi.doMock('../../api/_utils/mailer.js', async (orig) => ({ ...(await orig()), sendMail: async (m) => { sent.push(m); return { outcome: 'TEST_RECORDED' }; } }));
    vi.resetModules();
    const { notifyConversationMessage } = await import('../../api/_utils/rdv-messaging.js');
    const base = { conversationId: 'conv-1', messageId: 'm1', recipientEmail: 'test.citizen+r45@example.test', recipientEnabled: true, structureName: STRUCTURE, appointmentStartAt: START, appointment: APPOINTMENT };
    expect(await notifyConversationMessage({ ...base, recipientType: 'USER', recipientUserId: 'u1' })).toMatchObject({ sent: true });
    expect(sent[0].subject).toBe(minimalTexts('uk').subject);
    expect(sent[0].category).toBe(MINIMAL_CATEGORY);
    for (const part of [sent[0].subject, sent[0].text, visible(sent[0].html)]) expectNoLeak('message alert', part);
    expect(sent[0].text).not.toContain('conv-1');
    await notifyConversationMessage({ ...base, recipientType: 'PRO', recipientUserId: null });
    expect(sent[1].subject).toBe(mailText('appointment_message', 'fr').subject);
    expect(sent[1].text).toContain(STRUCTURE);
  });
});

describe('R45 reduced level (verified « ordinary »)', () => {
  const ORDINARY = () => 'ordinary';
  it('keeps the useful details and the calendar file, never the booking message, and the subject stays the neutral catalogue subject', async () => {
    for (const lang of LANGUAGE_CODES) for (const kind of KINDS) {
      const sendMail = sendStub();
      await noticeCitizen(APPOINTMENT, kind, LEAKY, { db: fakeDb(lang), sendMail, canNotify: async () => true, recordStatus, resolveSensitivity: ORDINARY });
      const m = sendMail.mock.calls[0][0];
      expect(m.subject, `${lang}/${kind}`).toBe(mailText(NOTICE_MAIL_KINDS[kind], lang).subject);
      expect(m.text, `${lang}/${kind}: never the booking message`).not.toContain(BOOKING_MESSAGE);
      expect(m.text).toContain(STRUCTURE);   // transactional content for an ordinary service
      expect(m.category).toBe(`appointment-${kind.toLowerCase()}`);
      expect(m.attachments.some((a) => /\.ics$/.test(a.filename))).toBe(true);
      expect(m.attachments.map((a) => a.content).join('\n')).not.toContain(BOOKING_MESSAGE);
    }
  });
  it('withoutPersonalFreeText removes a quoted note or free text, ignores sealed values and very short strings', () => {
    expect(withoutPersonalFreeText(`a ${BOOKING_MESSAGE} b`, { notes: BOOKING_MESSAGE })).toBe('a […] b');
    expect(withoutPersonalFreeText('a secret b', { freeText: 'secret' })).toBe('a […] b');
    expect(withoutPersonalFreeText('a v1:abc b', { notes: 'v1:abc' })).toBe('a v1:abc b');
    expect(withoutPersonalFreeText('a ok b', { notes: 'ok' })).toBe('a ok b');
    expect(withoutPersonalFreeText('text', null)).toBe('text');
  });
  it('GUEST_CODE (a requested code, no caller today) keeps its message at every level', async () => {
    const m = await buildCitizenNoticeMail(APPOINTMENT, 'GUEST_CODE', { subject: 'Votre code', text: 'Code : 123456' }, { lang: 'fr', to: 'x@example.test' });
    expect(m).toMatchObject({ level: 'reduced', subject: 'Votre code', text: 'Code : 123456' });
  });
});

describe('R45 every other citizen send site follows the level (source guards)', () => {
  const src = (f) => fs.readFileSync(f, 'utf8');
  it('the Mode A booking confirmation (rdv.js) checks the level before building any detail or calendar file', () => {
    const rdv = src('api/_handlers/rdv.js');
    const fn = rdv.slice(rdv.indexOf('async function sendAppointmentConfirmationEmail'), rdv.indexOf('export function mailOutcome'));
    const gate = fn.indexOf("(await resolveNotificationPrivacy(input.appointment)).level === 'minimal'");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(fn.indexOf('buildAppointmentManageUrl('));
    expect(gate).toBeLessThan(fn.indexOf('calendarAttachment('));
    expect(fn).toMatch(/minimalMail\(await citizenMailLanguage\(input\.appointment\?\.citizenUserId\), \{ url: buildAppUrl\(MINIMAL_PATH\) \}\)/);
  });
  it('the J-1 SMS and the SMS confirmation (and its e-mail fallback) are minimal at the minimal level', () => {
    const cron = src('api/_handlers/cron/rdv-reminder.js');
    expect(cron).toMatch(/const smsMinimal = \(await resolveNotificationPrivacy\(rdv\)\)\.level === 'minimal';/);
    expect(cron).toMatch(/withOptOut\(smsMinimal \? minimalSms\(/);
    const sms = src('api/_handlers/public/sms-notify.js');
    expect(sms).toMatch(/resolveNotificationPrivacy\(appointment\)\)\.level === 'minimal'/);
    expect(sms).toMatch(/withOptOut\(minimalLang \? minimalSms\(minimalLang\)/);
    expect(sms.match(/sendEmailFallback\(appointment, phoneNumber, message, minimalLang\)/g)).toHaveLength(2);
  });
  it('the person-side message alerts pass the appointment record (the sensitivity input)', () => {
    expect(src('api/_handlers/pro/messages.js')).toMatch(/appointment,\s+\/\/ R45/);
    expect(src('api/_handlers/pro/messages-conversations.js')).toContain('appointment: created.conversation.appointment || null');
  });
});
