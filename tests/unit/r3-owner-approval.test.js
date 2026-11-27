/**
 * Release 3 — the owner's legal approval of 24/11/2026 (verbatim: CONTROL/master/completion/R3_OWNER_APPROVAL_2026-11-24.md; OWNER_VALIDATED — the
 * controller's own approval, not a lawyer's or an expert's review), applied to the code like the G14 approval of 23/11/2026:
 *   - notice-confidentialite v14-2026-11-24, cgu-citoyen v13-2026-11-24 and cgu-professionnel v11-2026-11-24 approved (conditions-structures v9 unchanged);
 *     every text added by the release-3 package carries no « proposé / à approuver / à valider » mark, in French and in en, de, tr, ar, uk;
 *   - P27: the existence of a measure treated as data concerning health, condition art. 9, 2, f (owner decision);
 *   - a document is still in force only once VITE_LEGAL_DOCS_APPROVED_VERSION names it;
 *   - the eleven release-3 durations decided (decidedOn 2026-11-24), NOT approved steps; a new policy version that Production must pin;
 *   - the register (0.8): T29–T34 decided, AIPD lines signed by the owner, nothing claiming a lawyer's or an expert's review.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));

const L = await import('../../src/config/legal-drafts.js');
const { RETENTION_POLICY, R3_DECISION, R3_DECIDED_STEP_IDS, stepApprovalProblem, executionGate } = await import('../../api/_services/retention-policy.js');
const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');

const find = (/** @type {any[]} */ set, /** @type {string} */ id) => /** @type {any} */ (set.find((d) => d.id === id));
const keys = (/** @type {any} */ doc) => Object.fromEntries(L.draftTextKeys(doc));
/** the texts a release-3 document adds or changes against its base, as locale keys → French */
const added = (/** @type {any} */ base, /** @type {any} */ next) => {
  const a = keys(base); const b = keys(next);
  return Object.fromEntries(Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => [`${next.key}.${k}`, b[k]]));
};
const R3_TEXTS = {
  ...added(find(L.LEGAL_DRAFT_DOCUMENTS_V13, 'notice-confidentialite'), find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, 'notice-confidentialite')),
  ...added(find(L.LEGAL_DRAFT_DOCUMENTS_V12, 'cgu-citoyen'), find(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU, 'cgu-citoyen')),
  ...added(find(L.LEGAL_DRAFT_DOCUMENTS_PRO_V10, 'cgu-professionnel'), find(L.LEGAL_DRAFT_DOCUMENTS_PRO_V11, 'cgu-professionnel')),
};
const MARKS = {
  fr: /à valider|à approuver|Base proposée|durées? proposées?|sont proposées|en attente de l.approbation/,
  en: /to be approved|to be validated|Proposed basis|proposed duration|are proposed/i,
  de: /noch zu genehmigen|zu validieren|Vorgeschlagene Grundlage|vorgeschlagene Dauer|sind vorgeschlagen/i,
  tr: /onaylanacak|Önerilen dayanak|önerilen süre|önerilmiştir/i,
  ar: /بانتظار الموافقة|الأساس المقترح|مدة مقترحة|مقترحتان/,
  uk: /підлягає затвердженню|підлягають затвердженню|Запропонована підстава|запропонований строк|запропоновано/i,
};
const REVIEW_CLAIM = /avocat|juriste|expert|lawyer|Anwalt|avukat|محام|юрист/i;
const APPROVED = 'cgu-citoyen@v13-2026-11-24,notice-confidentialite@v14-2026-11-24,cgu-professionnel@v11-2026-11-24,conditions-structures@v9-2026-11-23';

/** group 1 (expired technical records), approved by the owner on 27/11/2026 after the Production dry run */
const G1_STEPS = ['deletedTokensCount', 'deletedEmailChangeCount', 'deletedOutlookTokensCount', 'deletedAiMetricsCount', 'deletedLogsCount', 'pushSubscriptionsFailingDeleted', 'jobListingsExpiredMarked'];

