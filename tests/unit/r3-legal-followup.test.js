/**
 * Release-3 follow-up (24/11/2026, PROPOSED — drafts for the owner's approval, no lawyer or expert review claimed):
 *   - notice-confidentialite v14-2026-11-24 and cgu-citoyen v13-2026-11-24 EXTENDED (same versions): appointment messaging (P29), Mon Coffre at the HDS
 *     host (P28, art. 9.2.a), the places' own booking pages, the partner bridge (no partner connected), § 14 institution users;
 *   - NEW draft cgu-professionnel v11-2026-11-24 (messaging rules, delegate member of a partner, own booking page);
 *   - retention proposals « à approuver » (ContentReport, PartnershipRequest, suspended InstitutionAccount, ended PartnerAgreement): never executable;
 *   - release preflight legal.r3_followup: a feature opened under older texts is a FAIL;
 *   - register (REGISTRE_RGPD.json): T04 / T05 / T10 / T11 / T15 lines, T34 partner bridge, Scalingo SAS (HDS) planned.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));

const L = await import('../../src/config/legal-drafts.js');
const { RETENTION_POLICY, R3_PROPOSAL, stepApprovalProblem } = await import('../../api/_services/retention-policy.js');
const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');

const keys = (/** @type {any} */ d) => Object.fromEntries(L.draftTextKeys(d));
const find = (/** @type {any[]} */ set, /** @type {string} */ id) => set.find((d) => d.id === id);
const n14 = keys(find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, 'notice-confidentialite'));
const c13 = keys(find(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU, 'cgu-citoyen'));
const p10 = keys(find(L.LEGAL_DRAFT_DOCUMENTS_PRO_V10, 'cgu-professionnel'));
const p11 = keys(find(L.LEGAL_DRAFT_DOCUMENTS_PRO_V11, 'cgu-professionnel'));

