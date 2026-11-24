/**
 * Final review (15/11/2026) of legal-drafts v3-2026-11-14 → v4-2026-11-15 (privacy notice): the approved retention periods lose the « proposé » badge,
 * § 7 states only what a primary source says (SCC for all; Data Privacy Framework as a self-declaration of Vercel and Upstash; Mailjet = Swedish group Sinch),
 * § 11 no longer calls the directory basis and period « proposées », § 4 gains the superseded-consent and support lines the code already applies and no
 * longer says the Mailjet log period is « en cours de vérification », § 6 says the pages are served by Vercel's network, § 8 adds the post-mortem directives
 * (loi n° 78-17, art. 85). The sources read on 15/11/2026 are listed in the comment above the notice in src/config/legal-drafts.js.
 * The current version is pinned by v2-legal-review-v5.test.js (provider verification: Mailjet retention, provider roles, Data Privacy Framework list);
 * what v4 changed and v5 kept must stay true in every later version, which is what this file keeps checking.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFTS_R4_NOTICE, LEGAL_DRAFTS_R4_CGU, LEGAL_DRAFTS_PRO_V11, LEGAL_DRAFTS_PRO_V11_DOCUMENT_IDS, LEGAL_DRAFTS_R3_NOTICE, LEGAL_DRAFTS_R3_CGU, LEGAL_DRAFTS_R3_NOTICE_DOCUMENT_IDS, LEGAL_DRAFTS_R3_CGU_DOCUMENT_IDS, LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFTS_VERSION, LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V8_DOCUMENT_IDS, LEGAL_DRAFTS_V9, LEGAL_DRAFTS_V9_DOCUMENT_IDS, LEGAL_DRAFTS_V9_PRO, LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS, LEGAL_NOTICE_VARIANT_DOCUMENT, LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V10_DOCUMENT_IDS, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V11_DOCUMENT_IDS, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V12_DOCUMENT_IDS, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_V13_DOCUMENT_IDS, LEGAL_DRAFTS_STRUCTURES_V9, LEGAL_DRAFTS_STRUCTURES_V9_DOCUMENT_IDS } from '../../src/config/legal-drafts.js';
import { RETENTION_POLICY, isPolicyApproved, policyDays } from '../../api/_services/retention-policy.js';

const LANGS = ['en', 'tr', 'ar', 'de', 'uk'];
// G8 (19/11/2026): the notice's newest draft is v9 (professional accounts inserted in §§ 3, 4, 5, 8): this file pins the positions of the v8 text,
// which v9 keeps word for word apart from its own changes (tests/unit/g8-notice-v9.test.jsx)
const notice = LEGAL_DRAFT_DOCUMENTS_V8.find((d) => d.id === 'notice-confidentialite');
const section = (/** @type {string} */ s) => notice.sections.find((x) => x.id === s);
const textOf = (/** @type {any} */ s) => [s.title, ...(s.items || []), ...(s.paras || [])].join('\n');
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));

