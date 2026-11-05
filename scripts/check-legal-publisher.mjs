#!/usr/bin/env node
/**
 * R45 (ENG-LR-4 / ENG-LR-5) — build check of the legal publisher configuration and of the draft legal documents. READ-ONLY; prints check ids,
 * PASS/WARN/FAIL and a reason, NEVER a value. Exit code 1 when any FAIL. Run by scripts/vercel-build.mjs before `vite build` (every Vercel
 * environment), by the CI workflow and, for Production, by scripts/release-preflight.mjs.
 *
 * It fails when:
 *  - VITE_LEGAL_PUBLISHER_MODE has a value other than A_I / A_II / empty;
 *  - the build-only domicile or telephone (LEGAL_A_I_PUBLISHER_DOMICILE / _PHONE) is set while the build is not « A_I + owner approval »
 *    (in A_II, or with no mode, they must not exist in the build environment at all);
 *  - a VITE_LEGAL_* variable carries an address, a domicile or a telephone (a VITE_* value can end up in the public bundle), except the host's;
 *  - A_I is requested without VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED=yes-owner-approved, or without its domicile and telephone;
 *  - A_I or A_II is requested and the host telephone is not verified (VITE_LEGAL_HOST_PHONE unset: Vercel publishes none);
 *  - a Production build would show an unapproved draft (A_I / A_II legal notice variant, or VITE_LEGAL_DRAFT_PREVIEW=1);
 *  - a postal-address-like or French-telephone-like pattern appears in the legal configuration defaults or translations (the host's published
 *    business addresses excepted).
 *
 *   node scripts/check-legal-publisher.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A_I_APPROVAL_TOKEN, A_I_IDENTIFICATION_VARS, parsePublisherMode } from '../src/config/legal-publisher.js';
import { LEGAL_NOTICE_VARIANT_DOCUMENT, ALL_LEGAL_DRAFT_IDS, LEGAL_DRAFTS_VERSION, draftVisibility } from '../src/config/legal-drafts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** files whose literal text are defaults or translations of the legal pages */
export const LEGAL_DEFAULT_FILES = [
  'src/config/legal-entity.ts', 'src/config/legal-documents.js', 'src/config/legal-publisher.js', 'src/config/legal-drafts.js', 'src/lib/brand-config.js',
];
const LOCALE_FILES = ['legal.json', 'legaldraft.json'];

/** published business addresses of providers, the only addresses the legal texts may contain */
export const ALLOWED_PUBLIC_ADDRESSES = [
  /440 N(?:orth)?\.? Barranca Ave(?:nue)? #4133[^"\n]{0,40}?91723/gi,   // Vercel Inc. (vercel.com/legal/privacy-policy, read 05/11/2026)
  /160 Spear Street[^"\n]{0,60}?94105/gi,                            // Databricks, Inc. (Neon), as already published on /mentions-legales
];

export const ADDRESS_PATTERNS = [
  { id: 'street_fr', rx: /\b\d{1,4}\s*(?:bis|ter)?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|allée|allee|impasse|place|quai|route|cours|square|passage|faubourg|lieu-dit)\s/i },
  { id: 'postcode_city', rx: /\b\d{5}\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}/ },
  { id: 'street_en', rx: /\b\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+\s+(?:Street|St\.|Avenue|Ave\.?|Road|Rd\.|Boulevard|Blvd)\b/ },
  { id: 'phone_fr', rx: /(?:\+33\s?\(?0?\)?\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/ },
];

/** VITE_LEGAL_* names allowed to carry a phone / address word (the approval switch and the host's business telephone) */
const VITE_ALLOWED = new Set(['VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED', 'VITE_LEGAL_HOST_PHONE']);
const PERSONAL_NAME = /(ADDRESS|ADRESSE|DOMICILE|PHONE|TELEPHONE|TEL\b|_TEL_|POSTAL|STREET|RUE)/;

/**
 * Scans a text for address / telephone patterns after removing the allowed provider addresses.
 * @param {string} text
 * @returns {string[]} the ids of the patterns found (never the matched text)
 */
