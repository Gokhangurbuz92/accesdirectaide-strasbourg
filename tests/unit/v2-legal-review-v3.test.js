/**
 * V2 legal review (14/11/2026) of legal-drafts v2-2026-11-09 → v3 (14/11/2026): no present-tense booking promise in the citizen terms, no closed contact form
 * in the notice, appointment recipients marked « not open yet », Mon Espace self-service rights; the server refuses SMS / reminders / optional information
 * while those capabilities are closed (narrow V2 scope). The current version is pinned by v2-legal-review-v4.test.js; what v3 changed must stay true in
 * every later version, which is what this file keeps checking.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFTS_PRO_V11, LEGAL_DRAFTS_PRO_V11_DOCUMENT_IDS, LEGAL_DRAFTS_R3_NOTICE, LEGAL_DRAFTS_R3_CGU, LEGAL_DRAFTS_R3_NOTICE_DOCUMENT_IDS, LEGAL_DRAFTS_R3_CGU_DOCUMENT_IDS, LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFTS_VERSION, LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V8_DOCUMENT_IDS, LEGAL_DRAFTS_V9, LEGAL_DRAFTS_V9_DOCUMENT_IDS, LEGAL_DRAFTS_V9_PRO, LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS, LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V10_DOCUMENT_IDS, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V11_DOCUMENT_IDS, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V12_DOCUMENT_IDS, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_V13_DOCUMENT_IDS, LEGAL_DRAFTS_STRUCTURES_V9, LEGAL_DRAFTS_STRUCTURES_V9_DOCUMENT_IDS, LEGAL_DRAFT_DOCUMENTS_V12, LEGAL_DRAFT_DOCUMENTS_V10 } from '../../src/config/legal-drafts.js';
import { appendConsent, notificationOptionOpen, notificationOptionsOpen, NOTIFICATION_OPTION_CLOSED, setPreference } from '../../api/_services/citizen-account.js';

// G14: the notice v13 describes the ADA Pro opening (appointments open); the v3 statements on functions not open yet are checked on notice v12, the version
// of the citizen-only opening (X04 / X01 / X02, no ADA Pro text)
// the citizen terms v12 open the assistant (§ 4): the v3 « not open yet » statements are checked on the citizen terms v10
const doc = (/** @type {string} */ id) => (id === 'notice-confidentialite' ? LEGAL_DRAFT_DOCUMENTS_V12 : id === 'cgu-citoyen' ? LEGAL_DRAFT_DOCUMENTS_V10 : LEGAL_DRAFT_DOCUMENTS).find((d) => d.id === id);
const section = (/** @type {string} */ id, /** @type {string} */ s) => doc(id).sections.find((x) => x.id === s);
const textOf = (/** @type {any} */ s) => [s.title, ...(s.items || []), ...(s.paras || [])].join('\n');
// the narrow V2 scope as configured for the opening (accounts + admin, restricted beta)
const V2_ENV = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts,admin', VERCEL_ENV: 'production' };

