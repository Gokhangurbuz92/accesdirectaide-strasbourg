/**
 * TG — notice-confidentialite v16-2026-11-25 (APPROVED by the controller on 25/11/2026, CONTROL/master/completion/TG_OWNER_APPROVAL_2026-11-25.md): the
 * approved v15-2026-11-24 plus EXACTLY four passages on the optional Telegram reminders (P10d, retention, recipient, transfer outside the EU), each
 * « lorsque cette fonction est ouverte » so the text is true while citizen.telegram is closed. v15 unchanged byte for byte; the opening is NOT approved.
 * Register T38 and AIPD line TG-1 carry the approval; preflight legal.tg_texts refuses citizen.telegram under an older notice.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));

const L = await import('../../src/config/legal-drafts.js');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');
const { telegramLegalChecks, evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');

const keys = (/** @type {any} */ d) => Object.fromEntries(L.draftTextKeys(d));
const n15 = keys(L.LEGAL_DRAFT_DOCUMENTS_R4_NOTICE[0]);
const n16 = keys(L.LEGAL_DRAFT_DOCUMENTS_TG_NOTICE[0]);
const ADDED = ['purposes.p10d_v16', 'retention.telegram_v16', 'recipients.telegram_v16', 'transfers.telegram_v16'];
/** the value Production carries since R5 (owner approval 25/11/2026) and the next one (TG approval 25/11/2026) */
const PRODUCTION_R5 = 'cgu-citoyen@v14-2026-11-24,notice-confidentialite@v15-2026-11-24,cgu-professionnel@v12-2026-11-25,conditions-structures@v9-2026-11-23';
const NEXT_TG = 'cgu-citoyen@v14-2026-11-24,notice-confidentialite@v16-2026-11-25,cgu-professionnel@v12-2026-11-25,conditions-structures@v9-2026-11-23';
const OPEN = /lorsque cette fonction est ouverte/;
const MARKS = /à valider|à approuver|Base proposée|en attente de l.approbation|PROJET/;

