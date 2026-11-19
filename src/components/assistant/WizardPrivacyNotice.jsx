import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

/**
 * A-9 — the privacy notice of the orientation wizard (/orientation). The wizard posts its answers to the same endpoint as /diagnostic, so the first two
 * sentences are the diagnostic notice's own keys (src/components/diagnostic/PrivacyNotice.jsx — provisional LAB wording, not a legal approval). The third
 * sentence describes this wizard's browser storage as the code does it (src/lib/storage.js): first steps' choices in the tab's session only, removed when
 * the result is shown, on « Recommencer » or when the tab is closed; the last step is never stored. It promises no retention period and no legal basis.
 */
export default function WizardPrivacyNotice({ local = false }) {
  const { t } = useT('diagnostic');
  const restart = t('diagnostic:wizard.restart', 'Recommencer');
  // G4: the browser-only orientation (src/lib/orientationBrowserOnly.js) — describes what the code does: no request with the answers, no storage, no measure
  if (local) {
    const erase = t('diagnostic:wizard.local.erase', 'Effacer mes réponses');
    return (
      <section aria-labelledby="wizard-privacy-title" data-testid="wizard-privacy-notice" data-mode="browser-only" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-start text-sm text-slate-800">
        <p id="wizard-privacy-title" className="text-sm font-bold text-slate-900">{t('diagnostic:privacy.title', 'Vos données')}</p>
        <p className="mt-1" data-testid="wizard-privacy-local">{t('diagnostic:wizard.local.privacy', 'Ce questionnaire fonctionne entièrement dans votre navigateur. Vos réponses ne sont envoyées à aucun serveur, ne sont enregistrées nulle part (ni chez nous, ni dans la mémoire du navigateur) et ne sont pas mesurées.')}</p>
        <p className="mt-2">{t('diagnostic:wizard.local.privacy_erase', 'Elles disparaissent quand vous cliquez sur « {{erase}} », quand vous rechargez la page ou quand vous fermez l’onglet. Aucun compte n’est nécessaire.', { erase })}</p>
        <p className="mt-2">{t('diagnostic:wizard.local.privacy_topics', 'Les choix comme « Situation de handicap » servent seulement à choisir des sujets à lire : aucun détail sur votre santé n’est demandé.')}</p>
        <p className="mt-2">
          <Link to="/politique-confidentialite" className="inline-flex min-h-11 items-center font-semibold text-indigo-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('diagnostic:privacy.link', 'Lire la politique de confidentialité')}</Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="wizard-privacy-title" data-testid="wizard-privacy-notice" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-start text-sm text-slate-800">
      {/* a labelled region, not a heading: each step keeps its own single heading */}
      <p id="wizard-privacy-title" className="text-sm font-bold text-slate-900">{t('diagnostic:privacy.title', 'Vos données')}</p>
      <p className="mt-1">{t('diagnostic:privacy.p1', 'Pour réaliser ce diagnostic, vos réponses sont transmises à notre serveur. Des informations techniques sur le traitement sont enregistrées.')}</p>
      <p className="mt-2" data-testid="wizard-privacy-browser">
        {t('diagnostic:wizard.privacy.browser', 'Sur cet appareil, vos choix des premières étapes sont gardés seulement dans cet onglet, pour reprendre si la page se recharge. Ils sont effacés quand le résultat s’affiche, quand vous cliquez sur « {{restart}} » ou quand vous fermez l’onglet. Votre date de naissance, vos revenus et votre logement ne sont pas gardés dans le navigateur.', { restart })}
      </p>
      <p className="mt-2">
        <Link to="/politique-confidentialite" className="inline-flex min-h-11 items-center font-semibold text-indigo-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('diagnostic:privacy.link', 'Lire la politique de confidentialité')}</Link>
      </p>
    </section>
  );
}
