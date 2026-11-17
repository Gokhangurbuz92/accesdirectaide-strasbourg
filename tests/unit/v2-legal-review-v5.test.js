/**
 * Provider verification (15/11/2026) of legal-drafts v4-2026-11-15 → v5-2026-11-15 (privacy notice only; the shared version moves for every document,
 * as for v4). Source: CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md (R1–R5), listed in the comment above the notice in src/config/legal-drafts.js.
 *  R1  § 4: Vercel runtime logs 1 day; Mailjet statistics by objective criterion (90 days free plan / 13 months paid plan — the plan of the account is
 *      not recorded, so no single figure is chosen), recipient address kept as a contact, deletion within 90 days after the contract, no published
 *      period for message content; Neon history tied to the free plan.
 *  R2  § 4: the Mailjet contact is deleted when the account is erased — true only with api/_services/mail-contact-erasure.js wired in (pinned here).
 *  R3  § 6: for some technical data Vercel and Sinch (Mailjet) act on their own behalf.
 *  R4  § 7: clauses incorporated into each provider's terms; official Data Privacy Framework list for Vercel Inc., Upstash, Inc. and Databricks, Inc.
 *      (read 15/11/2026) — never for Mailjet / Sinch.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFTS_VERSION, LEGAL_NOTICE_VARIANT_DOCUMENT, draftVisibility } from '../../src/config/legal-drafts.js';
import { RETENTION_POLICY, isPolicyApproved, policyDays } from '../../api/_services/retention-policy.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';

const LANGS = ['en', 'tr', 'ar', 'de', 'uk'];
const notice = LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === 'notice-confidentialite');
const section = (/** @type {string} */ s) => notice.sections.find((x) => x.id === s);
const textOf = (/** @type {any} */ s) => [s.title, ...(s.items || []), ...(s.paras || [])].join('\n');
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const source = readFileSync('src/config/legal-drafts.js', 'utf8');