describe('legal drafts: what the v3 review (14/11/2026) changed still holds', () => {
  it('every document carries the one current version, later than v2', () => {
    expect(LEGAL_DRAFTS_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
    expect(Number(LEGAL_DRAFTS_VERSION.slice(1).split('-')[0])).toBeGreaterThanOrEqual(3);
    // G4 (19/11/2026): v8 covers the two professional documents only; the others keep the shared version
    for (const d of LEGAL_DRAFT_DOCUMENTS) expect(d.version).toBe(LEGAL_DRAFTS_R3_NOTICE_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_R3_NOTICE : LEGAL_DRAFTS_R3_CGU_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_R3_CGU : LEGAL_DRAFTS_PRO_V11_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_PRO_V11 : LEGAL_DRAFTS_STRUCTURES_V9_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_STRUCTURES_V9 : LEGAL_DRAFTS_V13_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V13 : LEGAL_DRAFTS_V12_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V12 : LEGAL_DRAFTS_V11_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V11 : LEGAL_DRAFTS_V10_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V10 : LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V9_PRO : LEGAL_DRAFTS_V9_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V9 : LEGAL_DRAFTS_V8_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V8 : LEGAL_DRAFTS_VERSION);   // G8: the notice is at v9; G14: the professional terms at v9-2026-11-22 (draft)
  });
  it('cgu §5 / §6 carry the « pas encore ouvert » qualifier and no present-tense booking promise', () => {
    const account = textOf(section('cgu-citoyen', 'account'));
    expect(account).not.toContain('Un compte est nécessaire pour demander un rendez-vous.');
    expect(account).toMatch(/lorsque cette fonction sera ouverte ; elle ne l'est pas encore/);
    const appt = section('cgu-citoyen', 'appointments');
    expect(appt.title).toMatch(/pas encore ouverts/);
    expect(appt.paras[0]).toMatch(/^La demande de rendez-vous n'est pas encore ouverte\./);
    const t = textOf(appt);
    for (const present of ["C'est la structure qui confirme", 'Vous pouvez annuler votre demande', 'vous en êtes informé', "Il n'est transmis qu'avec votre accord"]) expect(t).not.toContain(present);
  });
  it('cgu §4 says the assistant is not open yet; §7 no longer presents booking as available', () => {
    expect(textOf(section('cgu-citoyen', 'ai'))).toMatch(/n'est pas encore ouvert/);
    expect(textOf(section('cgu-citoyen', 'use'))).toMatch(/lorsqu'elle sera ouverte, la réservation de créneaux/);
  });
  it('notice §1 no longer mentions the contact form; §8 lists the Mon Espace self-service and keeps the one-month answer; §5 / §9 are conditional', () => {
    const controller = textOf(section('notice-confidentialite', 'controller'));
    expect(controller).not.toMatch(/formulaire de contact/i);
    expect(controller).toContain('{{contact}}');
    const rights = textOf(section('notice-confidentialite', 'rights'));
    for (const w of ['export', 'corriger', "demander l'effacement", 'limitation', "délai d'un mois", '{{contact}}', 'CNIL']) expect(rights, w).toContain(w);
    expect(textOf(section('notice-confidentialite', 'recipients'))).toMatch(/Lorsque les rendez-vous seront ouverts \(ils ne le sont pas encore\)/);
    const booking = section('notice-confidentialite', 'booking');
    expect(booking.title).toMatch(/\(projet\)/);
    expect(booking.paras[0]).toMatch(/n'est pas encore ouverte/);
  });
  it('the five translations follow the new paragraph count (no stale French-only paragraph)', () => {
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const tr = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const k of ['cguCitoyen.appointments.p5', 'privacyNotice.recipients.p2', 'privacyNotice.rights.p3', 'privacyNotice.booking.p4']) expect(tr[k], `${lang} ${k}`).toBeTruthy();
      expect(tr['privacyNotice.controller.p2'], lang).not.toMatch(/contact form|Kontaktformular|iletişim formu|نموذج الاتصال|форму/i);
    }
  });
});

describe('V2 scope: SMS, reminders and optional information cannot be switched on', () => {
  it('closed in the narrow V2 scope, open in the LAB (enforcement off)', () => {
    expect(notificationOptionsOpen(V2_ENV)).toEqual({ sms: false, reminder: false, marketing: false });
    expect(notificationOptionsOpen({})).toEqual({ sms: true, reminder: true, marketing: true });
    expect(notificationOptionOpen('email', 'service', V2_ENV)).toBe(true);
    for (const [ch, cat] of [['sms', 'service'], ['email', 'reminder'], ['email', 'marketing'], ['push', 'reminder']]) expect(notificationOptionOpen(ch, cat, V2_ENV), `${ch}.${cat}`).toBe(false);
  });
  it('the server refuses enabling them with NOTIFICATION_OPTION_CLOSED, before any write; switching off still passes the gate', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, V2_ENV);
    const writes = [];
    const db = new Proxy({}, { get: (_t, k) => () => { writes.push(k); throw new Error('no db in this test'); } });
    try {
      for (const [channel, category] of [['sms', 'service'], ['email', 'reminder'], ['email', 'marketing'], ['sms', 'reminder']]) {
        const out = await setPreference('u1', { channel, category, enabled: true, consentGiven: true }, db);
        expect([out.ok, out.status, out.code], `${channel}.${category}`).toEqual([false, 409, NOTIFICATION_OPTION_CLOSED]);
      }
      await expect(appendConsent({ userId: 'u1', purpose: 'NOTIF_SMS_REMINDER', decision: true }, db)).rejects.toMatchObject({ code: NOTIFICATION_OPTION_CLOSED });
      expect(writes).toEqual([]);
      // a withdrawal is never refused by this gate (it reaches the database)
      await expect(setPreference('u1', { channel: 'email', category: 'reminder', enabled: false }, db)).rejects.toThrow('no db in this test');
    } finally {
      for (const k of Object.keys(V2_ENV)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
  it('the profile screen offers only what the server says is open', () => {
    const src = readFileSync('src/pages/CompteProfil.jsx', 'utf8');
    expect(src).toMatch(/account\.notificationOptions/);
    expect(src).toMatch(/shownChannels\.map/); expect(src).toMatch(/shownCategories\.map/);
    expect(src).not.toMatch(/\{CHANNELS\.map/);
  });
});