describe('R3 owner approval (24/11/2026) — legal texts', () => {
  it('status strings: approved on 24/11/2026 by the controller, worded like LEGAL_DRAFTS_V12_STATUS; no review claimed', () => {
    expect(L.LEGAL_DRAFTS_V12_STATUS).toMatch(/^APPROVED — approuvée le 23\/11\/2026 par le responsable/);
    expect(L.LEGAL_DRAFTS_R3_STATUS).toMatch(/^APPROVED — approuvée le 24\/11\/2026 par le responsable, à mettre en vigueur à l’ouverture de la release 3/);
    expect(L.LEGAL_DRAFTS_R3_STATUS).toMatch(/cgu-professionnel v11-2026-11-24 ; conditions-structures v9-2026-11-23 inchangées'?$/);
    expect(L.LEGAL_DRAFTS_R3_STATUS).not.toMatch(/DRAFT|proposée|en attente|avocat|expert/);
  });
  it('the release-3 texts exist (notice, citizen terms, professional terms) and carry no « to be approved » mark in French', () => {
    expect(Object.keys(R3_TEXTS).length).toBeGreaterThan(40);
    for (const k of ['privacyNotice.purposes.p24_v14', 'privacyNotice.purposes.p29_v14', 'privacyNotice.institutions.p3_v14', 'cguCitoyen.account.household_v13', 'cguPro.use.messaging_v11']) expect(R3_TEXTS[k], k).toBeTypeOf('string');
    for (const [k, t] of Object.entries(R3_TEXTS)) { expect(t, k).not.toMatch(MARKS.fr); expect(t, k).not.toMatch(REVIEW_CLAIM); }
  });
  it('six languages: every release-3 text is translated and none carries a « proposed / to be approved » mark', () => {
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const k of Object.keys(R3_TEXTS)) {
        expect(typeof loc[k], `${lang} ${k}`).toBe('string');
        expect(loc[k], `${lang} ${k}`).not.toMatch(MARKS[/** @type {'en'} */ (lang)]);
        expect(loc[k], `${lang} ${k}`).not.toMatch(REVIEW_CLAIM);
      }
      // P27: art. 9, 2, f in every language (owner decision 24/11/2026)
      expect(loc['privacyNotice.purposes.p27_v14'], lang).toMatch(/9(, |، | Abs\. )2(, |، | lit\. )(f|و)/);
    }
  });
  it('decided bases: P27 art. 9, 2, f; § 14 legitimate interest; durations of § 14 and of message reports without a mark', () => {
    const n = keys(find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, 'notice-confidentialite'));
    expect(n['purposes.p27_v14']).toMatch(/Base : intérêt légitime \(art\. 6, 1, f\).*art\. 9, 2, f \(constatation, exercice ou défense d'un droit en justice\)\.$/);
    expect(n['institutions.p3_v14']).toMatch(/^Finalité : donner l'accès prévu par la convention et le sécuriser\. Base : intérêt légitime \(art\. 6, 1, f\)/);
    expect(n['institutions.p4_v14']).toMatch(/5 ans après sa fin, comme preuve de ce qui a été convenu ; le journal/);
    expect(n['retention.messaging_v14']).toMatch(/supprimé 12 mois après son traitement\.$/);
    // backups of Mon Coffre: the owner approved « the rotation period Scalingo will confirm in writing » — that sentence stays
    expect(n['retention.vault_v14']).toMatch(/à confirmer par écrit par Scalingo/);
  });
  it('still in force only once the build names them; release-2 value keeps the release-2 texts', () => {
    expect(L.approvedVersionOf('notice-confidentialite', APPROVED)).toBe('v14-2026-11-24');
    expect(L.approvedVersionOf('cgu-citoyen', APPROVED)).toBe('v13-2026-11-24');
    expect(L.approvedVersionOf('cgu-professionnel', APPROVED)).toBe('v11-2026-11-24');
    expect(L.approvedVersionOf('conditions-structures', APPROVED)).toBe('v9-2026-11-23');
    const n14 = find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, 'notice-confidentialite');
    expect(L.draftVisibility(n14, { approved: '', production: true })).toBe('HIDDEN');
    expect(L.draftVisibility(n14, { approved: APPROVED, production: true })).toBe('IN_FORCE');
    for (const d of [n14, find(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU, 'cgu-citoyen'), find(L.LEGAL_DRAFT_DOCUMENTS_PRO_V11, 'cgu-professionnel')]) expect(d.status).toBe(L.LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
  });
});

describe('R3 owner approval — retention', () => {
  const KEYS = ['RDV_CONVERSATION_DAYS', 'DELEGATION_INVITATION_EXPIRED_DAYS', 'DELEGATION_ENDED_DAYS', 'GUARDIAN_LINK_REVOKED_DAYS', 'LEGAL_PROTECTION_DECLARED_STALE_DAYS',
    'LEGAL_PROTECTION_REJECTED_DAYS', 'LEGAL_PROTECTION_ENDED_DAYS', 'CONTENT_REPORT_CLOSED_DAYS', 'PARTNERSHIP_REQUEST_CLOSED_DAYS', 'INSTITUTION_ACCOUNT_SUSPENDED_DAYS', 'PARTNER_AGREEMENT_ENDED_DAYS'];
  it('the eleven durations are decided on 24/11/2026 with the approved figures, none pending', () => {
    const D = RETENTION_POLICY.durations;
    expect(KEYS.map((k) => D[k].days)).toEqual([730, 30, 365, 30, 90, 90, 365, 365, 365, 365, 1825]);
    for (const k of KEYS) { expect(D[k], k).toMatchObject({ decidedOn: '2026-11-24', basis: R3_DECISION }); expect(D[k].pendingApproval, k).toBeUndefined(); }
    expect(Object.values(D).filter((d) => /** @type {any} */ (d).pendingApproval)).toEqual([]);
    expect(R3_DECISION).toMatch(/^décision du responsable 24\/11\/2026/);
  });
  it('their steps are decided, not approved: no execution without a dry run read and a verified backup recorded in approvedSteps', () => {
    expect([...R3_DECIDED_STEP_IDS].sort()).toEqual(PURGE_STEPS.filter((s) => KEYS.includes(s.durationKey)).map((s) => s.id).sort());
    for (const id of R3_DECIDED_STEP_IDS) {
      expect(RETENTION_POLICY.decidedSteps[id], id).toEqual({ decidedOn: '2026-11-24', decision: R3_DECISION });
      expect(RETENTION_POLICY.approvedSteps[id], id).toBeUndefined();
      expect(stepApprovalProblem(RETENTION_POLICY, /** @type {any} */ (PURGE_STEPS.find((s) => s.id === id))), id).toBe('STEP_NOT_APPROVED_IN_POLICY');
    }
    expect(Object.keys(RETENTION_POLICY.approvedSteps)).toEqual(['unverifiedAccountsDeleted', ...G1_STEPS]);
  });
  it('a new policy version; Production must pin GDPR_PURGE_POLICY_VERSION to it, the previous pin is a dry run', () => {
    expect(RETENTION_POLICY.version).toBe('g14-r3-2026-11-24-a7-365d');
    expect(RETENTION_POLICY.approvedPolicyVersion).toBe(RETENTION_POLICY.version);
    const env = { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_APPROVED_STEPS: 'unverifiedAccountsDeleted' };
    expect(executionGate(RETENTION_POLICY, { ...env, GDPR_PURGE_POLICY_VERSION: 'g14-expansion-2-2026-11-23-a7-365d' }).reason).toBe('POLICY_VERSION_NOT_PINNED');
    expect(executionGate(RETENTION_POLICY, { ...env, GDPR_PURGE_POLICY_VERSION: 'g14-r3-2026-11-24-a7-365d' }).execute).toBe(true);
  });
});

describe('R3 owner approval — register 0.8', () => {
  const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
  const t = (/** @type {string} */ id) => reg.traitements.find((/** @type {any} */ x) => x.id === id);
  it('T29–T34 decided on 24/11/2026; no « proposé / à valider / à approuver » left in them; no claim of review', () => {
    expect(reg.version).toBe('0.9');   // 0.8 = R3 approval, 0.9 = G14-R4 drafts
    for (const id of ['T29', 'T30', 'T31', 'T32', 'T33', 'T34']) {
      const s = JSON.stringify(t(id));
      expect(s, id).toMatch(/24\/11\/2026/);
      expect(s, id).not.toMatch(/à valider|à approuver|PROPOSÉE|ouverture proposée|non signée|à signer/);
      expect(s, id).not.toMatch(/avocat|juriste a validé|expert a validé/);
    }
    expect(t('T33').base_legale_proposee).toMatch(/art\. 9\.2\.f/);
    expect(t('T34').base_legale_proposee).toMatch(/R8, signée par le responsable le 24\/11\/2026/);
    expect(t('T04').base_legale_r3).toMatch(/P29, décidé par le responsable le 24\/11\/2026$/);
    expect(t('T05').base_legale_r3).toMatch(/P28, décidé par le responsable le 24\/11\/2026$/);
    expect(t('T15').base_legale_r3).toMatch(/notice v14 § 14, décidé par le responsable le 24\/11\/2026$/);
    // decided durations stay « non appliqué » while no step is approved
    for (const id of ['T30', 'T31', 'T33']) for (const c of t(id).conservation.filter((/** @type {any} */ x) => /décidée par le responsable le 24\/11\/2026/.test(x.description))) expect(c.statut, id).toBe('non appliqué');
  });
});
