import { Link } from 'react-router-dom';
import { contactFormOpen, publicContactEmail } from '@/lib/contactEmail';

/**
 * R3H (live audit 24/11/2026) — a link to the contact or help-request form. In the public beta those forms are closed (surface « communications »): the
 * legal pages, the glossary, the method pages, the sign-in help and the error page led to « Cette fonction n'est pas encore ouverte ». While the form is
 * closed the link writes to the published contact address instead (mailto, no body); with no published address it is not shown (`null`).
 * @param {{ to?: string, children?: import('react').ReactNode, closedLabel?: import('react').ReactNode, className?: string, [k: string]: any }} props
 */
export default function ContactLink({ to = '/contact', children, closedLabel, ...rest }) {
  if (contactFormOpen(to)) return <Link to={to} {...rest}>{children}</Link>;
  const email = publicContactEmail();
  if (!email) return null;
  return <a href={`mailto:${email}`} {...rest}>{closedLabel ?? children}</a>;
}