describe('legal drafts v5-2026-11-15', () => {
  it('the version is bumped on every document (one shared version, as for v4)', () => {
    expect(LEGAL_DRAFTS_VERSION).toBe('v5-2026-11-15');
    for (const d of [...LEGAL_DRAFT_DOCUMENTS, LEGAL_NOTICE_VARIANT_DOCUMENT]) expect(d.version).toBe('v5-2026-11-15');
  });

  it('Production keeps hiding the drafts until VITE_LEGAL_DOCS_APPROVED_VERSION names v5 — an approval of v4 does not carry over', () => {
    const v4 = 'cgu-citoyen@v4-2026-11-15,notice-confidentialite@v4-2026-11-15';
    const v5 = 'cgu-citoyen@v5-2026-11-15,notice-confidentialite@v5-2026-11-15';
    for (const approved of [undefined, '', v4, 'v4-2026-11-15']) {
      expect(draftVisibility(notice, { approved, production: true, preview: '1' })).toBe('HIDDEN');
      expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved })).toBe(false);
    }
    expect(draftVisibility(notice, { approved: v5, production: true })).toBe('IN_FORCE');
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: v5 })).toBe(true);
    // the notice alone is not enough: an account is created under both documents
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: 'notice-confidentialite@v5-2026-11-15' })).toBe(false);
    expect(draftVisibility(notice, { approved: '', production: false, preview: '1' })).toBe('PREVIEW');
  });

  it('§ 4 keeps no « proposé » badge; § 3 bis is the only proposed section', () => {
    expect(isPolicyApproved(RETENTION_POLICY)).toBe(true);
    expect(section('retention').proposed).toBeUndefined();
    expect(notice.sections.filter((s) => s.proposed).map((s) => s.id)).toEqual(['purposes-later']);
  });

  it('§ 4: the retention table still equals retention-policy.js', () => {
    const items = section('retention').items;
    expect(items).toHaveLength(14);
    const days = (/** @type {string} */ k) => policyDays(RETENTION_POLICY, k);
    expect(days('UNVERIFIED_ACCOUNT_DAYS')).toBe(7);
    expect(items[1]).toContain("l'effacement automatique a lieu une fois par jour dès que le compte a 7 jours");
    expect(days('CONSENT_SUPERSEDED_DAYS')).toBe(3 * 365);
    expect(items[7]).toBe('Décisions de consentement remplacées par une décision plus récente : 3 ans après leur enregistrement.');
    expect(days('SUPPORT_REQUEST_DAYS')).toBe(365);
    expect(items[8]).toMatch(/12 mois après la clôture de la demande\.$/);
    expect(items[9]).toBe("Journaux d'administration et de sécurité (sans votre adresse électronique) : 12 mois.");
    // every duration of the policy that the notice states in days or months is still the policy's value
    const months = (/** @type {number} */ d) => Math.round(d / 30.4);
    for (const [key, d] of Object.entries(RETENTION_POLICY.durations)) expect(Number.isFinite(policyDays(RETENTION_POLICY, key)) || d.ownerChoice !== undefined, key).toBe(true);
    expect(months(days('SUPPORT_REQUEST_DAYS'))).toBe(12);
  });

  it('R1 — § 4: Vercel 1 day; Mailjet by objective criterion, never one guessed figure; the contact is disclosed; no period for message content', () => {
    const item = section('retention').items[11];
    expect(item).toBe("Journaux techniques des prestataires : l'hébergeur (Vercel) garde ses journaux d'exécution 1 jour. Le prestataire d'e-mails (Mailjet) garde les statistiques d'envoi 90 jours avec la formule gratuite de Mailjet, 13 mois avec une formule payante ; il enregistre l'adresse du destinataire comme contact et la garde tant que notre compte Mailjet existe, sauf si nous la supprimons avant ; à la fin de notre contrat, il efface les données dans un délai de 90 jours. Mailjet ne publie pas de durée pour le contenu des messages.");
    expect(item).not.toMatch(/1 heure|selon l'offre|dans sa documentation/);
    // both published figures, each tied to its plan
    expect(item).toMatch(/90 jours avec la formule gratuite de Mailjet, 13 mois avec une formule payante/);
    expect(source).toContain('https://vercel.com/docs/logs/runtime');
    expect(source).toContain('https://documentation.mailjet.com/hc/en-us/articles/360042755094-How-long-are-my-statistics-kept');
  });

  it('R1 — § 4: the Neon history is stated for the free plan in use', () => {
    const item = section('retention').items[12];
    expect(item).toContain('historique de la base de données chez Neon, 6 heures au plus avec la formule gratuite de Neon, que nous utilisons.');
    expect(item).toContain('copies de sauvegarde chiffrées, 35 jours au plus');
    expect(item).toContain('est gardée 40 jours hors de la base, chez Upstash (Francfort)');
    expect(source).toContain('https://neon.com/docs/introduction/plans');
  });

  it('R2 — § 4: the contact is deleted on erasure, and the code that makes it true is wired in', () => {
    const item = section('retention').items[5];
    expect(item).toMatch(/^E-mails de service : /);
    expect(item.endsWith("L'adresse enregistrée chez Mailjet est supprimée lorsque votre compte est effacé.")).toBe(true);
    expect(readFileSync('api/_services/mail-contact-erasure.js', 'utf8')).toContain('https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts');
    expect(readFileSync('api/_services/privacy.js', 'utf8')).toContain("mailContacts.erase(user.email, { reason: 'account_erasure' })");
    expect(readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8')).toContain("mailContactEraser.eraseMany(emails, { reason: 'unverified_account_purge' })");
    expect(readFileSync('api/_services/email-change.js', 'utf8')).toContain("mailContacts.erase(address, { reason: 'email_change' })");
  });

  it('R3 — § 6: on instruction for the person\'s data; Vercel and Sinch also act on their own behalf for some technical data', () => {
    const paras = section('processors').paras;
    expect(paras).toEqual(["Pour vos données, chacun de ces prestataires agit sur instruction, dans le cadre d'un accord de traitement des données (article 28 du RGPD) intégré à ses conditions de service. Deux d'entre eux traitent aussi certaines données techniques pour leur propre compte : Vercel, pour les données d'usage de son service ; Sinch (Mailjet), pour acheminer les messages, lutter contre le spam et la fraude et sécuriser son réseau."]);
    expect(section('processors').items).toHaveLength(6);
  });

  it('R4 — § 7: clauses incorporated; the official list for Vercel Inc., Upstash, Inc. and Databricks, Inc.; Upstash relies on the framework first', () => {
    const t = section('transfers').paras.join('\n');
    expect(section('transfers').paras).toHaveLength(1);
    expect(t).toContain("Les garanties prévues sont les clauses contractuelles types de la Commission européenne (décision d'exécution (UE) 2021/914), intégrées aux conditions de chaque prestataire. Vercel Inc. et Upstash, Inc. sont en outre inscrites sur la liste officielle du cadre de protection des données UE–États-Unis (consultée le 15 novembre 2026) ; Upstash s'appuie d'abord sur ce cadre, et sur les clauses contractuelles types s'il ne s'applique plus. Databricks, Inc. (Neon) y est également inscrite. Scaleway SAS fait exception");
    expect(t).not.toMatch(/déclarent en outre adhérer|selon les conditions de chaque prestataire/);
    expect(t).toMatch(/^La plupart de ces prestataires appartiennent à des groupes établis aux États-Unis ; Mailjet appartient au groupe suédois Sinch/);
  });

  it('no Data Privacy Framework claim for Mailjet, Sinch or Mailgun — in French and in the five translations', () => {
    const t = section('transfers').paras.join('\n');
    const framework = t.slice(t.indexOf('Les garanties prévues'), t.indexOf('Scaleway SAS fait exception'));
    expect(framework).toContain('cadre de protection des données UE–États-Unis');
    expect(framework).not.toMatch(/Mailjet|Sinch|Mailgun/);
    expect(textOf(notice.sections.find((s) => s.id === 'processors'))).not.toMatch(/cadre de protection des données|Data Privacy Framework/);
    for (const lang of LANGS) {
      const p = locale(lang)['privacyNotice.transfers.p1'];
      const from = p.indexOf('2021/914'); const to = p.indexOf('Scaleway SAS');
      expect(from, lang).toBeGreaterThan(-1); expect(to, lang).toBeGreaterThan(from);
      const part = p.slice(from, to);
      for (const name of ['Vercel Inc.', 'Upstash, Inc.', 'Databricks, Inc. (Neon)']) expect(part, `${lang} ${name}`).toContain(name);
      expect(part, lang).not.toMatch(/Mailjet|Sinch|Mailgun/);
      expect(part, lang).toMatch(/15/);
      expect(part, lang).toMatch(/2026/);
    }
    expect(source).toContain('Active on dataprivacyframework.gov/list, read 15/11/2026');
    expect(source).not.toMatch(/self-declarations only|transfer clause was NOT read|Mailjet log period: NO figure/);
  });

  it('no postal address or telephone number of the publisher anywhere in the drafts', () => {
    const all = LEGAL_DRAFT_DOCUMENTS.map((d) => [d.title, d.intro, ...d.sections.map(textOf)].join('\n')).join('\n');
    expect(all).not.toMatch(/(?:\+33|\b0[1-9])(?:[ .]?\d{2}){4}\b/);
    expect(all).not.toMatch(/\b\d{1,3},? (?:rue|avenue|boulevard|allée|impasse|place|quai|route|chemin)\b/i);
  });

  it('the five translations carry every changed passage, with the same figures and no stale wording', () => {
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const [s, n] of [['retention', 14], ['processors', 6]]) {
        for (let i = 1; i <= Number(n); i++) expect(tr[`privacyNotice.${s}.i${i}`], `${lang} ${s}.i${i}`).toBeTruthy();
        expect(tr[`privacyNotice.${s}.i${Number(n) + 1}`], `${lang} ${s}.i${Number(n) + 1}`).toBeUndefined();
      }
      // R2: the last sentence of the service e-mails line names Mailjet
      const mails = tr['privacyNotice.retention.i6'];
      expect(mails.split(/[.。] /).at(-1), lang).toContain('Mailjet');
      // R1: 1 day for Vercel (no « 1 hour » range left), both Mailjet figures, the 90-day deletion, Neon's 6 hours on the free plan
      const logs = tr['privacyNotice.retention.i12'];
      const [vercelPart, mailjetPart] = [logs.slice(0, logs.indexOf('Mailjet')), logs.slice(logs.indexOf('Mailjet'))];
      expect(vercelPart, lang).toContain('Vercel');
      expect(vercelPart, lang).not.toMatch(/\b1 (hour|Stunde|saat|години)\b|ساعة/);
      expect(mailjetPart.match(/90/g), lang).toHaveLength(2);
      expect(mailjetPart.match(/13/g), lang).toHaveLength(1);
      expect(mailjetPart.split('Mailjet').length, lang).toBeGreaterThanOrEqual(4);
      const history = tr['privacyNotice.retention.i13'];
      expect(history, lang).toMatch(/Neon[^.]*6[^.]*Neon|6[^.]*Neon[^.]*Neon|Neon[^.]*Neon[^.]*6/);
      expect(history, lang).toMatch(/35/);
      expect(history, lang).toMatch(/40/);
      // R3: both own-account controllers are named
      const roles = tr['privacyNotice.processors.p1'];
      expect(roles, lang).toContain('Vercel');
      expect(roles, lang).toContain('Sinch (Mailjet)');
      expect(roles, lang).toMatch(/28/);
      expect(roles.length, lang).toBeGreaterThan(250);
    }
    const en = locale('en');
    expect(en['privacyNotice.retention.i12']).toBe("Providers' technical logs: the host (Vercel) keeps its runtime logs for 1 day. The e-mail provider (Mailjet) keeps sending statistics for 90 days on Mailjet's free plan, 13 months on a paid plan; it records the recipient's address as a contact and keeps it as long as our Mailjet account exists, unless we delete it earlier; at the end of our contract, it erases the data within 90 days. Mailjet does not publish a period for the content of messages.");
    expect(en['privacyNotice.retention.i6']).toMatch(/ The address recorded at Mailjet is deleted when your account is erased\.$/);
    expect(en['privacyNotice.transfers.p1']).toContain('Vercel Inc. and Upstash, Inc. are in addition on the official list of the EU–US Data Privacy Framework (consulted on 15 November 2026); Upstash relies first on this framework, and on the standard contractual clauses if it no longer applies. Databricks, Inc. (Neon) is also on that list.');
    expect(en['privacyNotice.transfers.p1']).not.toMatch(/declare that they adhere/);
    expect(en['privacyNotice.processors.p1']).toMatch(/^For your data, each of these providers acts on instruction/);
    expect(en['badge.proposed']).toBeTruthy();
  });
});
