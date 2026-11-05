/**
 * R45 (ENG-LR-4) — how the legal notice identifies the publisher (LCEN, loi n° 2004-575 du 21 juin 2004, art. 1-1).
 *
 * Owner facts (05/11/2026): DEC-R44LR-01 — the service is operated by the owner as a natural person, no association exists. NO LCEN path is chosen yet
 * (CONTROL/r44/R44_LCEN_ANALYSE_ET_VOIES_FR.md § 9). The switch therefore defaults to the CURRENT rendering:
 *
 *   VITE_LEGAL_PUBLISHER_MODE unset  → the legal notice is rendered exactly as before R45 (Production today)
 *   VITE_LEGAL_PUBLISHER_MODE=A_II   → art. 1-1 II: non-professional natural person; identification kept by the host only; host name, address,
 *                                       telephone; publication contact (VITE_LEGAL_PUBLICATION_CONTACT_EMAIL); right of reply (III)
 *   VITE_LEGAL_PUBLISHER_MODE=A_I    → art. 1-1 I 1°: name, domicile, telephone — rendered ONLY with the separate owner approval switch
 *                                       VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED=yes-owner-approved; otherwise the build check fails
 *                                       (scripts/check-legal-publisher.mjs) and the page falls back to the current rendering
 *   any other value                   → treated as unset (fail-closed) and the build check fails
 *
 * The domicile and the telephone are NEVER VITE_* variables (a VITE_* value can end up in the public bundle). They are the build-only variables
 * LEGAL_A_I_PUBLISHER_DOMICILE / LEGAL_A_I_PUBLISHER_PHONE, read by vite.config.js and injected into the bundle (define __ADA_LEGAL_A_I_IDENTIFICATION__)
 * only when mode A_I AND the approval switch are both set. No default value here may contain a postal address or a personal telephone number
 * (checked by the build guard), except the host's own published business address below.
 */

export const PUBLISHER_MODES = Object.freeze({ UNSET: 'UNSET', A_I: 'A_I', A_II: 'A_II' });
export const A_I_APPROVAL_TOKEN = 'yes-owner-approved';

/** names of the build-only identification variables (never VITE_*, never in the repository, never logged) */
export const A_I_IDENTIFICATION_VARS = Object.freeze(['LEGAL_A_I_PUBLISHER_DOMICILE', 'LEGAL_A_I_PUBLISHER_PHONE']);

/**
 * The host (LCEN art. 1-1 I 4° and II). Read on 05/11/2026:
 *  - https://vercel.com/legal/privacy-policy (« Last Updated June 1, 2026 »): « Vercel Inc. », « 440 N Barranca Avenue #4133 », « Covina, CA 91723 »,
 *    « United States »; no telephone number on the page;
 *  - https://vercel.com/legal/terms (« Last Updated October 19, 2026 »): same address (arbitration notices); no telephone number of Vercel;
 *  - https://vercel.com/legal (index): no imprint and no telephone number.
 * The host telephone is therefore NOT verified: it stays a visible placeholder until VITE_LEGAL_HOST_PHONE is set from an answer of Vercel
 * (fact F4 / M4 of R44), and the build check fails in modes A_I and A_II while it is missing.
 */
export const HOST = Object.freeze({
  name: 'Vercel Inc.',
  address: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis',
  source: 'https://vercel.com/legal/privacy-policy',
  sourceRead: '2026-11-05',
  phonePlaceholder: "[À COMPLÉTER : téléphone de l'hébergeur — Vercel n'en publie aucun (pages lues le 05/11/2026) ; à obtenir de Vercel]",
});

const PUBLICATION_CONTACT_PENDING = 'en cours de désignation';

/** the build-time injection (vite.config.js define); undefined outside a Vite build (tests, scripts) */
function injectedIdentification() {
  // eslint-disable-next-line no-undef
  return typeof __ADA_LEGAL_A_I_IDENTIFICATION__ !== 'undefined' ? __ADA_LEGAL_A_I_IDENTIFICATION__ : undefined;
}

/** STATIC references only (a bare or dynamic import.meta.env would inline every VITE_* variable of the build) */
function viteEnv() {
  let env = {};
  try {
    env = {
      VITE_LEGAL_PUBLISHER_MODE: import.meta.env.VITE_LEGAL_PUBLISHER_MODE,
      VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: import.meta.env.VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED,
      VITE_LEGAL_PUBLICATION_CONTACT_EMAIL: import.meta.env.VITE_LEGAL_PUBLICATION_CONTACT_EMAIL,
      VITE_LEGAL_HOST_PHONE: import.meta.env.VITE_LEGAL_HOST_PHONE,
      VITE_LEGAL_PUBLISHER_IDENTITY: import.meta.env.VITE_LEGAL_PUBLISHER_IDENTITY,
    };
  } catch { /* not under Vite */ }
  return env;
}