describe('notice-confidentialite v16-2026-11-25 — v15 + the Telegram reminders', () => {
  it('= v15 + exactly four passages, in place (after the browser-notification passages, after the shared dossiers), nothing else changed', () => {
    expect(L.LEGAL_DRAFTS_TG_NOTICE).toBe('v16-2026-11-25');
    expect(Object.keys(n16).filter((k) => n15[k] !== n16[k]).sort()).toEqual([...ADDED].sort());
    expect(Object.keys(n15).filter((k) => !(k in n16))).toEqual([]);
    const order = Object.keys(n16);
    const after = (/** @type {string} */ k) => order[order.indexOf(k) - 1];
    expect(ADDED.map(after)).toEqual(['purposes.p10c_g14c', 'retention.push_g14c', 'recipients.dossiers_v15', 'transfers.push_g14c']);
    expect(n16['purposes.p10d_v16']).toBe(L.LEGAL_DRAFTS_TG_P10D);
    expect(n16['retention.telegram_v16']).toBe(L.LEGAL_DRAFTS_TG_RETENTION);
    expect(n16['recipients.telegram_v16']).toBe(L.LEGAL_DRAFTS_TG_RECIPIENT);
    expect(n16['transfers.telegram_v16']).toBe(L.LEGAL_DRAFTS_TG_TRANSFER);
  });

  it('v15 is byte-identical to the approved text (hash taken before this change, commit 3a58ee7a)', () => {
    expect(createHash('sha256').update(JSON.stringify(L.LEGAL_DRAFT_DOCUMENTS_R4_NOTICE)).digest('hex')).toBe('6ff1776310e933b21b64297dd894c1b0722da1338e4ef437ae7dccb012d3c044');
    expect(createHash('sha256').update(JSON.stringify(L.LEGAL_DRAFT_DOCUMENTS_R4_CGU)).digest('hex')).toBe('70752fc34864e5e5829f75da6d1b1677f0537c764d9f7e63ea3e10daa7bdba65');
  });

  it('every Telegram text is conditioned on the function being open, carries no « to be validated » mark, no entitlement, no review claim', () => {
    for (const t of [L.LEGAL_DRAFTS_TG_P10D, L.LEGAL_DRAFTS_TG_RECIPIENT, L.LEGAL_DRAFTS_TG_TRANSFER, L.LEGAL_DRAFTS_TG_RETENTION, L.LEGAL_DRAFTS_TG_COOKIES]) {
      expect(t).toMatch(OPEN); expect(t).not.toMatch(MARKS); expect(claimsEntitlement(t)).toBe(false); expect(t).not.toMatch(/avocat|juriste|expert/i);
    }
    expect(n16['purposes.p10d_v16']).toMatch(/^P10d — Rappels sur Telegram \(facultatif, lorsque cette fonction est ouverte\), si vous les activez/);
    expect(n16['purposes.p10d_v16']).toMatch(/Base : votre consentement \(art\. 6, 1, a\), retirable à tout moment depuis « Mon compte » ou en envoyant \/stop au robot\.$/);
    expect(n16['recipients.telegram_v16']).toMatch(/Telegram Messenger Inc\..*Telegram FZ-LLC à Dubaï/);
    expect(n16['recipients.telegram_v16']).not.toMatch(/sous-traitant/);   // no art. 28 agreement: a recipient, never called a processor
    expect(n16['transfers.telegram_v16']).toMatch(/hors de l'Union européenne/);
    expect(n16['retention.telegram_v16']).toMatch(/10 minutes/);
  });

  it('statuses: approved on 25/11/2026 by the controller; the opening is not approved', () => {
    for (const st of [L.LEGAL_DRAFTS_TG_STATUS, L.LEGAL_DRAFTS_TG_NOTICE_STATUS]) {
      expect(st).toMatch(/^APPROVED — approuvée?s? le 25\/11\/2026 par le responsable \(TG_OWNER_APPROVAL_2026-11-25\)/);
      expect(st).toMatch(/non approuvée/); expect(st).not.toMatch(/DRAFT|à valider|avocat|expert/);
    }
  });

  it('the newest notice draft; v15 stays in force under the Production value, v16 once named; other documents unchanged', () => {
    expect(L.latestDraftVersionOf('notice-confidentialite')).toBe('v16-2026-11-25');
    expect([...L.LEGAL_DRAFT_VERSIONS].at(-1)).toBe('v16-2026-11-25');
    expect(L.knownApprovalToken('notice-confidentialite@v16-2026-11-25')).toBe(true);
    expect(L.knownApprovalToken('cgu-citoyen@v16-2026-11-25')).toBe(false);
    expect(L.approvedVersionOf('notice-confidentialite', PRODUCTION_R5)).toBe('v15-2026-11-24');
    expect(L.approvedVersionOf('notice-confidentialite', NEXT_TG)).toBe('v16-2026-11-25');
    for (const [id, v] of [['cgu-citoyen', 'v14-2026-11-24'], ['cgu-professionnel', 'v12-2026-11-25'], ['conditions-structures', 'v9-2026-11-23']]) {
      expect(L.approvedVersionOf(id, PRODUCTION_R5), id).toBe(v); expect(L.approvedVersionOf(id, NEXT_TG), id).toBe(v);
    }
    // the earlier preflight requirements stay satisfied by v16
    for (const v of [L.LEGAL_DRAFTS_R4_NOTICE, L.LEGAL_DRAFTS_R3_NOTICE, L.LEGAL_DRAFTS_V12]) expect(L.approvedAtLeast('notice-confidentialite', v, NEXT_TG), v).toBe(true);
    const n = L.LEGAL_DRAFT_DOCUMENTS_TG_NOTICE[0];
    expect(L.draftVisibility(n, { approved: PRODUCTION_R5, production: true })).toBe('HIDDEN');
    expect(L.draftVisibility(n, { approved: NEXT_TG, production: true })).toBe('IN_FORCE');
    expect(L.draftFor('notice-confidentialite', { approved: PRODUCTION_R5, production: true })?.version).toBe('v15-2026-11-24');
  });

  it('six languages: the four passages translated with the same figures, conditional, without a « to be validated » mark', () => {
    const digits = (/** @type {string} */ t) => (t.match(/\d+/g) || []).join(',');
    const COND = { en: /when this function is open/, de: /wenn diese Funktion geöffnet ist/, tr: /bu işlev açık olduğunda/, ar: /عندما تكون هذه الوظيفة مفتوحة/, uk: /коли цю функцію відкрито/ };
    for (const lang of /** @type {Array<'en' | 'de' | 'tr' | 'ar' | 'uk'>} */ (['en', 'de', 'tr', 'ar', 'uk'])) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const k of ADDED) {
        const t = loc[`privacyNotice.${k}`];
        expect(typeof t, `${lang} ${k}`).toBe('string');
        expect(digits(t), `${lang} ${k}`).toBe(digits(n16[k]));
        expect(t, `${lang} ${k}`).toMatch(COND[lang]);
        expect(t, `${lang} ${k}`).not.toMatch(/to be validated|to be approved|zu validieren|onaylanacak|بانتظار الموافقة|підлягає затвердженню/i);
      }
      expect(Object.keys(loc).slice(-4), lang).toEqual(ADDED.map((k) => `privacyNotice.${k}`));   // appended at the end
    }
  });
});

