/** V2 (security review D6) — pure (no database import): used by the sign-up and by the release preflight. */
import { LEGAL_DRAFT_DOCUMENTS, draftVisibility } from '../../src/config/legal-drafts.js';

/** the documents a citizen account is created under */
export const CITIZEN_ACCOUNT_DOCUMENTS = Object.freeze(['cgu-citoyen', 'notice-confidentialite']);

/**
 * V2 (security review D6): in Production an account is created only under terms that are IN FORCE — the approved version named at the build
 * (VITE_LEGAL_DOCS_APPROVED_VERSION, the same value the screens read). Otherwise the ledger would record the acceptance of a draft nobody could read
 * (Production hides drafts). Outside Production (LAB, Preview) drafts are accepted, marked as drafts on screen.
 * @param {Record<string, string | undefined>} [env]
 */
export function citizenTermsInForce(env = process.env) {
  if (String(env.VERCEL_ENV || '').toLowerCase() !== 'production') return true;
  return CITIZEN_ACCOUNT_DOCUMENTS.every((id) => {
    const doc = LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === id);
    return doc !== undefined && draftVisibility(doc, { approved: env.VITE_LEGAL_DOCS_APPROVED_VERSION, production: true }) === 'IN_FORCE';
  });
}

export const TERMS_NOT_IN_FORCE_REFUSAL = Object.freeze({
  error: 'TERMS_NOT_IN_FORCE',
  code: 'TERMS_NOT_IN_FORCE',
  message: 'La création de compte n’est pas encore ouverte : les conditions d’utilisation ne sont pas encore en vigueur.',
});

