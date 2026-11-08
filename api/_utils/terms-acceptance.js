/**
 * Release B / D2 V2 (08/11/2026) — acceptance of the citizen terms of use (« CGU citoyen ») at sign-up.
 *
 * This is the acceptance of a CONTRACT (the account is provided under those terms; GDPR art. 6(1)(b) rests on the contract and on what is objectively
 * necessary to perform it), NOT a GDPR consent: it is not « freely withdrawable » like a consent (art. 7(3)) — ending the contract is closing the account.
 * The sign-up screen shows, right above the « create my account » button, an explicit sentence with links to the terms and to the privacy notice; pressing
 * the button sends `termsAccepted: true`. The server requires the boolean true and keeps a proof in the existing append-only ledger (`ConsentLog`, as the
 * adult declaration already does for technical reasons): purpose TERMS_ACCEPTANCE_CGU_CITOYEN, the accepted document and version, the channel, proof level
 * CONTRACT_ACCEPTANCE (never read as a consent). No column is added: works unchanged at migration 0042.
 * Consents for OPTIONAL processing (message, reminder, push, marketing…) stay separate and are never bundled with this acceptance.
 */
import { db as defaultDb } from '../../src/db/index.js';
import { ConsentLog } from '../../src/db/schema.js';
import { LEGAL_DRAFTS_VERSION } from '../../src/config/legal-drafts.js';
export { CITIZEN_ACCOUNT_DOCUMENTS, TERMS_NOT_IN_FORCE_REFUSAL, citizenTermsInForce } from './terms-in-force.js';

export const TERMS_ACCEPTANCE_PURPOSE = 'TERMS_ACCEPTANCE_CGU_CITOYEN';
export const TERMS_DOCUMENT_ID = 'cgu-citoyen';
export const CONTRACT_ACCEPTANCE = 'CONTRACT_ACCEPTANCE';
/** the accepted document and version, as recorded (« cgu-citoyen@<version> ») */
export const termsReference = () => `${TERMS_DOCUMENT_ID}@${LEGAL_DRAFTS_VERSION}`;

export const TERMS_REQUIRED_REFUSAL = Object.freeze({
  error: 'TERMS_ACCEPTANCE_REQUIRED',
  code: 'TERMS_ACCEPTANCE_REQUIRED',
  message: 'Pour créer un compte, acceptez les conditions d’utilisation (lien sous le formulaire).',
});

/** Only the boolean `true` counts (a missing field, "true" as text, 1 or anything else is not an acceptance). @param {unknown} value */
export const termsAcceptanceGiven = (value) => value === true;

/** @param {string} userId @param {{ channel?: string }} [opts] @param {any} [dbh] */
export async function recordTermsAcceptance(userId, opts = {}, dbh = defaultDb) {
  const ref = termsReference();
  await dbh.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER',
    subject_id: String(userId),
    purpose: TERMS_ACCEPTANCE_PURPOSE,
    decision: true,
    policy_version: ref,
    policy_hash: `${ref}:${TERMS_ACCEPTANCE_PURPOSE}`,
    collection_channel: String(opts.channel || 'signup'),
    guardian_involved: false,
    proof_level: CONTRACT_ACCEPTANCE,
  });
}
