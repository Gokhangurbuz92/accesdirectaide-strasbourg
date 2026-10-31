import { Link, useLocation } from 'react-router-dom';
import { publicContactEmail } from '@/lib/contactEmail';

/** Discreet, always-visible notice of the restricted public beta (owner directive 29/10/2026). */
export function PublicBetaBanner() {
  return (
    <div role="note" data-testid="public-beta-banner" className="w-full bg-amber-50 border-b border-amber-200 text-amber-950 text-xs sm:text-sm">
      {/* R26: one short line — what works, what is not open yet, who decides (it used to fill three lines on a phone) */}
      <p className="max-w-7xl mx-auto px-4 py-1.5 sm:px-6 lg:px-8">
        <strong>Bêta publique</strong> · Aides, démarches et lieux vérifiés sur sources officielles. Comptes, rendez-vous et documents : pas encore
        ouverts. Seul l’organisme concerné décide de vos droits.
      </p>
    </div>
  );
}

/** Shown instead of a screen that needs an account, a booking, a document or a form while the beta is restricted. */
export function PublicBetaUnavailable() {
  const { pathname } = useLocation();
  // the contact form is closed, not the contact: the published address (mentions légales) is given instead of a dead end
  const email = publicContactEmail();
  const contact = /^\/contact(\/|$)/.test(pathname || '');
  return (
    <section data-testid="public-beta-unavailable" aria-labelledby="beta-unavailable-title" className="max-w-2xl mx-auto px-4 py-16">
      <h1 id="beta-unavailable-title" className="text-2xl font-semibold mb-4">Cette fonction n’est pas encore ouverte</h1>
      <p className="mb-3">
        Accès Direct Aide est en <strong>bêta publique</strong>. Pendant cette phase, vous pouvez consulter les aides, les démarches et les
        structures vérifiées, avec leurs sources officielles.
      </p>
      <p className="mb-6">
        La création de compte, l’espace personnel, la prise de rendez-vous, le partage de dossier, l’envoi de documents et les formulaires
        de contact ouvriront plus tard, quand les garanties de protection des données seront en place. Aucune donnée personnelle n’est
        collectée ici.
      </p>
      {contact && email && (
        <p className="mb-6" data-testid="public-beta-contact">
          Pour une question ou pour signaler une erreur, écrivez-nous à <a href={`mailto:${email}`} className="underline font-medium">{email}</a>.
          N’écrivez pas d’informations personnelles sensibles (santé, numéro de sécurité sociale, documents).
        </p>
      )}
      <p className="flex flex-wrap gap-4">
        <Link to="/aides" className="underline font-medium">Rechercher une aide</Link>
        <Link to="/demarches" className="underline font-medium">Voir les démarches</Link>
        <Link to="/structures" className="underline font-medium">Trouver une structure</Link>
      </p>
    </section>
  );
}
