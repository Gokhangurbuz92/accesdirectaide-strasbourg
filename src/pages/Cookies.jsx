import { useState } from 'react';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import { Cookie, ShieldCheck, PieChart, Info, Settings2, CheckCircle2, Bug } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { AUDIENCE_OBJECTION_KEY, hasObjectedToAudience, setAudienceObjection } from '@/lib/audienceObjection';
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL } from '@/config/legal-documents';
import { frontendEnv } from "@/config/env";

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/03_COOKIES_TRACEURS.md, option A (Session Replay disabled,
// information banner). Any new cookie or storage key must be added here before publication.

const COOKIES = [
  ['ada_user_session', 'Vous garder connecté(e) à votre espace', '7 jours'],
  ['__csrf', 'Protéger les formulaires contre la falsification de requêtes (une valeur tirée au hasard, que le site n’enregistre pas et ne relie pas à votre identité)', '24 heures'],
];

const LOCAL_STORAGE = [
  ['ada_cookie_consent', 'Se souvenir que vous avez fermé le bandeau d\'information (ce n\'est pas un consentement)', '6 mois, puis le bandeau s\'affiche de nouveau'],
  ['ada-theme, accessibilitySettings', 'Thème et réglages d\'accessibilité', 'Jusqu\'à effacement'],
  ['falc-mode, falc-mode-preference', 'Lecture « Facile à lire et à comprendre »', 'Jusqu\'à effacement'],
  ['ada_onboarding_done, ada_chatbot_rgpd_dismissed', 'Ne plus afficher la visite guidée ou l\'information de l\'assistant', 'Jusqu\'à effacement'],
  ['ada_citizen_prefs, ada_pro_prefs, ada_admin_prefs', 'Préférences d\'affichage de chaque espace', 'Jusqu\'à effacement'],
  ['ada_diagnostic_state', 'Vos réponses au questionnaire, gardées sur l\'appareil', '24 heures au plus, ou jusqu\'à « Recommencer »'],
  ['pro_token', 'Connexion à l\'espace professionnel', 'Jusqu\'à effacement ou déconnexion'],
  [AUDIENCE_OBJECTION_KEY, 'Garder votre opposition à la mesure d\'audience (rien n\'est envoyé)', 'Jusqu\'à effacement ou retrait de l\'opposition'],
];

/** PKG-11 / C21 · C22: self-service objection to audience measurement, kept on this device; the measurement stops at once and is not loaded afterwards. */
function AudienceObjection() {
  const [objected, setObjected] = useState(() => hasObjectedToAudience());
  const [message, setMessage] = useState('');
  const toggle = () => {
    const next = !objected;
    if (setAudienceObjection(next)) {
      setObjected(next);
      setMessage(next ? (frontendEnv.flags.audienceMeasurement ? 'Opposition enregistrée sur cet appareil : la mesure d\'audience est arrêtée.' : 'Opposition enregistrée sur cet appareil : la mesure d\'audience ne sera pas activée pour vous.') : 'Opposition retirée sur cet appareil.');
    } else {
      setMessage('Votre navigateur n\'a pas permis de garder ce choix. Pour vous opposer, écrivez-nous.');
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-4" data-testid="audience-objection">
      <p id="audience-objection-state" className="font-medium text-slate-900">
        {objected ? 'Vous vous êtes opposé(e) à la mesure d\'audience sur cet appareil.' : frontendEnv.flags.audienceMeasurement ? 'La mesure d\'audience est active sur cet appareil.' : 'La mesure d\'audience n\'est pas activée sur ce site. Vous pouvez tout de même enregistrer votre opposition sur cet appareil, pour l\'avenir.'}
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={toggle} aria-describedby="audience-objection-state" data-testid="audience-objection-toggle">
        {objected ? 'Retirer mon opposition' : 'Je m\'oppose à la mesure d\'audience'}
      </Button>
      <p className="mt-2 text-sm text-slate-700" aria-live="polite" data-testid="audience-objection-message">{message}</p>
    </div>
  );
}

const SESSION_STORAGE = [
  ['access_token', 'Connexion administrateur', 'Fermeture de l\'onglet'],
  ['institution_token', 'Connexion d\'un partenaire institutionnel', 'Fermeture de l\'onglet'],
];

/** @param {{ caption: string, rows: string[][] }} props */
const TrackerTable = ({ caption, rows }) => (
  <div className="relative overflow-x-auto">
    <table className="w-full text-sm text-left border border-slate-200 rounded-lg overflow-hidden">
      <caption className="text-left font-semibold text-slate-900 mb-2">{caption}</caption>
      <thead className="bg-slate-50">
        <tr>
          <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">Nom</th>
          <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">Finalité</th>
          <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">Durée</th>
        </tr>
      </thead>
      <tbody className="text-slate-700 divide-y divide-slate-100">
        {rows.map(([name, purpose, duration]) => (
          <tr key={name}><td className="px-4 py-2 font-mono text-xs">{name}</td><td className="px-4 py-2">{purpose}</td><td className="px-4 py-2">{duration}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function Cookies() {
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title="Cookies et traceurs"
        description="Liste des cookies et traceurs d'AccesDirectAide, leur durée et vos choix."
        path="/cookies"
      />

      {/* Hero Section */}
      <PageHeader width="reading" title={<>Cookies</>} description={<>Nous utilisons peu de traceurs. Voici lesquels, et comment faire vos choix.</>} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <BetaProcessingNotice />

        {/* En bref */}
        <Card className="border-green-200 bg-green-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-100 text-green-700 rounded-full mt-1">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-900 mb-2">En bref</h2>
                <p className="text-green-800 leading-relaxed mb-4">
                  La plupart de nos traceurs servent à vous garder connecté(e), à sécuriser le site et à garder vos réglages. Ils ne demandent pas votre accord.
                  {frontendEnv.flags.publicBeta ? 'Pendant la bêta publique, nous ne mesurons pas l’audience.' : !frontendEnv.flags.audienceMeasurement ? ' Nous ne mesurons pas l’audience.' : <>Nous mesurons aussi l&apos;audience pour savoir quelles pages sont utiles : vous pouvez vous y opposer.</>}
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Pas de publicité.</span>
                  </div>
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Pas de réseaux sociaux.</span>
                  </div>
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Pas de suivi d&apos;un site à l&apos;autre.</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 md:p-8 space-y-8">
            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Settings2 className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">1. Traceurs nécessaires (sans accord)</h2>
              </div>
              <div className="space-y-6 text-slate-700 leading-relaxed px-2">
                <p>Ils servent à la connexion, à la sécurité ou aux réglages d&apos;affichage que vous avez demandés.</p>
                <TrackerTable caption="Cookies" rows={COOKIES} />
                <TrackerTable caption="Stockage local du navigateur (localStorage)" rows={LOCAL_STORAGE} />
                <TrackerTable caption="Stockage de session (sessionStorage)" rows={SESSION_STORAGE} />
                <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded border border-amber-100">
                  Appareil partagé (médiathèque, structure, famille) : vos réponses au questionnaire restent sur l&apos;appareil. Déconnectez-vous à la fin et effacez les données du site dans votre navigateur.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <PieChart className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">2. Mesure d&apos;audience et performance</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Nous utilisons <strong>Vercel Web Analytics</strong> et <strong>Vercel Speed Insights</strong>, fournis par Vercel Inc. (société américaine), pour notre seul compte : pages consultées, actions principales (par exemple « ouvrir une fiche », « commencer une prise de rendez-vous ») et vitesse d&apos;affichage.
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Selon son éditeur, cette solution ne dépose pas de cookie.</li>
                  <li>Nous n&apos;envoyons pas le texte de vos recherches.</li>
                  {frontendEnv.flags.publicBeta
                    ? <li data-testid="beta-no-analytics"><strong>Pendant la bêta publique, cette mesure n&apos;est pas activée</strong> : aucune donnée n&apos;est envoyée à Vercel Web Analytics ni à Speed Insights.</li>
                    : !frontendEnv.flags.audienceMeasurement
                      ? <li data-testid="no-analytics"><strong>Cette mesure n&apos;est pas activée</strong> : aucune donnée n&apos;est envoyée à Vercel Web Analytics ni à Speed Insights. Si elle l&apos;était un jour, cette page serait mise à jour avant.</li>
                      : <li>Durée de conservation chez Vercel : <em>[À COMPLÉTER : durée de conservation chez Vercel]</em>.</li>}
                  <li>Vous pouvez vous y opposer ci-dessous, sans compte : votre choix est gardé sur cet appareil, rien n&apos;est envoyé, et la mesure s&apos;arrête aussitôt. Vous pouvez aussi nous écrire (voir la <a href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>).</li>
                </ul>
                <AudienceObjection />
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Bug className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">3. Journal des erreurs techniques</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Quand une erreur se produit, nous en envoyons la description à notre prestataire <strong>Sentry</strong> (société américaine), après avoir retiré votre e-mail, votre adresse IP, les paramètres de l&apos;adresse de la page, les cookies et les en-têtes de connexion.
                </p>
                <p>
                  <strong>Nous n&apos;enregistrons pas vos sessions</strong> : l&apos;enregistrement de session (Session Replay) est désactivé par défaut. S&apos;il devait être activé un jour, il ne le serait qu&apos;avec votre accord, et cette page serait mise à jour avant.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <Info className="w-5 h-5 text-slate-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">4. Vos choix</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Vous pouvez aussi effacer ou bloquer les cookies dans votre navigateur :
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">Chrome: Paramètres → Confidentialité</span>
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">Firefox: Options → Vie privée</span>
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">Safari: Préférences → Confidentialité</span>
                </div>
                <p className="text-sm text-amber-700 mt-2 bg-amber-50 p-3 rounded border border-amber-100">
                  Si vous bloquez les cookies et le stockage du site, vous ne pourrez plus vous connecter et vos réglages d&apos;affichage ne seront pas gardés.
                </p>
              </div>
              <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4" data-legal-version={LEGAL_DOCS_VERSION.version}>
                {LEGAL_DOCS_LABEL}
              </p>
            </section>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
