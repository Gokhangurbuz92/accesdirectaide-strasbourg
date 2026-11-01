import { useState } from 'react';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { Cookie, ShieldCheck, PieChart, Info, Settings2, CheckCircle2, Bug } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { AUDIENCE_OBJECTION_KEY, hasObjectedToAudience, setAudienceObjection } from '@/lib/audienceObjection';
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL } from '@/config/legal-documents';
import { frontendEnv } from "@/config/env";
import i18n, { useLanguage, useT } from '@/i18n';

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/03_COOKIES_TRACEURS.md, option A (Session Replay disabled,
// information banner). Any new cookie or storage key must be added here before publication.
// R32: translated (namespace « legal »); the French text stays the legal reference. The storage key names are code: never translated.

/** Each tracker as [name, purpose, duration]; purpose and duration are translated at render (the French text is the default). @param {(key: string, fr: string) => string} t */
const cookieRows = (t) => [
  ['ada_user_session', t('legal:cookies.store.session.purpose', 'Vous garder connecté(e) à votre espace'), t('legal:cookies.store.session.duration', '7 jours')],
  ['__csrf', t('legal:cookies.store.csrf.purpose', 'Protéger les formulaires contre la falsification de requêtes (une valeur tirée au hasard, que le site n’enregistre pas et ne relie pas à votre identité)'), t('legal:cookies.store.csrf.duration', '24 heures')],
];

/** @param {(key: string, fr: string) => string} t */
const localStorageRows = (t) => [
  ['ada_cookie_consent', t('legal:cookies.store.banner.purpose', 'Se souvenir que vous avez fermé le bandeau d\'information (ce n\'est pas un consentement)'), t('legal:cookies.store.banner.duration', '6 mois, puis le bandeau s\'affiche de nouveau')],
  ['ada-theme, accessibilitySettings', t('legal:cookies.store.theme.purpose', 'Thème et réglages d\'accessibilité'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['falc-mode, falc-mode-preference', t('legal:cookies.store.falc.purpose', 'Lecture « Facile à lire et à comprendre »'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['ada_lang', t('legal:cookies.store.lang.purpose', 'La langue de l\'interface que vous avez choisie (ou « français » si vous avez refusé la suggestion de langue)'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['ada_reader_prefs', t('legal:cookies.store.reader.purpose', 'Vos réglages de lecture à voix haute (vitesse, voix, surlignage)'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['ada_onboarding_done, ada_chatbot_rgpd_dismissed', t('legal:cookies.store.onboarding.purpose', 'Ne plus afficher la visite guidée ou l\'information de l\'assistant'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['ada_citizen_prefs, ada_pro_prefs, ada_admin_prefs', t('legal:cookies.store.prefs.purpose', 'Préférences d\'affichage de chaque espace'), t('legal:cookies.store.untilCleared', 'Jusqu\'à effacement')],
  ['ada_diagnostic_state', t('legal:cookies.store.diagnostic.purpose', 'Vos réponses au questionnaire, gardées sur l\'appareil'), t('legal:cookies.store.diagnostic.duration', '24 heures au plus, ou jusqu\'à « Recommencer »')],
  ['pro_token', t('legal:cookies.store.pro.purpose', 'Connexion à l\'espace professionnel'), t('legal:cookies.store.pro.duration', 'Jusqu\'à effacement ou déconnexion')],
  [AUDIENCE_OBJECTION_KEY, t('legal:cookies.store.objection.purpose', 'Garder votre opposition à la mesure d\'audience (rien n\'est envoyé)'), t('legal:cookies.store.objection.duration', 'Jusqu\'à effacement ou retrait de l\'opposition')],
];

/** PKG-11 / C21 · C22: self-service objection to audience measurement, kept on this device; the measurement stops at once and is not loaded afterwards. */
function AudienceObjection() {
  const { t } = useT('legal');
  const [objected, setObjected] = useState(() => hasObjectedToAudience());
  // what happened is kept as a code and worded at render, so the announcement follows a change of interface language
  const [message, setMessage] = useState(/** @type {'' | 'stopped' | 'notActivated' | 'withdrawn' | 'failed'} */ (''));
  const toggle = () => {
    const next = !objected;
    if (setAudienceObjection(next)) {
      setObjected(next);
      setMessage(next ? (frontendEnv.flags.audienceMeasurement ? 'stopped' : 'notActivated') : 'withdrawn');
    } else {
      setMessage('failed');
    }
  };
  const messageText = {
    '': () => '',
    stopped: () => t('legal:cookies.objection.stopped', 'Opposition enregistrée sur cet appareil : la mesure d\'audience est arrêtée.'),
    notActivated: () => t('legal:cookies.objection.notActivated', 'Opposition enregistrée sur cet appareil : la mesure d\'audience ne sera pas activée pour vous.'),
    withdrawn: () => t('legal:cookies.objection.withdrawn', 'Opposition retirée sur cet appareil.'),
    failed: () => t('legal:cookies.objection.failed', 'Votre navigateur n\'a pas permis de garder ce choix. Pour vous opposer, écrivez-nous.'),
  }[message];
  return (
    <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-4" data-testid="audience-objection">
      <p id="audience-objection-state" className="font-medium text-slate-900">
        {objected
          ? t('legal:cookies.objection.stateObjected', 'Vous vous êtes opposé(e) à la mesure d\'audience sur cet appareil.')
          : frontendEnv.flags.audienceMeasurement
            ? t('legal:cookies.objection.stateActive', 'La mesure d\'audience est active sur cet appareil.')
            : t('legal:cookies.objection.stateOff', 'La mesure d\'audience n\'est pas activée sur ce site. Vous pouvez tout de même enregistrer votre opposition sur cet appareil, pour l\'avenir.')}
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={toggle} aria-describedby="audience-objection-state" data-testid="audience-objection-toggle">
        {objected ? t('legal:cookies.objection.withdraw', 'Retirer mon opposition') : t('legal:cookies.objection.object', 'Je m\'oppose à la mesure d\'audience')}
      </Button>
      <p className="mt-2 text-sm text-slate-700" aria-live="polite" data-testid="audience-objection-message">{messageText()}</p>
    </div>
  );
}

/** @param {(key: string, fr: string) => string} t */
const sessionStorageRows = (t) => [
  ['access_token', t('legal:cookies.store.admin.purpose', 'Connexion administrateur'), t('legal:cookies.store.tabClosed', 'Fermeture de l\'onglet')],
  ['institution_token', t('legal:cookies.store.institution.purpose', 'Connexion d\'un partenaire institutionnel'), t('legal:cookies.store.tabClosed', 'Fermeture de l\'onglet')],
];

/** @param {{ caption: string, rows: string[][] }} props */
const TrackerTable = ({ caption, rows }) => {
  const { t } = useT('legal');
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm text-start border border-slate-200 rounded-lg overflow-hidden">
        <caption className="text-start font-semibold text-slate-900 mb-2">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">{t('legal:cookies.table.name', 'Nom')}</th>
            <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">{t('legal:cookies.table.purpose', 'Finalité')}</th>
            <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">{t('legal:cookies.table.duration', 'Durée')}</th>
          </tr>
        </thead>
        <tbody className="text-slate-700 divide-y divide-slate-100">
          {rows.map(([name, purpose, duration]) => (
            // the key names are code: kept left to right (also inside an Arabic page) and out of reach of automatic page translation
            <tr key={name}><td className="px-4 py-2 font-mono text-xs"><span dir="ltr" translate="no">{name}</span></td><td className="px-4 py-2">{purpose}</td><td className="px-4 py-2">{duration}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function Cookies() {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const intro = t('legal:cookies.intro', 'Nous utilisons peu de traceurs. Voici lesquels, et comment faire vos choix.');
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title={t('legal:cookies.seo.title', 'Cookies et traceurs')}
        description={t('legal:cookies.seo.description', "Liste des cookies et traceurs d'AccesDirectAide, leur durée et vos choix.")}
        path="/cookies"
      />

      {/* Hero Section — French keeps its written heading (read by e2e/legal-pages.spec.js and the source guard); the other languages show its translation */}
      {isSource
        ? <PageHeader width="reading" title={<>Cookies</>} description={intro} />
        : <PageHeader width="reading" title={t('legal:cookies.title', 'Cookies')} description={intro} />}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LegalTranslationNotice />
        <BetaProcessingNotice />

        {/* En bref */}
        <Card className="border-green-200 bg-green-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-100 text-green-700 rounded-full mt-1">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-900 mb-2">{t('legal:cookies.summary.title', 'En bref')}</h2>
                <p className="text-green-800 leading-relaxed mb-4">
                  {t('legal:cookies.summary.text', 'La plupart de nos traceurs servent à vous garder connecté(e), à sécuriser le site et à garder vos réglages. Ils ne demandent pas votre accord.')}{' '}
                  {frontendEnv.flags.publicBeta
                    ? t('legal:cookies.summary.beta', 'Pendant la bêta publique, nous ne mesurons pas l’audience.')
                    : !frontendEnv.flags.audienceMeasurement
                      ? t('legal:cookies.summary.notMeasured', 'Nous ne mesurons pas l’audience.')
                      : t('legal:cookies.summary.measured', 'Nous mesurons aussi l\'audience pour savoir quelles pages sont utiles : vous pouvez vous y opposer.')}
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>{t('legal:cookies.summary.noAds', 'Pas de publicité.')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>{t('legal:cookies.summary.noSocial', 'Pas de réseaux sociaux.')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>{t('legal:cookies.summary.noCrossSite', "Pas de suivi d'un site à l'autre.")}</span>
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
                <h2 className="text-xl font-bold text-slate-900">{t('legal:cookies.needed.title', '1. Traceurs nécessaires (sans accord)')}</h2>
              </div>
              <div className="space-y-6 text-slate-700 leading-relaxed px-2">
                <p>{t('legal:cookies.needed.intro', "Ils servent à la connexion, à la sécurité ou aux réglages d'affichage que vous avez demandés.")}</p>
                <TrackerTable caption={t('legal:cookies.needed.cookies', 'Cookies')} rows={cookieRows(t)} />
                <TrackerTable caption={t('legal:cookies.needed.localStorage', 'Stockage local du navigateur (localStorage)')} rows={localStorageRows(t)} />
                <TrackerTable caption={t('legal:cookies.needed.sessionStorage', 'Stockage de session (sessionStorage)')} rows={sessionStorageRows(t)} />
                <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded border border-amber-100">
                  {t('legal:cookies.needed.sharedDevice', "Appareil partagé (médiathèque, structure, famille) : vos réponses au questionnaire restent sur l'appareil. Déconnectez-vous à la fin et effacez les données du site dans votre navigateur.")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <PieChart className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('legal:cookies.audience.title', "2. Mesure d'audience et performance")}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:cookies.audience.what" defaults="Nous utilisons <strong>Vercel Web Analytics</strong> et <strong>Vercel Speed Insights</strong>, fournis par Vercel Inc. (société américaine), pour notre seul compte : pages consultées, actions principales (par exemple « ouvrir une fiche », « commencer une prise de rendez-vous ») et vitesse d'affichage." />
                </p>
                <ul className="list-disc ps-5 mt-2 space-y-1">
                  <li>{t('legal:cookies.audience.noCookie', 'Selon son éditeur, cette solution ne dépose pas de cookie.')}</li>
                  <li>{t('legal:cookies.audience.noSearch', "Nous n'envoyons pas le texte de vos recherches.")}</li>
                  {frontendEnv.flags.publicBeta
                    ? <li data-testid="beta-no-analytics"><Trans i18n={i18n} i18nKey="legal:cookies.audience.beta" defaults="<strong>Pendant la bêta publique, cette mesure n'est pas activée</strong> : aucune donnée n'est envoyée à Vercel Web Analytics ni à Speed Insights." /></li>
                    : !frontendEnv.flags.audienceMeasurement
                      ? <li data-testid="no-analytics"><Trans i18n={i18n} i18nKey="legal:cookies.audience.off" defaults="<strong>Cette mesure n'est pas activée</strong> : aucune donnée n'est envoyée à Vercel Web Analytics ni à Speed Insights. Si elle l'était un jour, cette page serait mise à jour avant." /></li>
                      : <li><Trans i18n={i18n} i18nKey="legal:cookies.audience.retention" defaults="Durée de conservation chez Vercel : <0>[À COMPLÉTER : durée de conservation chez Vercel]</0>." components={[<em key="todo" />]} /></li>}
                  <li>
                    <Trans i18n={i18n} i18nKey="legal:cookies.audience.objection" defaults="Vous pouvez vous y opposer ci-dessous, sans compte : votre choix est gardé sur cet appareil, rien n'est envoyé, et la mesure s'arrête aussitôt. Vous pouvez aussi nous écrire (voir la <0>politique de confidentialité</0>)."
                      components={[<a key="privacy" href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>]} />
                  </li>
                </ul>
                <AudienceObjection />
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Bug className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('legal:cookies.errors.title', '3. Journal des erreurs techniques')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:cookies.errors.sentry" defaults="Quand une erreur se produit, nous en envoyons la description à notre prestataire <strong>Sentry</strong> (société américaine), après avoir retiré votre e-mail, votre adresse IP, les paramètres de l'adresse de la page, les cookies et les en-têtes de connexion." />
                </p>
                <p>
                  <Trans i18n={i18n} i18nKey="legal:cookies.errors.replay" defaults="<strong>Nous n'enregistrons pas vos sessions</strong> : l'enregistrement de session (Session Replay) est désactivé par défaut. S'il devait être activé un jour, il ne le serait qu'avec votre accord, et cette page serait mise à jour avant." />
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <Info className="w-5 h-5 text-slate-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('legal:cookies.choices.title', '4. Vos choix')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:cookies.choices.intro', 'Vous pouvez aussi effacer ou bloquer les cookies dans votre navigateur :')}
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">{t('legal:cookies.choices.chrome', 'Chrome: Paramètres → Confidentialité')}</span>
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">{t('legal:cookies.choices.firefox', 'Firefox: Options → Vie privée')}</span>
                  <span className="px-3 py-1.5 bg-slate-100 rounded-md border border-slate-200">{t('legal:cookies.choices.safari', 'Safari: Préférences → Confidentialité')}</span>
                </div>
                <p className="text-sm text-amber-700 mt-2 bg-amber-50 p-3 rounded border border-amber-100">
                  {t('legal:cookies.choices.blocked', "Si vous bloquez les cookies et le stockage du site, vous ne pourrez plus vous connecter et vos réglages d'affichage ne seront pas gardés.")}
                </p>
              </div>
              <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4" data-legal-version={LEGAL_DOCS_VERSION.version} {...fr}>
                {LEGAL_DOCS_LABEL}
              </p>
            </section>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
