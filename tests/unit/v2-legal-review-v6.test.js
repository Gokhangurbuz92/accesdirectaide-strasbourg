/**
 * Legal drafts v5-2026-11-15 → v6-2026-11-17 (owner conditions N2 / C3 / C4 / C6 of 17/11/2026; diff CONTROL/v2/V6_METIN_FARKI_FR.md):
 *  § 4  the Mailjet deletion sentence describes the real outcomes of the code — asked BEFORE our erasure, retried for at most the code's window inside
 *       the one-month deadline, then the account is erased anyway and a person is alerted; 6c and the old address of a change: one attempt. No
 *       unconditional promise.
 *  § 4  Vercel runtime logs by criterion (1 day on Pro, 30 days with Observability Plus) — never « désactivée » / « off » (not verified).
 *  § 3 P16, § 5, § 6  provider roles say the same thing: processors for the person's data; some also controllers for technical data (« notamment »).
 *  § 7  the framework list re-read on 17/11/2026.
 *  Six languages: every French passage has its translation, with the same figures.
 * v6 stays a DRAFT: Production hides it until VITE_LEGAL_DOCS_APPROVED_VERSION names v6; an approval of v5 does not carry over.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_STATUS, LEGAL_DRAFTS_VERSION, LEGAL_NOTICE_VARIANT_DOCUMENT, draftVisibility } from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { MAIL_CONTACT_DEADLINE_MARGIN_DAYS, MAIL_CONTACT_RETRY_WINDOW_DAYS } from '../../api/_services/privacy.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';
import { capabilityOpen } from '../../api/_utils/capabilities.js';

const LANGS = ['en', 'tr', 'ar', 'de', 'uk'];
const notice = LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === 'notice-confidentialite');
const section = (/** @type {string} */ s) => notice.sections.find((x) => x.id === s);
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const source = readFileSync('src/config/legal-drafts.js', 'utf8');

/** French master texts keyed like the locale files (« doc.section.iN / pN / title ») */
function frenchKeys(/** @type {any} */ doc) {
  /** @type {Record<string, string>} */ const out = { [`${doc.key}.title`]: doc.title, [`${doc.key}.intro`]: doc.intro };
  for (const s of doc.sections) {
    out[`${doc.key}.${s.id}.title`] = s.title;
    (s.items || []).forEach((/** @type {string} */ x, /** @type {number} */ i) => { out[`${doc.key}.${s.id}.i${i + 1}`] = x; });
    (s.paras || []).forEach((/** @type {string} */ x, /** @type {number} */ i) => { out[`${doc.key}.${s.id}.p${i + 1}`] = x; });
  }
  return out;
}
/** the figures of a text, sorted (Arabic: « يوم واحد » / « سنة واحدة » = 1, written in words in the translation) */
const figures = (/** @type {string} */ t) => (String(t).replace(/يوم واحد|سنة واحدة/g, ' 1 ').match(/\d+/g) || []).sort().join(',');

