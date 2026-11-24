import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import { frontendEnv } from '@/config/env';
import { isBetaRestrictedPath } from '@/lib/publicBeta';

/** The publisher's published contact address (mentions légales), or null when none is configured. The forms are closed in the public beta, not the contact. */
export function publicContactEmail() {
  return (String(LEGAL_PLACEHOLDERS.dataProtectionContact).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || null;
}

/** a mailto: link with a subject line (French), never a body: nothing personal is pre-filled */
export const mailtoWithSubject = (/** @type {string} */ email, /** @type {string} */ subject) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;

/** R3H: is the form at `to` (contact, help request) open in this build — outside the beta, or its surface opened (src/components/ContactLink.jsx) @param {string} [to] @param {boolean} [beta] */
export function contactFormOpen(to = '/contact', beta = frontendEnv.flags.publicBeta) {
  return !beta || !isBetaRestrictedPath(to);
}
