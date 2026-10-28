// @ts-nocheck
import { Link } from 'react-router-dom';

/**
 * /admin/messages — owner LAB audit (2026-10-25). This page used to list « contact » messages through a `Contact` entity of the former Base44 platform; that
 * entity does not exist here, so the list could never load. The public contact form (api/_handlers/contact.js) stores nothing: it sends the message by e-mail
 * to ADA's mailbox, and answers honestly that it could not be sent when no e-mail provider is configured (the local LAB). The page now says so.
 */
export default function AdminMessages() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid="admin-messages-info">
      <h1 className="text-2xl font-bold text-slate-900">Messages du formulaire de contact</h1>
      <p className="text-slate-800">Les messages du formulaire de contact ne sont pas conservés dans l’application : ils sont envoyés par e-mail à la boîte d’ADA.</p>
      <p className="text-slate-800">Tant qu’aucun fournisseur d’e-mail n’est configuré (c’est le cas du LAB local), le formulaire répond à la personne que son message n’a pas pu être transmis et lui indique une autre façon de vous joindre.</p>
      <p className="text-slate-800">Les demandes envoyées depuis le formulaire d’aide, elles, sont conservées : voir les <Link className="text-blue-800 underline" to="/admin/support">demandes d’aide</Link>.</p>
    </div>
  );
}