describe('legal drafts: what the v4 review (15/11/2026) changed still holds', () => {
  it('every document carries the one current version, v4 or later', () => {
    expect(LEGAL_DRAFTS_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
    expect(Number(LEGAL_DRAFTS_VERSION.slice(1).split('-')[0])).toBeGreaterThanOrEqual(4);
    // G4 (19/11/2026): v8 covers the two professional documents only; the others keep the shared version
    for (const d of [...LEGAL_DRAFT_DOCUMENTS, LEGAL_NOTICE_VARIANT_DOCUMENT]) expect(d.version).toBe(LEGAL_DRAFTS_R3_NOTICE_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_R4_NOTICE : LEGAL_DRAFTS_R3_CGU_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_R4_CGU : LEGAL_DRAFTS_PRO_V11_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_PRO_V11 : LEGAL_DRAFTS_STRUCTURES_V9_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_STRUCTURES_V9 : LEGAL_DRAFTS_V13_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V13 : LEGAL_DRAFTS_V12_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V12 : LEGAL_DRAFTS_V11_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V11 : LEGAL_DRAFTS_V10_DOCUMENT_IDS.includes(d.id) && d.sections ? LEGAL_DRAFTS_V10 : LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V9_PRO : LEGAL_DRAFTS_V9_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V9 : LEGAL_DRAFTS_V8_DOCUMENT_IDS.includes(d.id) ? LEGAL_DRAFTS_V8 : LEGAL_DRAFTS_VERSION);   // G8: the notice is at v9; G14: the professional terms at v9-2026-11-22 (draft)
  });

  it('§ 4: the retention periods are approved — no « proposé » badge; § 3 bis keeps it', () => {
    expect(isPolicyApproved(RETENTION_POLICY)).toBe(true);
    expect(section('retention').proposed).toBeUndefined();
    expect(section('purposes-later').proposed).toBe(true);
    expect(notice.sections.filter((s) => s.proposed).map((s) => s.id)).toEqual(['purposes-later']);
  });

  it('§ 4: superseded consent decisions and support requests follow the policy constants', () => {
    expect(policyDays(RETENTION_POLICY, 'CONSENT_SUPERSEDED_DAYS')).toBe(3 * 365);
    expect(policyDays(RETENTION_POLICY, 'SUPPORT_REQUEST_DAYS')).toBe(365);
    expect(RETENTION_POLICY.durations.SUPPORT_REQUEST_DAYS.anchor).toBe('closedAt');
    const items = section('retention').items;
    expect(items[7]).toBe('Décisions de consentement remplacées par une décision plus récente : 3 ans après leur enregistrement.');
    expect(items[8]).toMatch(/^Demandes d'aide adressées au support par le formulaire d'aide \(pas encore ouvert\), y compris pour retrouver l'accès à un compte : 12 mois après la clôture de la demande\.$/);
    expect(items).toHaveLength(14);
  });

  it('§ 4: no « en cours de vérification »; the Mailjet periods are the published ones (pinned by the v5 test), never a reference to « sa documentation »', () => {
    const t = textOf(section('retention'));
    expect(t).not.toMatch(/en cours de vérification/);
    expect(t).not.toMatch(/durée fixée par Mailjet dans sa documentation/);
  });

  it('§ 6: the functions run in Frankfurt and the static pages are served by Vercel\'s network', () => {
    const vercel = section('processors').items[0];
    expect(vercel).toMatch(/^Vercel Inc\. : hébergement du site et des fonctions serveur, exécutées à Francfort ; les pages elles-mêmes \(contenu statique, sans donnée de compte\) sont distribuées par le réseau mondial de Vercel\.$/);
    expect(readFileSync('docs/production-hosting.md', 'utf8')).toMatch(/fonctions à Francfort \(`fra1`\) ; pages et fichiers publics distribués par le réseau mondial de Vercel/);
  });

  it('§ 7: SCC for all, the Data Privacy Framework never claimed for Mailjet / Sinch, Mailjet in the Swedish group Sinch', () => {
    const t = section('transfers').paras.join('\n');
    expect(t).toMatch(/^La plupart de ces prestataires appartiennent à des groupes établis aux États-Unis ; Mailjet appartient au groupe suédois Sinch, qui a des filiales aux États-Unis : un accès depuis les États-Unis est possible\./);
    expect(t).toContain("clauses contractuelles types de la Commission européenne (décision d'exécution (UE) 2021/914)");
    expect(t).not.toMatch(/^Ces prestataires appartiennent/);
    expect(t).not.toMatch(/pour Vercel, Upstash et Mailjet/);
    // everything after the clauses (the framework sentences) names neither Mailjet nor Sinch, Cloudflare or Microsoft
    const dpf = t.slice(t.indexOf('Les garanties prévues'), t.indexOf('Scaleway SAS fait exception'));
    expect(dpf).toContain('cadre de protection des données UE–États-Unis');
    expect(dpf).not.toMatch(/Mailjet|Sinch|Mailgun|Cloudflare|Microsoft/);
    expect(t).toContain("Scaleway SAS fait exception : c'est une société française");
  });

  it('§ 8: the directives on the fate of the data after death (loi Informatique et Libertés, art. 85); the v3 rights stay', () => {
    const rights = section('rights');
    expect(rights.items).toHaveLength(5);
    expect(rights.items[4]).toMatch(/^Directives sur le sort de vos données après votre décès \(conservation, effacement, communication\) : vous pouvez en définir, selon l'article 85 de la loi Informatique et Libertés\.$/);
    expect(rights.paras).toHaveLength(3);
    expect(readFileSync('src/config/legal-drafts.js', 'utf8')).toContain('LEGIARTI000039280582');
  });

  it('§ 11: the directory basis and period are stated, not « proposées »', () => {
    const p = section('art14').paras[1];
    expect(p).toBe("Finalité : informer le public sur les services qui existent. Base : intérêt légitime (article 6, paragraphe 1, f) du RGPD. Durée : tant que la source officielle publie l'information ; mise à jour à chaque import.");
    expect(textOf(section('art14'))).not.toMatch(/propos/i);
  });

  it('no postal address or telephone number of the publisher anywhere in the drafts', () => {
    const all = LEGAL_DRAFT_DOCUMENTS.map((d) => [d.title, d.intro, ...d.sections.map(textOf)].join('\n')).join('\n');
    expect(all).not.toMatch(/(?:\+33|\b0[1-9])(?:[ .]?\d{2}){4}\b/);
    expect(all).not.toMatch(/\b\d{1,3},? (?:rue|avenue|boulevard|allée|impasse|place|quai|route|chemin)\b/i);
  });

  it('the five translations carry every changed passage, with the same item count and no stale wording', () => {
    const nItems = (/** @type {string} */ s) => section(s).items.length;
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const [s, n] of [['retention', nItems('retention')], ['rights', nItems('rights')], ['processors', nItems('processors')]]) {
        for (let i = 1; i <= n; i++) expect(tr[`privacyNotice.${s}.i${i}`], `${lang} ${s}.i${i}`).toBeTruthy();
        expect(tr[`privacyNotice.${s}.i${n + 1}`], `${lang} ${s}.i${n + 1}`).toBeUndefined();
      }
      // § 4: the two new lines sit right after the restricted archives; the unverified-account line (i2) and the last line did not move
      expect(tr['privacyNotice.retention.i8'], lang).toMatch(/3/);
      expect(tr['privacyNotice.retention.i9'], lang).toMatch(/12/);
      expect(tr['privacyNotice.retention.i12'], lang).toMatch(/Vercel/);
      expect(tr['privacyNotice.retention.i12'], lang).toMatch(/Mailjet/);
      expect(tr['privacyNotice.retention.i13'], lang).toMatch(/Neon/);
      expect(tr['privacyNotice.retention.i13'], lang).toMatch(/Upstash/);
      // § 6
      expect(tr['privacyNotice.processors.i1'], lang).toMatch(/^Vercel Inc\./);
      expect(tr['privacyNotice.processors.i1'].length, lang).toBeGreaterThan(120);
      // § 7
      const transfers = tr['privacyNotice.transfers.p1'];
      expect(transfers, lang).toMatch(/2021\/914/);
      for (const name of ['Mailjet', 'Sinch', 'Vercel', 'Upstash', 'Scaleway SAS']) expect(transfers, `${lang} ${name}`).toContain(name);
      expect(transfers, lang).not.toMatch(/Mailjet \(Sinch\)/);
      // § 8 and § 11: French legal names stay in French
      expect(tr['privacyNotice.rights.i5'], lang).toContain('loi Informatique et Libertés');
      expect(tr['privacyNotice.rights.i5'], lang).toMatch(/85/);
      expect(tr['privacyNotice.art14.p2'], lang).not.toMatch(/[Pp]roposed|Önerilen|المقترح|Vorgeschlagene|Запропонован/);
    }
    expect(locale('en')['privacyNotice.art14.p2']).toContain('Basis: legitimate interest (GDPR Article 6(1)(f)). Period: as long as the official source publishes the information');
    expect(locale('en')['badge.proposed']).toBeTruthy();
  });
});