/** @param {unknown} v */
const clean = (v) => String(v ?? '').trim();

/**
 * Normalises the raw mode. Unknown values are reported (the build check fails) and treated as UNSET at run time.
 * @param {unknown} raw
 * @returns {{ mode: 'UNSET' | 'A_I' | 'A_II', known: boolean }}
 */
export function parsePublisherMode(raw) {
  const v = clean(raw);
  if (v === '') return { mode: 'UNSET', known: true };
  if (v === 'A_I' || v === 'A_II') return { mode: v, known: true };
  return { mode: 'UNSET', known: false };
}

/**
 * Pure resolution from an environment object (tests and the build guard pass their own).
 * @param {Record<string, string | undefined>} env
 * @param {{ injected?: { domicile?: string, phone?: string } | null }} [opts] injected: what the Vite build injected (undefined = read env, for tests)
 */
export function resolvePublisherConfig(env, opts = {}) {
  const { mode: requested, known } = parsePublisherMode(env.VITE_LEGAL_PUBLISHER_MODE);
  const approved = clean(env.VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED) === A_I_APPROVAL_TOKEN;
  const contact = clean(env.VITE_LEGAL_PUBLICATION_CONTACT_EMAIL);
  const contactValid = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(contact);
  const hostPhone = clean(env.VITE_LEGAL_HOST_PHONE);

  // A_I is effective only with the separate approval; without it the page keeps the current rendering (fail-closed)
  const mode = requested === 'A_I' && !approved ? 'UNSET' : requested;

  let identification = null;
  if (mode === 'A_I') {
    const src = opts.injected !== undefined ? opts.injected : { domicile: clean(env.LEGAL_A_I_PUBLISHER_DOMICILE), phone: clean(env.LEGAL_A_I_PUBLISHER_PHONE) };
    if (src && clean(src.domicile) && clean(src.phone)) identification = { domicile: clean(src.domicile), phone: clean(src.phone) };
  }

  const missing = [];
  if (requested !== 'UNSET') {
    if (!hostPhone) missing.push('host_phone');
    if (requested === 'A_II' && !contactValid) missing.push('publication_contact');
    if (requested === 'A_I' && !approved) missing.push('a_i_owner_approval');
    if (requested === 'A_I' && approved && !identification) missing.push('a_i_identification');
  }

  return Object.freeze({
    requestedMode: requested,
    mode,
    modeKnown: known,
    a1Approved: approved,
    identification,
    publisherName: clean(env.VITE_LEGAL_PUBLISHER_IDENTITY),
    publicationContact: contactValid ? contact : null,
    publicationContactLabel: contactValid ? contact : PUBLICATION_CONTACT_PENDING,
    host: Object.freeze({ name: HOST.name, address: HOST.address, phone: hostPhone || HOST.phonePlaceholder, phoneVerified: Boolean(hostPhone) }),
    // readiness of the chosen variant: false until every element is present (F5 contact, host telephone, A-I approval and identification)
    ready: requested !== 'UNSET' && known && missing.length === 0,
    missing: Object.freeze(missing),
  });
}

/** The configuration of THIS build (browser: Vite env + injected identification; Node: process.env). */
export function currentPublisherConfig() {
  const nodeEnv = globalThis.process?.env || {};
  const v = viteEnv();
  /** @type {Record<string, string | undefined>} */
  const env = {};
  for (const k of ['VITE_LEGAL_PUBLISHER_MODE', 'VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED', 'VITE_LEGAL_PUBLICATION_CONTACT_EMAIL', 'VITE_LEGAL_HOST_PHONE', 'VITE_LEGAL_PUBLISHER_IDENTITY']) {
    env[k] = /** @type {any} */ (v)[k] || nodeEnv[k];
  }
  const injected = injectedIdentification();
  if (injected === undefined) {
    // outside a Vite build only (unit tests, Node scripts)
    for (const k of A_I_IDENTIFICATION_VARS) env[k] = nodeEnv[k];
    return resolvePublisherConfig(env);
  }
  return resolvePublisherConfig(env, { injected });
}