export function findAddressPatterns(text) {
  let t = String(text || '');
  for (const rx of ALLOWED_PUBLIC_ADDRESSES) t = t.replace(rx, ' ');
  return ADDRESS_PATTERNS.filter((p) => p.rx.test(t)).map((p) => p.id);
}

/** @param {string} root */
export function readLegalDefaults(root = ROOT) {
  /** @type {{ file: string, text: string }[]} */
  const out = [];
  for (const f of LEGAL_DEFAULT_FILES) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) out.push({ file: f, text: fs.readFileSync(p, 'utf8') });
  }
  const locales = path.join(root, 'src', 'i18n', 'locales');
  if (fs.existsSync(locales)) {
    for (const lang of fs.readdirSync(locales)) {
      for (const f of LOCALE_FILES) {
        const p = path.join(locales, lang, f);
        if (fs.existsSync(p)) out.push({ file: `src/i18n/locales/${lang}/${f}`, text: fs.readFileSync(p, 'utf8') });
      }
    }
  }
  // the template of the environment: the legal identification variables must stay empty there
  const example = path.join(root, '.env.example');
  if (fs.existsSync(example)) {
    const lines = fs.readFileSync(example, 'utf8').split('\n').filter((l) => /^\s*(VITE_LEGAL_|LEGAL_A_I_)[A-Z0-9_]*=/.test(l));
    out.push({ file: '.env.example', text: lines.map((l) => l.split('=').slice(1).join('=')).join('\n') });
  }
  return out;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ defaults?: { file: string, text: string }[] }} [opts] defaults: the scanned files (tests pass their own)
 * @returns {{ id: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string }[]}
 */
