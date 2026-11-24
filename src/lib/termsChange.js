import { approvedVersionOf, currentDraftContext } from '@/config/legal-drafts';

/**
 * Release 3 (owner approval 24/11/2026) — the citizen-terms versions that carry a one-time « nos conditions ont changé » notice in Mon Espace
 * (src/components/account/TermsChangeNotice.jsx), with their date.
 */
export const TERMS_CHANGE_NOTICES = Object.freeze({
  // version of cgu-citoyen → its date (the notice v14-2026-11-24 changed with it)
  'v13-2026-11-24': '2026-11-24',
});
export const termsChangeStorageKey = (/** @type {string} */ version) => `ada:terms-change-seen:cgu-citoyen@${version}`;

/** the version this build has in force, if it carries a change notice @param {{ approved?: string }} [ctx] */
export function termsChangeVersion(ctx = currentDraftContext()) {
  const v = approvedVersionOf('cgu-citoyen', ctx.approved);
  return v && Object.prototype.hasOwnProperty.call(TERMS_CHANGE_NOTICES, v) ? v : null;
}