describe('notice v14 / cgu v13 (same versions, extended) — what the release-3 agents flagged', () => {
  it('messaging P29: recipients, server-side encryption (not end to end), no attachments before HDS, no health data, report without the text', () => {
    const t = n14['purposes.p29_v14'];
    expect(t).toMatch(/membres de cette structure qui ont un compte ADA Pro/);
    expect(t).toMatch(/ce n'est pas un chiffrement de bout en bout/);
    expect(t).toMatch(/pièces jointes ne sont pas ouvertes/);
    expect(t).toMatch(/N'écrivez pas d'information sur votre santé/);
    expect(t).toMatch(/jamais le texte/);
    expect(n14['retention.messaging_v14']).toMatch(/2 ans après son dernier message/);
    expect(RETENTION_POLICY.durations.RDV_CONVERSATION_DAYS).toMatchObject({ days: 730, ecode: 'E9' });
  });
  it('Mon Coffre P28: end to end in the browser, Scalingo SAS HDS certificate 38436, art. 9.2.a consent never pre-ticked, lost passphrase = lost documents', () => {
    const t = n14['purposes.p28_v14'];
    for (const rx of [/chiffrement de bout en bout/, /Scalingo SAS/, /certificat HDS n° 38436/, /art\. 9, 2, a/, /jamais pré-cochée/, /ne peuvent pas être récupérés/, /retirer à tout moment/]) expect(t).toMatch(rx);
    expect(n14['processors.scalingo_v14']).toMatch(/38436/);
    expect(c13['account.vault_v13']).toMatch(/si vous la perdez, vos documents sont perdus/);
  });
  it('third-party booking links: no data sent, not an ADA booking, not a partnership; partner bridge: list published, none yet', () => {
    const t = n14['booking.external_v14'];
    expect(t).toMatch(/aucune donnée vous concernant ne lui est transmise/); expect(t).toMatch(/Ce n'est pas un rendez-vous pris sur AccesDirectAide/); expect(t).toMatch(/aucun partenariat/);
    expect(c13['appointments.external_v13']).toMatch(/aucun partenariat/);
    expect(n14['recipients.partners_v14']).toMatch(/aucun à ce jour/);
    expect(n14['recipients.partners_v14']).toMatch(/sans votre identité, ni dossier, ni document/);
  });
  it('§ 14 institution users: data, proposed basis, durations proposed « à approuver », rights', () => {
    const doc = find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, 'notice-confidentialite');
    expect(doc.sections.at(-1).id).toBe('institutions');
    expect(n14['institutions.p2_v14']).toMatch(/mot de passe sous forme hachée/);
    expect(n14['institutions.p3_v14']).toMatch(/Base proposée : intérêt légitime/);
    expect(n14['institutions.p4_v14']).toMatch(/proposées, à approuver/);
    expect(n14['institutions.p1_v14']).toMatch(/Aucune convention n'est signée à ce jour/);
  });
  it('same draft versions; nothing claims an approval or a review; no entitlement wording', () => {
    expect([L.LEGAL_DRAFTS_R3_NOTICE, L.LEGAL_DRAFTS_R3_CGU]).toEqual(['v14-2026-11-24', 'v13-2026-11-24']);
    const added = { ...n14, ...c13, ...p11 };
    for (const [k, t] of Object.entries(added)) if (/(p28|p29|messaging|vault|scalingo|partners|external|institutions|delegate)/.test(k)) {
      expect(claimsEntitlement(t), k).toBe(false);
      expect(t, k).not.toMatch(/avocat|juriste|expert|approuvé par|validé par/i);
    }
  });
});

describe('founder 24/11: cgu-citoyen v13 / notice v14 stay true while the release-3 functions are closed (they can be put in force with the R3 code)', () => {
  it('every new citizen-facing item is conditioned on its function being open', () => {
    const OPEN = /\(lorsque cette fonction est ouverte\)|\(lorsqu'il est ouvert\)|lorsqu'il est ouvert/;
    for (const k of ['account.household_v13', 'account.trusted_v13', 'account.legal_protection_v13', 'account.vault_v13', 'appointments.messaging_v13', 'appointments.external_v13']) expect(c13[k], k).toMatch(OPEN);
    for (const k of ['purposes.p24_v14', 'purposes.p25_v14', 'purposes.p26_v14', 'purposes.p27_v14', 'purposes.p28_v14', 'purposes.p29_v14', 'institutions.p1_v14', 'processors.scalingo_v14']) expect(n14[k], k).toMatch(OPEN);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const k of ['cguCitoyen.account.household_v13', 'privacyNotice.purposes.p29_v14']) expect(loc[k], `${lang} ${k}`).toMatch(/\(.+\)\s?:/);
    }
  });
});

describe('cgu-professionnel v11-2026-11-24 — a NEW draft (professional obligations change)', () => {
  it('= v10 + exactly three items: messaging rules, delegate member, own booking page; a draft, the newest of that document', () => {
    expect(L.LEGAL_DRAFTS_PRO_V11).toBe('v11-2026-11-24');
    expect(Object.keys(p11).filter((k) => p10[k] !== p11[k]).sort()).toEqual(['appointments.external_v11', 'use.delegate_v11', 'use.messaging_v11']);
    expect(Object.keys(p10).filter((k) => !(k in p11))).toEqual([]);
    expect(L.latestDraftVersionOf('cgu-professionnel')).toBe('v11-2026-11-24');
    expect(L.knownApprovalToken('cgu-professionnel@v11-2026-11-24')).toBe(true);
    expect(L.approvedVersionOf('cgu-professionnel', 'cgu-professionnel@v10-2026-11-23')).toBe('v10-2026-11-23');   // v10 stays the approved one until named
    expect(p11['use.messaging_v11']).toMatch(/pas de donnée de santé, de diagnostic ni d'évaluation sociale/);
    expect(p11['use.delegate_v11']).toMatch(/enregistrées sous votre nom/);
    expect(p11['appointments.external_v11']).toMatch(/ne contenir aucune donnée personnelle/);
    expect(p11['appointments.external_v11']).toMatch(/refuser ou en retirer l'affichage à tout moment/);
  });
});

describe('retention proposals « à approuver » — never executable', () => {
  const ids = ['contentReportsClosedDeleted', 'partnershipRequestsClosedDeleted', 'suspendedInstitutionAccountsReport', 'endedPartnerAgreementsReport'];
  it('four durations marked pendingApproval; two delete steps refused, two report-only steps', () => {
    const D = RETENTION_POLICY.durations;
    for (const k of ['CONTENT_REPORT_CLOSED_DAYS', 'PARTNERSHIP_REQUEST_CLOSED_DAYS', 'INSTITUTION_ACCOUNT_SUSPENDED_DAYS', 'PARTNER_AGREEMENT_ENDED_DAYS']) expect(D[k].pendingApproval, k).toBe(R3_PROPOSAL);
    expect([D.CONTENT_REPORT_CLOSED_DAYS.days, D.PARTNERSHIP_REQUEST_CLOSED_DAYS.days, D.INSTITUTION_ACCOUNT_SUSPENDED_DAYS.days, D.PARTNER_AGREEMENT_ENDED_DAYS.days]).toEqual([365, 365, 365, 1825]);
    const steps = ids.map((id) => PURGE_STEPS.find((s) => s.id === id));
    expect(steps.map((s) => s.kind)).toEqual(['delete', 'delete', 'report', 'report']);
    // even with a complete approval record, a duration still « à approuver » never executes
    const policy = { ...RETENTION_POLICY, approvedSteps: Object.fromEntries(ids.map((id) => [id, { approvedOn: '2026-11-24', dryRunReviewedOn: '2026-11-24', backupVerified: 'verified' }])) };
    for (const s of steps) expect(stepApprovalProblem(/** @type {any} */ (policy), s), s.id).toBe('DURATION_PENDING_APPROVAL');
  });
});

describe('release preflight legal.r3_followup', () => {
  const BASE = { VERCEL_ENV: 'production', ADA_CAPABILITY_ENFORCEMENT: '1' };
  const OLD = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
  const NEW = 'cgu-citoyen@v13-2026-11-24,notice-confidentialite@v14-2026-11-24,cgu-professionnel@v11-2026-11-24,conditions-structures@v9-2026-11-23';
  const check = (/** @type {any} */ env) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((/** @type {any} */ x) => x.id === 'legal.r3_followup');
  it('nothing open: no line; the own booking pages under the old texts: FAIL naming the missing versions; with the release-3 texts: PASS', () => {
    expect(check({ ...BASE, VITE_LEGAL_DOCS_APPROVED_VERSION: OLD })).toBeUndefined();
    const fail = check({ ...BASE, ADA_EXTERNAL_BOOKING: 'platforms', VITE_LEGAL_DOCS_APPROVED_VERSION: OLD });
    expect(fail.status).toBe('FAIL');
    expect(fail.detail).toMatch(/notice-confidentialite@v14-2026-11-24/); expect(fail.detail).toMatch(/cgu-professionnel@v11-2026-11-24/);
    expect(check({ ...BASE, ADA_EXTERNAL_BOOKING: 'platforms', VITE_LEGAL_DOCS_APPROVED_VERSION: NEW }).status).toBe('PASS');
  });
  it('messaging opened (NOT_ESSMS) needs the three texts', () => {
    const env = { ...BASE, ADA_CAPABILITIES_OPEN: 'messaging.conversations' };
    expect(check({ ...env, VITE_LEGAL_DOCS_APPROVED_VERSION: OLD }).status).toBe('FAIL');
    expect(check({ ...env, VITE_LEGAL_DOCS_APPROVED_VERSION: NEW }).status).toBe('PASS');
  });
});

describe('register REGISTRE_RGPD.json (generated) — release-3 lines', () => {
  const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
  const t = (/** @type {string} */ id) => reg.traitements.find((/** @type {any} */ x) => x.id === id);
  it('T04 messaging, T05 Mon Coffre HDS, T10 / T15 proposals, T34 partner bridge, Scalingo planned', () => {
    expect(JSON.stringify(t('T04'))).toMatch(/730 jours après le dernier message/);
    expect(JSON.stringify(t('T04'))).toMatch(/jamais le texte/);
    expect(t('T05').evolution_r3).toMatch(/certificat HDS n° 38436/);
    expect(JSON.stringify(t('T10'))).toMatch(/CONTENT_REPORT_CLOSED_DAYS, à approuver/);
    expect(JSON.stringify(t('T15'))).toMatch(/INSTITUTION_ACCOUNT_SUSPENDED_DAYS/);
    expect(JSON.stringify(t('T15'))).toMatch(/PARTNER_AGREEMENT_ENDED_DAYS/);
    expect(t('T34').statut).toMatch(/aucun partenaire connecté/);
    expect(JSON.stringify(t('T33'))).not.toMatch(/en attente, hors journal/);
    const scalingo = reg.sous_traitants.find((/** @type {any} */ s) => /Scalingo/.test(s.nom));
    expect(scalingo.statut).toMatch(/^prévu/); expect(scalingo.dpa).toBe('inconnu / non signé');
  });
});
