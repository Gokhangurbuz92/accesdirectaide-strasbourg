import { Link } from 'react-router-dom';

/** Discreet, always-visible notice of the restricted public beta (owner directive 29/10/2026). */
export function PublicBetaBanner() {
  return (
    <div role="note" data-testid="public-beta-banner" className="w-full bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <p className="max-w-6xl mx-auto px-4 py-2">
        <strong>Bêta publique</strong> — version pilote en cours d’essai à Strasbourg. Les informations affichées viennent de sources officielles
        vérifiées ; les comptes, les rendez-vous et l’envoi de documents ne sont pas encore ouverts. Ce service ne remplace pas la décision
        de l’organisme qui attribue une aide.
      </p>
    </div>
  );
}

/** Shown instead of a screen that needs an account, a booking, a document or a form while the beta is restricted. */
export function PublicBetaUnavailable() {
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
      <p className="flex flex-wrap gap-4">
        <Link to="/aides" className="underline font-medium">Rechercher une aide</Link>
        <Link to="/demarches" className="underline font-medium">Voir les démarches</Link>
        <Link to="/structures" className="underline font-medium">Trouver une structure</Link>
      </p>
    </section>
  );
}