describe('legal drafts v6-2026-11-17', () => {
  it('one shared version on every document; every document is still a draft pending the owner\'s approval', () => {
    expect(LEGAL_DRAFTS_VERSION).toBe('v6-2026-11-17');
    for (const d of [...LEGAL_DRAFT_DOCUMENTS, LEGAL_NOTICE_VARIANT_DOCUMENT]) {
      expect(d.version).toBe('v6-2026-11-17');
      expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    }
  });

  it('Production hides v6 until it is approved by name; an approval of v5 (never in force) does not carry over', () => {
    const v5 = 'cgu-citoyen@v5-2026-11-15,notice-confidentialite@v5-2026-11-15';
    const v6 = 'cgu-citoyen@v6-2026-11-17,notice-confidentialite@v6-2026-11-17';
    for (const approved of [undefined, '', v5, 'v5-2026-11-15']) {
      expect(draftVisibility(notice, { approved, production: true, preview: '1' })).toBe('HIDDEN');
      expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved })).toBe(false);
    }
    expect(draftVisibility(notice, { approved: v6, production: true })).toBe('IN_FORCE');
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: v6 })).toBe(true);
  });

  it('§ 4 — the Mailjet sentence states the real outcomes, with the code\'s own figures, and no unconditional promise', () => {
    const item = section('retention').items[5];
    expect(item).toMatch(/^E-mails de service : /);
    expect(item).not.toMatch(/est supprimée lorsque votre compte est effacé/);
    expect(item).toContain("Lorsque votre compte est effacé, nous demandons à Mailjet de supprimer l'adresse qu'il a enregistrée, avant de l'effacer chez nous ; quand Mailjet confirme, il l'anonymise aussitôt et efface ses enregistrements après 30 jours.");
    expect(item).toContain(`S'il ne confirme pas, nous réessayons pendant ${MAIL_CONTACT_RETRY_WINDOW_DAYS} jours au plus, sans dépasser le délai d'un mois pour répondre à votre demande ; si l'échec persiste, votre compte est quand même effacé chez nous, une personne est avertie pour intervenir, et l'adresse peut rester chez Mailjet selon la règle indiquée plus bas (journaux techniques des prestataires).`);
    expect(item).toContain('Pour un compte jamais activé, la demande à Mailjet est faite au moment de son effacement automatique, sans nouvel essai.');
    expect(item).toContain("Après un changement d'adresse, la même demande est faite pour l'ancienne adresse, sans nouvel essai.");
    // the code that makes each clause true
    expect(MAIL_CONTACT_RETRY_WINDOW_DAYS).toBe(3);
    expect(MAIL_CONTACT_DEADLINE_MARGIN_DAYS).toBeGreaterThan(0);
    const privacy = readFileSync('api/_services/privacy.js', 'utf8');
    expect(privacy.indexOf("mailContacts.erase(account.email, { reason: 'account_erasure' })")).toBeLessThan(privacy.indexOf('await tombstones.record(tomb);'));
    expect(readFileSync('api/_services/mail-contact-failures.js', 'utf8')).toContain("HUMAN_INTERVENTION_LABEL = 'intervention humaine requise'");
    expect(readFileSync('api/_services/mail-contact-erasure.js', 'utf8')).toContain('anonymised at once and its records are deleted after 30 days');
    expect(source).toContain('« Contact details are immediately anonymized and all records will be deleted after 30 days »');
  });

  it('§ 4 — Vercel logs by criterion: 1 day on Pro, 30 days with Observability Plus; never « désactivée » or « off »', () => {
    const item = section('retention').items[11];
    expect(item).toMatch(/^Journaux techniques des prestataires : l'hébergeur \(Vercel\) garde ses journaux d'exécution 1 jour avec son offre Pro, et 30 jours lorsque son option « Observability Plus » est activée pour le site\. /);
    expect(item).not.toMatch(/désactiv|\boff\b/);
    expect(item).not.toMatch(/(gratuite|payante), que nous utilisons/);
    // the Mailjet plan is not asserted either: both published figures, by criterion
    expect(item).toContain("90 jours avec la formule gratuite de Mailjet, 13 mois avec une formule payante");
    expect(source).toContain('https://vercel.com/docs/observability/observability-plus');
    expect(source).toContain('« Observability Plus is not enabled » (404)');
  });

  it('§ 3 P16, § 5 and § 6 say the same thing about provider roles', () => {
    const p16 = section('purposes').items.find((x) => x.startsWith('P16'));
    expect(p16).toBe("P16 — Prestataires techniques : pour vos données, ils agissent sur instruction (art. 28) et n'ont pas de base propre ; ce que certains traitent aussi pour leur propre compte relève de leur propre responsabilité (section 6).");
    expect(section('recipients').paras[0]).toBe("Vos données ne sont ni vendues ni louées. Y ont accès : l'exploitant ; les prestataires techniques de la section 6, sur instruction pour vos données (la section 6 indique aussi ce que certains traitent pour leur propre compte).");
    const roles = section('processors').paras[0];
    expect(roles).toMatch(/^Pour vos données, chacun de ces prestataires agit sur instruction, comme sous-traitant,/);
    expect(roles).toContain('Certains traitent aussi, pour leur propre compte et sous leur propre responsabilité, des données techniques liées à l\'utilisation de leur service, notamment : Vercel');
    for (const name of ['Vercel, pour les données d\'usage', 'Sinch (Mailjet), pour acheminer', 'Upstash, pour la sécurité']) expect(roles).toContain(name);
    expect(roles).not.toMatch(/Deux d'entre eux/);
    for (const t of [p16, section('recipients').paras[0], roles]) expect(t).toMatch(/pour leur propre compte/);
  });

  it('§ 7 — the official framework list was re-read on 17/11/2026; still never claimed for Mailjet', () => {
    const t = section('transfers').paras[0];
    expect(t).toContain('(consultée le 17 novembre 2026)');
    expect(t).not.toContain('15 novembre');
    expect(source).toMatch(/dataprivacyframework\.gov\/list re-read in a browser on 17\/11\/2026/);
  });

  it('six languages: the same keys as French for the notice and the citizen terms, with the same figures in every passage', () => {
    for (const doc of LEGAL_DRAFT_DOCUMENTS.filter((d) => ['notice-confidentialite', 'cgu-citoyen'].includes(d.id))) {
      const fr = frenchKeys(doc);
      for (const lang of LANGS) {
        const tr = locale(lang);
        for (const [k, v] of Object.entries(fr)) {
          expect(tr[k], `${lang} ${k}`).toBeTruthy();
          expect(figures(tr[k]), `${lang} ${k}`).toBe(figures(v));
        }
        const extra = Object.keys(tr).filter((k) => k.startsWith(`${doc.key}.`) && !(k in fr) && !/\.(badge|label)\b/.test(k));
        expect(extra, `${lang} keys with no French master`).toEqual([]);
      }
    }
  });

  it('six languages: the changed passages carry the new content (Mailjet outcomes, Vercel criterion, roles, list date)', () => {
    for (const lang of LANGS) {
      const tr = locale(lang);
      const mail = tr['privacyNotice.retention.i6'];
      expect(mail, lang).toContain('Mailjet');
      expect(mail, lang).toMatch(/\b3\b/);
      expect(mail, lang).toMatch(/\b30\b/);
      expect(tr['privacyNotice.retention.i12'], lang).toContain('« Observability Plus »');
      expect(tr['privacyNotice.retention.i12'], lang).toContain('Pro');
      expect(tr['privacyNotice.processors.p1'], lang).toContain('Upstash');
      expect(tr['privacyNotice.processors.p1'], lang).toContain('Sinch (Mailjet)');
      expect(tr['privacyNotice.transfers.p1'], lang).toMatch(/17/);
      expect(tr['privacyNotice.transfers.p1'], lang).not.toMatch(/\b15\b/);
    }
    const en = locale('en');
    expect(en['privacyNotice.retention.i6']).toContain('If it does not confirm, we try again for 3 days at most, without exceeding the one-month period for answering your request; if the failure persists, your account is erased on our side all the same, a person is alerted to intervene');
    expect(en['privacyNotice.retention.i12']).toMatch(/^Providers' technical logs: the host \(Vercel\) keeps its runtime logs for 1 day on its Pro plan, and 30 days when its « Observability Plus » option is enabled for the site\. /);
    expect(en['privacyNotice.purposes.i10']).toMatch(/^P16 — Technical providers: for your data, they act on instructions/);
  });

  it('§ 4 — collected data and link lines match what Production does (comparison table in V6_METIN_FARKI_FR.md § 8)', () => {
    const items = section('retention').items;
    // the last sign-in date is stored (login, FranceConnect) and measures inactivity
    expect(items[0]).toContain('préférences de notification, date de la dernière connexion) :');
    expect(readFileSync('api/_handlers/auth/login.js', 'utf8')).toContain('lastSeenAt: new Date()');
    // expired links: only steps 6 / 6b of the purge delete them, and the production policy approves neither — the text no longer says « puis supprimés »
    expect(items[2]).not.toMatch(/puis supprimés\.$/);
    expect(items[2]).toContain("leur suppression automatique après expiration n'est pas encore activée : ils sont supprimés avec le compte.");
    expect(Object.keys(RETENTION_POLICY.approvedSteps || {})).toEqual(['unverifiedAccountsDeleted']);
    // closed account functions are named as such; they stay closed in the narrow scope (full accounts scope only)
    expect(items[13]).toMatch(/^Fonctions pas encore ouvertes \(notamment rendez-vous, message facultatif, notifications des professionnels, assistant, membres du foyer, historique de consultation, favoris, suivi des démarches\) :/);
    // the narrow 6B configuration (beta restricted, only the accounts surface opened, narrow accounts scope) — the env values of Production itself are not read here
    const prod = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts' };
    expect(capabilityOpen('citizen.account', prod)).toBe(true);
    for (const c of ['citizen.household', 'citizen.history', 'citizen.favorites', 'citizen.parcours', 'citizen.booking']) expect(capabilityOpen(c, prod), c).toBe(false);
  });
});
