// @ts-nocheck
import { Link, Navigate, useLocation } from 'react-router-dom';
import SEO from '@/components/SEO';
import { useT } from '@/i18n';

/**
 * Honest landing for the pre-RDV-module links: /appointments/request, /appointments/cancel/:token, /appointments/reschedule/:token and /r/:token/messages.
 * Their backend endpoints (/api/appointments, /api/appointments/cancel|reschedule, /api/public/availability, /api/public/messages) are not routed in this product (see
 * tests/unit/orphan-handler-contract.test.js): the old pages could only fail ("Impossible de vérifier les créneaux…") and, worse for reschedule, looked like a working booking tool.
 * Nothing is called here and no token is read or kept. A capability can sit in the URL path, the query string or the fragment: all three are replaced (not pushed) by a neutral URL
 * before the page renders, so the history entry, the same-origin Referer of the link below and any later copy of the address bar no longer carry it.
 * The first request to the server already saw the path: that cannot be undone client-side and is not claimed.
 * The supported paths are the structure's own page (book / manage with the link of the confirmation e-mail), the citizen's own messages after login, or contacting the structure.
 */
/** A-12: the neutral address and the next step of each old link; the wording is in `copyOf` (six languages) */
const KINDS = {
  request: { neutral: '/appointments/request', to: '/structures' },
  cancel: { neutral: '/appointments/cancel', to: '/structures' },
  reschedule: { neutral: '/appointments/reschedule', to: '/structures' },
  messages: { neutral: '/r/messages', to: '/compte/messages' },
};

/**
 * A-12: the page was hardcoded French on live routes; every string now goes through the interface language (the French defaults are unchanged).
 * @param {(key: string, fallback: string) => string} t @param {string} kind
 */
function copyOf(t, kind) {
  const gone = t('booking:legacy.gone', "Ce lien d'une ancienne version n'est plus pris en charge.");
  const manage = t('booking:legacy.manage', 'Utilisez le lien « gérer mon rendez-vous » de votre e-mail de confirmation le plus récent, ou contactez directement la structure.');
  const untouched = t('booking:legacy.note.appointment', "Aucun rendez-vous n'a été créé, modifié ou annulé en ouvrant cette page.");
  const find = t('booking:legacy.cta.find', 'Trouver une structure');
  switch (kind) {
    case 'cancel': return { title: t('booking:legacy.cancel.title', 'Annuler un rendez-vous'), body: `${gone} ${manage}`, note: untouched, cta: find };
    case 'reschedule': return { title: t('booking:legacy.reschedule.title', 'Reporter un rendez-vous'), body: `${gone} ${manage}`, note: untouched, cta: find };
    case 'messages': return {
      title: t('booking:legacy.messages.title', 'Messagerie'),
      body: `${gone} ${t('booking:legacy.messages.body', 'Vos échanges avec une structure se trouvent dans votre espace, après connexion, ou contactez directement la structure.')}`,
      note: t('booking:legacy.note.message', "Aucun message n'a été lu ou envoyé en ouvrant cette page."),
      cta: t('booking:legacy.cta.messages', 'Ouvrir mes messages'),
    };
    default: return {
      title: t('booking:legacy.request.title', 'Prendre rendez-vous'),
      body: t('booking:legacy.request.body', 'La prise de rendez-vous se fait depuis la fiche de la structure que vous choisissez. Toutes les structures ne proposent pas de rendez-vous en ligne.'),
      note: untouched, cta: find,
    };
  }
}

export default function LegacyAppointmentLink({ kind = 'request' }) {
  const { t } = useT('booking');
  const known = Object.hasOwn(KINDS, kind) ? kind : 'request';
  const target = KINDS[known];
  const copy = copyOf(t, known);
  const location = useLocation();
  if (location.pathname !== target.neutral || location.hash || location.search) return <Navigate to={target.neutral} replace />;
  return (
    <div className="max-w-xl mx-auto px-4 py-12" data-testid="legacy-appointment-link">
      <SEO title={copy.title} description={copy.body} noindex />
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{copy.title}</h1>
      <p className="text-slate-700 mb-6">{copy.body}</p>
      <p className="text-sm text-slate-600 mb-6">{copy.note}</p>
      <Link to={target.to} className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white font-medium hover:bg-indigo-700">{copy.cta}</Link>
    </div>
  );
}
