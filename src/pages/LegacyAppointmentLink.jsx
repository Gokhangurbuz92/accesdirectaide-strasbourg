// @ts-nocheck
import { Link, Navigate, useLocation } from 'react-router-dom';
import SEO from '@/components/SEO';

/**
 * Honest landing for the pre-RDV-module links: /appointments/request, /appointments/cancel/:token, /appointments/reschedule/:token and /r/:token/messages.
 * Their backend endpoints (/api/appointments, /api/appointments/cancel|reschedule, /api/public/availability, /api/public/messages) are not routed in this product (see
 * tests/unit/orphan-handler-contract.test.js): the old pages could only fail ("Impossible de vérifier les créneaux…") and, worse for reschedule, looked like a working booking tool.
 * Nothing is called here and no token is read or kept. A capability can sit in the URL path, the query string or the fragment: all three are replaced (not pushed) by a neutral URL
 * before the page renders, so the history entry, the same-origin Referer of the link below and any later copy of the address bar no longer carry it.
 * The first request to the server already saw the path: that cannot be undone client-side and is not claimed.
 * The supported paths are the structure's own page (book / manage with the link of the confirmation e-mail), the citizen's own messages after login, or contacting the structure.
 */
const GONE = "Ce lien d'une ancienne version n'est plus pris en charge.";
const COPY = {
  request: { neutral: '/appointments/request', title: 'Prendre rendez-vous', body: "La prise de rendez-vous se fait depuis la fiche de la structure que vous choisissez. Toutes les structures ne proposent pas de rendez-vous en ligne.", note: "Aucun rendez-vous n'a été créé, modifié ou annulé en ouvrant cette page.", cta: { to: '/structures', label: 'Trouver une structure' } },
  cancel: { neutral: '/appointments/cancel', title: 'Annuler un rendez-vous', body: `${GONE} Utilisez le lien « gérer mon rendez-vous » de votre e-mail de confirmation le plus récent, ou contactez directement la structure.`, note: "Aucun rendez-vous n'a été créé, modifié ou annulé en ouvrant cette page.", cta: { to: '/structures', label: 'Trouver une structure' } },
  reschedule: { neutral: '/appointments/reschedule', title: 'Reporter un rendez-vous', body: `${GONE} Utilisez le lien « gérer mon rendez-vous » de votre e-mail de confirmation le plus récent, ou contactez directement la structure.`, note: "Aucun rendez-vous n'a été créé, modifié ou annulé en ouvrant cette page.", cta: { to: '/structures', label: 'Trouver une structure' } },
  messages: { neutral: '/r/messages', title: 'Messagerie', body: `${GONE} Vos échanges avec une structure se trouvent dans votre espace, après connexion, ou contactez directement la structure.`, note: "Aucun message n'a été lu ou envoyé en ouvrant cette page.", cta: { to: '/compte/messages', label: 'Ouvrir mes messages' } },
};

export default function LegacyAppointmentLink({ kind = 'request' }) {
  const copy = COPY[kind] || COPY.request;
  const location = useLocation();
  if (location.pathname !== copy.neutral || location.hash || location.search) return <Navigate to={copy.neutral} replace />;
  return (
    <div className="max-w-xl mx-auto px-4 py-12" data-testid="legacy-appointment-link">
      <SEO title={copy.title} description={copy.body} noindex />
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{copy.title}</h1>
      <p className="text-slate-700 mb-6">{copy.body}</p>
      <p className="text-sm text-slate-600 mb-6">{copy.note}</p>
      <Link to={copy.cta.to} className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white font-medium hover:bg-indigo-700">{copy.cta.label}</Link>
    </div>
  );
}