export function checkLegalPublisher(env, opts = {}) {
  /** @type {{ id: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string }[]} */
  const out = [];
  const add = (/** @type {string} */ id, /** @type {'PASS' | 'WARN' | 'FAIL'} */ status, /** @type {string} */ detail) => out.push({ id, status, detail });
  const get = (/** @type {string} */ k) => String(env[k] ?? '').trim();

  const { mode, known } = parsePublisherMode(env.VITE_LEGAL_PUBLISHER_MODE);
  const approved = get('VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED') === A_I_APPROVAL_TOKEN;
  const production = get('VERCEL_ENV') === 'production';
  const identSet = A_I_IDENTIFICATION_VARS.filter((k) => get(k));

  add('legal.publisher_mode_known', known ? 'PASS' : 'FAIL', known ? `publisher mode: ${mode}` : 'VITE_LEGAL_PUBLISHER_MODE must be A_I, A_II or empty (an unknown value is treated as empty at run time)');

  const vitePersonal = Object.keys(env).filter((k) => k.startsWith('VITE_LEGAL_') && !VITE_ALLOWED.has(k) && PERSONAL_NAME.test(k.slice('VITE_LEGAL_'.length)) && get(k));
  add('legal.no_public_address_variable', vitePersonal.length ? 'FAIL' : 'PASS', vitePersonal.length
    ? `a VITE_* variable can reach the public bundle; remove: ${vitePersonal.join(', ')} (the domicile and telephone are LEGAL_A_I_* build-only variables)`
    : 'no VITE_LEGAL_* variable carries an address, a domicile or a telephone');

  // the VALUES of the public legal variables (identity, director, contacts…) must not carry a street address or a telephone either
  const viteWithAddress = Object.keys(env).filter((k) => k.startsWith('VITE_LEGAL_') && k !== 'VITE_LEGAL_HOST_PHONE' && get(k) && findAddressPatterns(get(k)).length);
  add('legal.public_values_no_address', viteWithAddress.length ? 'FAIL' : 'PASS', viteWithAddress.length
    ? `address or telephone pattern in the value of: ${viteWithAddress.join(', ')} (value not shown)` : 'no address or telephone pattern in the VITE_LEGAL_* values');

  const identAllowed = mode === 'A_I' && approved;
  add('legal.identification_only_when_approved', identSet.length && !identAllowed ? 'FAIL' : 'PASS', identSet.length && !identAllowed
    ? `${identSet.join(', ')} set while the build is not « A_I + owner approval »${mode === 'A_II' ? ' (A_II: the identification is kept by the host only — delete them from this environment)' : ''}`
    : identSet.length ? 'domicile and telephone present for an approved A_I build' : 'no domicile or telephone in the build environment');

  if (get('VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED') && !approved) add('legal.a_i_approval_value', 'FAIL', `VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED must be exactly « ${A_I_APPROVAL_TOKEN} » or empty`);
  if (approved && mode !== 'A_I') add('legal.a_i_approval_unused', 'WARN', 'the A_I approval switch is set but the mode is not A_I (nothing is published); remove it to avoid a later surprise');

  if (mode === 'A_I') {
    add('legal.a_i_owner_approval', approved ? 'PASS' : 'FAIL', approved
      ? 'A_I: separate owner approval to publish the domicile is set'
      : `A_I needs the separate owner approval VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED=${A_I_APPROVAL_TOKEN}; without it the domicile is never published`);
    if (approved) add('legal.a_i_identification_complete', identSet.length === A_I_IDENTIFICATION_VARS.length ? 'PASS' : 'FAIL', `A_I (LCEN art. 1-1 I 1°) needs ${A_I_IDENTIFICATION_VARS.join(' and ')} (build-only)`);
  }
  if (mode !== 'UNSET') {
    add('legal.host_phone_verified', get('VITE_LEGAL_HOST_PHONE') ? 'PASS' : 'FAIL', get('VITE_LEGAL_HOST_PHONE')
      ? 'host telephone set'
      : "host telephone not verified (Vercel publishes none, pages read 05/11/2026): set VITE_LEGAL_HOST_PHONE from Vercel's answer");
    if (mode === 'A_II') {
      const ok = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(get('VITE_LEGAL_PUBLICATION_CONTACT_EMAIL'));
      add('legal.publication_contact', ok ? 'PASS' : 'WARN', ok ? 'publication contact set' : 'VITE_LEGAL_PUBLICATION_CONTACT_EMAIL not set (fact F5): the page shows « en cours de désignation »; readiness false');
    }
  }

  const ctx = { approved: get('VITE_LEGAL_DOCS_APPROVED_VERSION'), preview: get('VITE_LEGAL_DRAFT_PREVIEW'), production };
  if (production && mode !== 'UNSET') {
    const ok = draftVisibility(LEGAL_NOTICE_VARIANT_DOCUMENT, ctx) === 'IN_FORCE';
    add('legal.variant_text_approved', ok ? 'PASS' : 'FAIL', ok ? 'the A-I / A-II legal notice text is approved'
      : `Production: the A-I / A-II legal notice text is a draft; VITE_LEGAL_DOCS_APPROVED_VERSION must name ${LEGAL_NOTICE_VARIANT_DOCUMENT.id}@${LEGAL_NOTICE_VARIANT_DOCUMENT.version}`);
  }
  add('legal.no_draft_preview_in_production', production && get('VITE_LEGAL_DRAFT_PREVIEW') ? 'FAIL' : 'PASS', production && get('VITE_LEGAL_DRAFT_PREVIEW')
    ? 'VITE_LEGAL_DRAFT_PREVIEW is LAB only: delete it from the Production environment' : 'no draft preview in a Production build');
  const tokens = ctx.approved.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = tokens.filter((t) => t !== LEGAL_DRAFTS_VERSION && !ALL_LEGAL_DRAFT_IDS.some((id) => t === `${id}@${LEGAL_DRAFTS_VERSION}`));
  if (unknown.length) add('legal.approved_versions_known', 'WARN', `${unknown.length} approved version token(s) name no current draft (a text changed since the approval?)`);

  const defaults = opts.defaults || readLegalDefaults();
  const hits = defaults.flatMap(({ file, text }) => findAddressPatterns(text).map((id) => `${file}: ${id}`));
  add('legal.defaults_no_postal_address', hits.length ? 'FAIL' : 'PASS', hits.length
    ? `address or telephone pattern in the legal defaults: ${hits.join('; ')}` : `${defaults.length} legal default files scanned: no postal address or telephone (provider business addresses excepted)`);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const results = checkLegalPublisher(process.env);
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) console.log(`[legal-publisher] ${r.status.padEnd(4)} ${r.id} — ${r.detail}`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
