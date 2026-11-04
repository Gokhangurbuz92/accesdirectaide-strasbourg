/**
 * R43-MAIL — transactional e-mail texts: the nine kinds a person receives exist in the six interface languages, their subjects disclose nothing (no structure,
 * service, person, date or message text: no placeholder at all), the French ones are the wording the handlers already send, Arabic is right-to-left, and the
 * templates of api/lib/email-service.js use them. A source scan keeps every subject literal sent to a citizen free of interpolation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIL_KINDS, mailCatalogue, mailLanguage, mailText } from '../../api/_utils/mail-catalogue.js';
import { LANGUAGE_CODES } from '../../src/i18n/languages.js';
import { templates } from '../../api/lib/email-service.js';

const REQUIRED = ['account_verification', 'password_reset', 'appointment_request', 'appointment_confirmation', 'appointment_refusal', 'appointment_cancellation',
  'appointment_rescheduled', 'appointment_reminder', 'pro_invitation'];

describe('R43 mail catalogue coverage', () => {
  it('has every required kind in all six languages, with non-empty subject, heading, opening and button', () => {
    expect(MAIL_KINDS).toEqual(REQUIRED);
    expect(LANGUAGE_CODES).toHaveLength(6);
    const cat = mailCatalogue();
    for (const lang of LANGUAGE_CODES) for (const kind of REQUIRED) {
      const t = cat[lang]?.[kind];
      expect(t, `${lang}/${kind}`).toBeTruthy();
      for (const f of ['subject', 'heading', 'intro', 'cta']) expect(String(t[f] || '').trim().length, `${lang}/${kind}/${f}`).toBeGreaterThan(3);
      if (lang !== 'fr') expect(t.subject, `${lang}/${kind} is translated`).not.toBe(cat.fr[kind].subject);
    }
  });
  it('subjects disclose nothing: no placeholder, no digit, no « refus »; every subject names the site', () => {
    const cat = mailCatalogue();
    for (const lang of LANGUAGE_CODES) for (const kind of REQUIRED) {
      const { subject, heading, intro } = cat[lang][kind];
      for (const s of [subject, heading, intro]) { expect(s).not.toMatch(/\$\{|\{\{|%s|<|>/); expect(s).not.toMatch(/\d/); }
      expect(subject, `${lang}/${kind}`).toContain('Accès Direct Aide');
    }
    // the refusal is « a reply to your request » in every language — the outcome is read in the account
    expect(cat.fr.appointment_refusal.subject).not.toMatch(/refus/i);
    expect(cat.en.appointment_refusal.subject).not.toMatch(/refus|declin|reject/i);
    expect(cat.de.appointment_refusal.subject).not.toMatch(/abgelehnt|Ablehnung/i);
  });
  it('the French subjects are the ones the handlers already send', () => {
    const fr = mailCatalogue().fr;
    expect(fr.account_verification.subject).toBe('Bienvenue sur Accès Direct Aide — Vérifiez votre email');
    expect(fr.password_reset.subject).toBe('Réinitialisation de votre mot de passe — Accès Direct Aide');
    expect(fr.appointment_request.subject).toBe('Votre demande de rendez-vous - Accès Direct Aide');
    expect(fr.appointment_confirmation.subject).toBe('Votre rendez-vous est confirmé - Accès Direct Aide');
    expect(fr.appointment_refusal.subject).toBe('Réponse à votre demande de rendez-vous - Accès Direct Aide');
    expect(fr.appointment_cancellation.subject).toBe('Votre rendez-vous a été annulé - Accès Direct Aide');
    expect(fr.appointment_rescheduled.subject).toBe('Votre rendez-vous est déplacé - Accès Direct Aide');
    expect(fr.pro_invitation.subject).toBe('Invitation à rejoindre une équipe sur Accès Direct Aide');
  });
  it('language matching: tags and unknown values; Arabic is right-to-left; an unknown kind throws', () => {
    expect(mailLanguage('ar-MA')).toBe('ar'); expect(mailLanguage('uk-UA')).toBe('uk'); expect(mailLanguage('es')).toBe('fr'); expect(mailLanguage(null)).toBe('fr');
    expect(mailText('appointment_reminder', 'ar')).toMatchObject({ lang: 'ar', dir: 'rtl' });
    expect(mailText('appointment_reminder', 'tr')).toMatchObject({ lang: 'tr', dir: 'ltr' });
    expect(() => mailText('newsletter', 'fr')).toThrow();
  });
});

describe('R43 email-service templates use the catalogue', () => {
  const URL = 'https://www.example.test/auth/verify?token=t';
  it('French stays exactly as before; another language gets its subject, heading and button first, then the French source', () => {
    expect(templates.welcome('Lina', URL).subject).toBe('Bienvenue sur Accès Direct Aide — Vérifiez votre email');
    expect(templates.welcome('Lina', URL, '15 minutes', 'fr')).toEqual(templates.welcome('Lina', URL));
    const ar = templates.welcome('Lina', URL, '15 minutes', 'ar');
    expect(ar.subject).toBe(mailText('account_verification', 'ar').subject);
    expect(ar.html).toContain('dir="rtl" lang="ar"');
    expect(ar.html).toContain(mailText('account_verification', 'ar').cta);
    expect(ar.html).toContain('Vérifier mon adresse email');
    const de = templates.resetPassword('Lina', 'https://www.example.test/auth/reset?token=t', '15 minutes', 'de');
    expect(de.subject).toBe(mailText('password_reset', 'de').subject);
    expect(de.html).toContain('lang="de"');
    // a welcome without a link has no button in any language
    expect(templates.welcome('Lina', null, '15 minutes', 'en').subject).toBe('Bienvenue sur Accès Direct Aide');
  });
  it('the appointment templates never put the service or the time in the subject, and escape what they show', () => {
    const c = templates.appointmentConfirmation({ name: '<b>x</b>', service: 'Addictologie', date: 'lundi', time: '10:00', mode: 'SITE', reference: 'R1' });
    expect(c.subject).toBe(mailText('appointment_confirmation', 'fr').subject);
    expect(c.subject).not.toContain('Addictologie');
    expect(c.html).not.toContain('<b>x</b>');
    const r = templates.appointmentReminder({ name: 'x', service: 'Addictologie', date: 'lundi', time: '10:00' });
    expect(r.subject).not.toMatch(/Addictologie|10:00/);
  });
});

describe('R43 source scan: subjects sent to a person carry no interpolation', () => {
  // the interpolated subjects that remain, each with why it is acceptable (none names a structure or quotes a message to a citizen)
  const ALLOWED = [
    ['api/_handlers/institution.js', 'institution space reset: fixed template subject + a fixed suffix'],
    ['api/_handlers/contact.js', 'to the site team (ADMIN_EMAIL), not to a person'],
    ['api/_handlers/cron/health-alert.js', 'operational alert to the operator'],
    ['api/_handlers/cron/rdv-reminder.js', 'J-1 reminder: date and time only (citizen), date and time to the structure; no structure or service name'],
    ['api/_services/pro-notifications.js', 'to professionals of the structure (catalogue label)'],
  ];
  const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []));
  it('every `subject: `…${…}…`` in api/ is in the reviewed list', () => {
    const found = [];
    for (const f of files('api')) {
      const t = fs.readFileSync(f, 'utf8');
      if (/subject:\s*`[^`]*\$\{[^`]*`/.test(t)) found.push(f.split(path.sep).join('/'));
    }
    expect(found.length).toBeGreaterThan(0);   // the scan does see the reviewed files
    const unexpected = [...new Set(found)].filter((f) => !ALLOWED.some(([a]) => a === f));
    expect(unexpected).toEqual([]);
  });
});