describe('release preflight — legal.tg_texts', () => {
  const get = (/** @type {Record<string, string>} */ e) => (/** @type {string} */ k) => String(e[k] ?? '').trim();
  const FAKE = { TELEGRAM_BOT_TOKEN: `123456789:${'x'.repeat(35)}`, TELEGRAM_BOT_USERNAME: 'AccesDirectAideBot', TELEGRAM_WEBHOOK_SECRET: 'S'.repeat(48) };
  it('closed: no line (Production value or next value alike)', () => {
    for (const approved of [PRODUCTION_R5, NEXT_TG]) {
      const env = { ADA_CAPABILITY_ENFORCEMENT: '1', VITE_LEGAL_DOCS_APPROVED_VERSION: approved };
      expect(telegramLegalChecks(env, { get: get(env) })).toEqual([]);
    }
  });
  it('citizen.telegram open: FAIL under notice v15, PASS once v16 is named', () => {
    const open = { ADA_CAPABILITY_ENFORCEMENT: '1', ADA_CAPABILITIES_OPEN: 'citizen.telegram', ...FAKE };
    const v15 = { ...open, VITE_LEGAL_DOCS_APPROVED_VERSION: PRODUCTION_R5 };
    expect(telegramLegalChecks(v15, { get: get(v15) })).toEqual([['legal.tg_texts', 'FAIL', expect.stringMatching(/notice-confidentialite@v16-2026-11-25 \(or later\)/)]]);
    expect(evaluateReleasePreflight(v15).find((/** @type {any} */ x) => x.id === 'legal.tg_texts')?.status).toBe('FAIL');
    const v16 = { ...open, VITE_LEGAL_DOCS_APPROVED_VERSION: NEXT_TG };
    expect(telegramLegalChecks(v16, { get: get(v16) })[0][1]).toBe('PASS');
    expect(evaluateReleasePreflight(v16).find((/** @type {any} */ x) => x.id === 'legal.tg_texts')?.status).toBe('PASS');
  });
});

describe('register T38 and AIPD line TG-1 — approved on 25/11/2026, opening still closed', () => {
  it('T38: approved by the controller, no « à valider », the capability closed', () => {
    const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
    const t = reg.traitements.find((/** @type {any} */ x) => x.id === 'T38');
    expect(t.statut).toMatch(/^approuvé par le responsable le 25\/11\/2026 \(TG_OWNER_APPROVAL_2026-11-25/);
    expect(t.statut).toMatch(/capacité citizen\.telegram fermée, ouverture non approuvée/);
    expect(JSON.stringify(t)).not.toMatch(/à valider|PROJET|avocat|expert/);
  });
  it('TG-1 signed by the controller on 25/11/2026', () => {
    const md = readFileSync('docs/rgpd-r4-aipd-lignes.md', 'utf8');
    expect(md).toMatch(/## TG-1 — Rappels facultatifs sur Telegram — SIGNÉE par le responsable le 25\/11\/2026/);
    expect(md).toMatch(/Statut : \*\*signée par le responsable du traitement le 25\/11\/2026\*\* \(approbation TG/);
    expect(md).not.toMatch(/TG-1 [^\n]*« à valider »/);
  });
});
