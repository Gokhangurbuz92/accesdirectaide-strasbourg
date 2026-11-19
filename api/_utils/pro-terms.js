/**
 * G3 (19/11/2026, SD Track 2/3 gap A(b)) — acceptance of the professional terms at the invited sign-up (POST /api/pro/auth/register-invite).
 *
 * The same pattern as the citizen sign-up (api/_utils/terms-acceptance.js, api/_utils/terms-in-force.js), reused rather than copied in spirit:
 *   - in Production an account is created only under terms IN FORCE: the version VITE_LEGAL_DOCS_APPROVED_VERSION names (src/config/legal-drafts.js, the
 *     value the screens read). While the owner has approved no version of the professional terms the invited sign-up is refused (fail-closed) with an
 *     honest message — the drafts « cgu-professionnel » and « conditions-structures » stay drafts (DRAFT_PENDING_OWNER_APPROVAL), nothing here approves them;
 *   - outside Production (LAB, Preview) the newest drafts are accepted, marked as drafts on screen (as for the citizen terms);
 *   - the screen states the acceptance right above « Créer mon accès »; the request carries `termsAccepted: true` (only the boolean true counts);
 *   - the proof goes to the existing append-only ledger `ConsentLog` (no new table, no new column, no migration): subject PRO_USER, purpose
 *     TERMS_ACCEPTANCE_CGU_PROFESSIONNEL (and TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES for a structure administrator, who acts for the structure), the
 *     accepted « document@version », proof level CONTRACT_ACCEPTANCE (a contract acceptance, never read as a GDPR consent).
 */
import { ConsentLog } from '../../src/db/schema.js';
import { approvedVersionOf, draftFor, draftVisibility, latestDraftVersionOf } from '../../src/config/legal-drafts.js';
import { CONTRACT_ACCEPTANCE, termsAcceptanceGiven } from './terms-acceptance.js';

export { termsAcceptanceGiven };

/** the documents a professional account is created under (the structure conditions included: a structure administrator accepts them for the structure) */
export const PRO_ACCOUNT_DOCUMENTS = Object.freeze(['cgu-professionnel', 'conditions-structures', 'notice-confidentialite']);
export const PRO_TERMS_PURPOSES = Object.freeze({ 'cgu-professionnel': 'TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', 'conditions-structures': 'TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES' });

const isProduction = (/** @type {Record<string, string | undefined>} */ env) => String(env.VERCEL_ENV || '').toLowerCase() === 'production';

/** are the professional terms in force here (Production: every document approved; elsewhere: drafts accepted) @param {Record<string, string | undefined>} [env] */
export function proTermsInForce(env = process.env) {
  if (!isProduction(env)) return true;
  const ctx = { approved: env.VITE_LEGAL_DOCS_APPROVED_VERSION, production: true };
  return PRO_ACCOUNT_DOCUMENTS.every((id) => {
    const doc = draftFor(id, ctx);
    return doc !== null && draftVisibility(doc, ctx) === 'IN_FORCE';
  });
}

/** the documents a role accepts at sign-up @param {string} role */
export const proTermsDocumentsFor = (role) => (role === 'STRUCTURE_ADMIN' ? ['cgu-professionnel', 'conditions-structures'] : ['cgu-professionnel']);

/**
 * « id@version » as recorded: in Production the approved version, elsewhere the newest draft OF THAT DOCUMENT (G4, 19/11/2026: since v8 the professional
 * documents are at v8 while the citizen terms and the notice stay at v7 — the shared LEGAL_DRAFTS_VERSION would record a version the screen did not show)
 * @param {string} id @param {Record<string, string | undefined>} [env]
 */
export const proTermsReference = (id, env = process.env) => `${id}@${(isProduction(env) && approvedVersionOf(id, env.VITE_LEGAL_DOCS_APPROVED_VERSION)) || latestDraftVersionOf(id)}`;

export const PRO_TERMS_NOT_IN_FORCE_REFUSAL = Object.freeze({
  error: 'La création de votre accès professionnel n’est pas encore ouverte : les conditions d’utilisation des professionnels ne sont pas encore en vigueur. Votre invitation n’a pas été utilisée.',
  code: 'PRO_TERMS_NOT_IN_FORCE',
});
export const PRO_TERMS_REQUIRED_REFUSAL = Object.freeze({
  error: 'Pour créer votre accès, acceptez les conditions d’utilisation des professionnels (texte au-dessus du bouton).',
  code: 'PRO_TERMS_ACCEPTANCE_REQUIRED',
});

/** writes the proof rows (inside the caller's transaction) @param {any} dbh @param {string} userId @param {string} role */
export async function recordProTermsAcceptance(dbh, userId, role) {
  const rows = proTermsDocumentsFor(role).map((id) => {
    const ref = proTermsReference(id);
    const purpose = PRO_TERMS_PURPOSES[/** @type {keyof typeof PRO_TERMS_PURPOSES} */ (id)];
    return { subject_type: 'PRO_USER', subject_id: String(userId), purpose, decision: true, policy_version: ref, policy_hash: `${ref}:${purpose}`,
      collection_channel: 'register-invite', guardian_involved: false, proof_level: CONTRACT_ACCEPTANCE };
  });
  await dbh.insert(ConsentLog).values(rows);
}
