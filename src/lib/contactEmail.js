import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';

/** The publisher's published contact address (mentions légales), or null when none is configured. The forms are closed in the public beta, not the contact. */
export function publicContactEmail() {
  return (String(LEGAL_PLACEHOLDERS.dataProtectionContact).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || null;
}

/** a mailto: link with a subject line (French), never a body: nothing personal is pre-filled */
export const mailtoWithSubject = (email, subject) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;
