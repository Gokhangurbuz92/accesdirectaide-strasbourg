import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { Lock, EyeOff, UserCheck, ShieldAlert, Database, HelpCircle, Bot, BarChart3 } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL, LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import ClearDeviceAnswers from '@/components/privacy/ClearDeviceAnswers';
import { frontendEnv } from "@/config/env";
import i18n, { useLanguage, useT } from '@/i18n';

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/02_POLITIQUE_CONFIDENTIALITE.md and FAITS_TECHNIQUES.md
// (status: LEGAL_DOCS_VERSION.status). Only describe what the code really does; "[À COMPLÉTER : …]" placeholders are intentional.
// R32: translated (namespace « legal »); the French text stays the legal reference. Values of the configuration (publisher identity, contact, version
// label) are shown as written and marked as French when the interface is in another language.

/** @param {{ icon: import('react').ElementType, children: import('react').ReactNode }} props */
const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
    <div className="p-2 bg-blue-50 rounded-lg">
      <Icon className="w-5 h-5 text-blue-600" />
    </div>
    <h2 className="text-xl font-bold text-slate-900">{children}</h2>
  </div>
);

/** @param {{ title: import('react').ReactNode, children: import('react').ReactNode }} props */
const Item = ({ title, children }) => (
  <div>
    <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-blue-500"></span>{title}
    </h3>
    <p className="text-sm">{children}</p>
  </div>
);

/** What the weekly purge applies today, as [data, duration] (translated at render; the French text is the default). @param {(key: string, fr: string) => string} t */
const retentionApplied = (t) => [
  [t('legal:privacy.retention.audit', 'Journal d\'audit (sécurité, contient l\'adresse IP)'), t('legal:privacy.retention.d365', '365 jours')],
  [t('legal:privacy.retention.proActions', 'Journal des actions des professionnels'), t('legal:privacy.retention.d365', '365 jours')],
  [t('legal:privacy.retention.consents', 'Preuves de consentement'), t('legal:privacy.retention.d1095', '1 095 jours (3 ans)')],
  [t('legal:privacy.retention.conversations', 'Conversations avec l\'assistant'), t('legal:privacy.retention.d90', '90 jours')],
  [t('legal:privacy.retention.aiQuality', 'Mesures de qualité de l\'IA'), t('legal:privacy.retention.d90', '90 jours')],
  [t('legal:privacy.retention.versions', 'Historique des versions d\'enregistrements'), t('legal:privacy.retention.d90', '90 jours')],
  [t('legal:privacy.retention.updates', 'Journal des mises à jour'), t('legal:privacy.retention.d90', '90 jours')],
  [t('legal:privacy.retention.sharedCopy', 'Copie partagée du questionnaire'), t('legal:privacy.retention.sharedCopyDuration', 'à l\'expiration du lien (7 jours) ou au plus 90 jours, sauf conservation légale en cas de litige')],
  [t('legal:privacy.retention.tokens', 'Jetons de connexion et consentements'), t('legal:privacy.retention.atExpiry', 'à leur expiration')],
  [t('legal:privacy.retention.invitations', 'Invitations, jetons d\'agenda'), t('legal:privacy.retention.afterExpiry30', '30 jours après expiration')],
  [t('legal:privacy.retention.appointments', 'Rendez-vous'), t('legal:privacy.retention.d730', 'anonymisés après 730 jours (2 ans)')],
];

export default function Confidentialite() {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const contact = LEGAL_PLACEHOLDERS.dataProtectionContact;
  const contactValue = (/** @type {string} */ key) => <em key={key} {...fr}>{contact}</em>;
  const title = t('legal:privacy.title', 'Politique de confidentialité');
  const intro = t('legal:privacy.intro', 'Quelles données nous traitons, pourquoi, combien de temps, et vos droits.');
  const cookiesLink = <a key="cookies" href="/cookies" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">Cookies</a>;
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title={title}
        description={intro}
        path="/politique-confidentialite"
      />

      {/* Hero Section — French keeps its written heading (read by e2e/legal-pages.spec.js and the source guard); the other languages show its translation */}
      {isSource
        ? <PageHeader width="reading" title={<>Politique de confidentialité</>} description={intro} />
        : <PageHeader width="reading" title={title} description={intro} />}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LegalTranslationNotice />
        <BetaProcessingNotice />

        {/* En bref */}
        <Card className="border-indigo-200 bg-indigo-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-indigo-100 text-indigo-700 rounded-full mt-1">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-indigo-900 mb-2">{t('legal:privacy.summary.title', 'En bref')}</h2>
                <ul className="list-disc ps-5 space-y-1 text-indigo-900/90 leading-relaxed text-sm">
                  <li>{t('legal:privacy.summary.minimum', 'Nous traitons seulement les données nécessaires au service. Nous ne les vendons pas et ne faisons pas de publicité.')}</li>
                  <li>{t('legal:privacy.summary.noAccount', 'Vous pouvez lire les fiches sans compte.')}</li>
                  <li>{t('legal:privacy.summary.sharing', 'Vous choisissez avec quelle structure vous partagez votre dossier, et vous pouvez arrêter le partage quand vous voulez.')}</li>
                  <li>{t('legal:privacy.summary.encryption', "Les échanges avec le site sont chiffrés pendant le transport (HTTPS). Vos messages, notes et documents, les réponses de vos dossiers partagés et le nom et les notes d'un rendez-vous sont en plus chiffrés à l'enregistrement. Ce n'est pas un chiffrement de bout en bout : nos serveurs détiennent les clés. Votre adresse e-mail et le numéro de téléphone d'un rendez-vous ne sont pas chiffrés à l'enregistrement : ils servent à vous reconnaître et à vous joindre. Les administrateurs n'ont pas accès au contenu des dossiers ; un accès d'urgence est limité, enregistré et revu par un autre administrateur.")}</li>
                  <li>{t('legal:privacy.summary.assistant', "L'assistant est un programme informatique (IA), pas une personne. Il ne décide pas de vos droits.")}</li>
                  <li>{t('legal:privacy.summary.rights', 'Vous pouvez télécharger vos données, demander à les corriger ou à les effacer, et vous plaindre à la CNIL.')}</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Détails */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 md:p-8 space-y-8">

            <section className="space-y-4">
              <SectionTitle icon={UserCheck}>{t('legal:privacy.controller.title', 'Qui est responsable de vos données ?')}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p><strong>{t('legal:privacy.controller.label', 'Responsable de traitement :')}</strong> <em {...fr}>{LEGAL_PLACEHOLDERS.publisherIdentity}</em></p>
                <p><strong>{t('legal:privacy.controller.contactLabel', 'Contact protection des données :')}</strong> {contactValue('contact')}</p>
                <p>{t('legal:privacy.controller.noDpo', "Nous n'avons pas désigné de délégué à la protection des données à ce jour.")}</p>
                <p>{t('legal:privacy.controller.structures', "Les structures (CCAS, associations, professionnels) qui utilisent AccesDirectAide sont responsables de ce qu'elles font des informations que vous leur partagez et de leurs notes de suivi.")}</p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Database}>{t('legal:privacy.data.title', 'Données traitées et pourquoi')}</SectionTitle>
              <div className="space-y-5 text-slate-700 leading-relaxed px-2">
                <Item title={t('legal:privacy.data.reading.title', '1. Lire le site sans compte')}>
                  {t('legal:privacy.data.reading.noAccount', 'Vous pouvez lire les fiches sans compte.')}{' '}
                  {frontendEnv.flags.publicBeta
                    ? t('legal:privacy.data.reading.beta', "Pendant la bêta publique, nous ne mesurons pas l'audience et n'enregistrons pas les erreurs chez un prestataire ; l'hébergeur garde ses journaux techniques (dont l'adresse IP) un jour, et la limitation de débit garde un compteur par adresse IP pendant quelques minutes.")
                    : !frontendEnv.flags.audienceMeasurement
                      ? <Trans i18n={i18n} i18nKey="legal:privacy.data.reading.noAudience" defaults="Nous ne mesurons pas l&apos;audience ; nous enregistrons les erreurs techniques." />
                      : t('legal:privacy.data.reading.audience', "Nous mesurons l'audience pour notre seul usage (pages vues, actions principales) et enregistrons les erreurs techniques.")}{' '}
                  {t('legal:privacy.data.reading.securityLogs', "Les journaux de sécurité contiennent l'adresse IP ; ils sont gardés 365 jours.")}
                </Item>
                <Item title={t('legal:privacy.data.questionnaire.title', '2. Le questionnaire')}>
                  {t('legal:privacy.data.questionnaire.text', 'Vos réponses sont envoyées à notre serveur pour le calcul, sans y être conservées. Votre appareil les garde 24 heures, puis les efface à votre visite suivante ; sur un appareil partagé, effacez-les tout de suite. Si vous partagez votre dossier avec une structure, une copie chiffrée de vos réponses est conservée pour ce partage.')}
                  <ClearDeviceAnswers />
                </Item>
                <Item title={t('legal:privacy.data.account.title', '3. Votre compte')}>
                  {t('legal:privacy.data.account.text', "Les contenus sensibles (messages, notes, documents, réponses partagées) sont chiffrés à l'enregistrement (pas de chiffrement de bout en bout). Votre compte est conservé tant que vous l'utilisez. La suppression automatique des comptes inactifs n'est pas encore en place.")}
                </Item>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Bot}>{t('legal:privacy.assistant.title', "L'assistant d'information (IA)")}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>{t('legal:privacy.assistant.what', "L'assistant est un programme informatique (intelligence artificielle), pas une personne. Il fonctionne sur nos serveurs : vos questions ne sont envoyées à aucun fournisseur d'IA extérieur. Il répond seulement à partir de fiches vérifiées, cite ses sources et s'abstient s'il ne trouve pas de réponse fiable. Il ne décide pas de vos droits.")}</p>
                <p><Trans i18n={i18n} i18nKey="legal:privacy.assistant.retention" defaults="Les conversations et les mesures de qualité sont gardées <strong>90 jours</strong>." /></p>
                <p><strong>{t('legal:privacy.assistant.never', 'Ne lui transmettez jamais votre numéro de sécurité sociale, ni de données de santé ou bancaires.')}</strong></p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={BarChart3}>{t('legal:privacy.measurement.title', "Mesure d'audience et erreurs techniques")}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:privacy.measurement.vercel" defaults="<strong>Vercel Web Analytics et Vercel Speed Insights</strong> (Vercel Inc., société américaine) : pages vues, actions principales et vitesse d'affichage, pour notre seul compte. Nous n'envoyons pas le texte de vos recherches. Base : intérêt légitime ; vous pouvez vous y opposer en nous écrivant." />
                  {!frontendEnv.flags.audienceMeasurement && <>{' '}<Trans i18n={i18n} i18nKey="legal:privacy.measurement.vercelOff" defaults="<strong>Cette mesure n'est pas activée</strong> : aucune donnée n'est envoyée à Vercel Web Analytics ni à Speed Insights." /></>}
                </p>
                <p><Trans i18n={i18n} i18nKey="legal:privacy.measurement.sentry" defaults="<strong>Sentry</strong> (société américaine) : quand une erreur se produit, nous envoyons sa description après avoir retiré votre e-mail, votre adresse IP, les paramètres de l'adresse de la page, les cookies et les en-têtes de connexion. Les traces de performance concernent 10 % des visites. <strong>L'enregistrement des sessions (Session Replay) est désactivé par défaut.</strong>" /></p>
                {frontendEnv.flags.publicBeta ? (
                  <p data-testid="beta-processors"><Trans i18n={i18n} i18nKey="legal:privacy.measurement.betaProcessors" defaults="Pendant la bêta publique, la mesure d'audience et Sentry ne sont <strong>pas activés</strong>. Les seuls prestataires sont : Vercel Inc. (hébergement : fonctions exécutées à Francfort, pages publiques distribuées par son réseau mondial), qui adhère au Data Privacy Framework UE–États-Unis et prévoit des clauses contractuelles types ; Neon, LLC (groupe Databricks, base de données hébergée à Francfort), couvert par le Data Privacy Framework ; Upstash, Inc. (limitation de débit, données à Francfort), sous son accord de traitement des données — ses garanties de transfert restent à confirmer. Un accès depuis les États-Unis ne peut pas être exclu. Si vous choisissez la vue « Carte » de l'annuaire, votre navigateur charge aussi des fonds de carte depuis les serveurs de la fondation OpenStreetMap (Royaume-Uni), qui reçoivent votre adresse IP ; la vue « Liste » n'en charge aucun." /></p>
                ) : (
                  <p><Trans i18n={i18n} i18nKey="legal:privacy.measurement.transfers" defaults="Un accès depuis les États-Unis ne peut pas être exclu. <0>[À COMPLÉTER : garanties de transfert (Data Privacy Framework ou clauses contractuelles types) vérifiées pour chaque prestataire]</0> La vue « Carte » de l'annuaire charge des fonds de carte depuis les serveurs de la fondation OpenStreetMap (Royaume-Uni), qui reçoivent votre adresse IP ; la vue « Liste » n'en charge aucun."
                    components={[<em key="todo" />]} /></p>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={UserCheck}>{t('legal:privacy.rights.title', 'Vos droits')}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p className="text-sm">
                  <Trans i18n={i18n} i18nKey="legal:privacy.rights.contact" defaults="Pour toute question sur vos données, écrivez à : <0/>. Nous n'avons pas désigné de délégué à la protection des données (DPO) à ce jour."
                    components={[contactValue('contact')]} />
                </p>
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <div className="bg-slate-50 p-3 rounded border border-slate-100">
                    <strong className="text-slate-900 block mb-1">{t('legal:privacy.rights.access.title', "Droit d'accès et portabilité")}</strong>
                    <span className="text-sm">{t('legal:privacy.rights.access.text', "Exportez vos données en un clic depuis les paramètres de votre compte. Pour les notes tenues par une structure : demande revue par deux personnes, extrait communiqué, informations sur d'autres personnes masquées.")}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded border border-slate-100">
                    <strong className="text-slate-900 block mb-1">{t('legal:privacy.rights.erasure.title', "Droit à l'effacement")}</strong>
                    <span className="text-sm">{t('legal:privacy.rights.erasure.text', "Demandez la suppression depuis votre compte. La demande est enregistrée tout de suite, puis exécutée après une vérification humaine. Certaines données peuvent être conservées si la loi l'impose.")}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded border border-slate-100 sm:col-span-2">
                    <strong className="text-slate-900 block mb-1">{t('legal:privacy.rights.other.title', 'Rectification, opposition, limitation')}</strong>
                    <span className="text-sm">
                      <Trans i18n={i18n} i18nKey="legal:privacy.rights.other.text" defaults="Pour toute autre demande, écrivez à <0/> ou utilisez notre formulaire. Nous répondons dans un délai d'un mois, prolongeable de deux mois si la demande est complexe (nous vous prévenons alors)."
                        components={[contactValue('contact')]} />
                    </span>
                  </div>
                </div>
                <p className="text-sm">{t('legal:privacy.rights.cnil', "Si vous n'êtes pas satisfait(e) de notre réponse, vous pouvez saisir la CNIL (www.cnil.fr).")}</p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={HelpCircle}>{t('legal:privacy.cookies.title', 'Cookies et stockage local')}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>
                  {t('legal:privacy.cookies.noAds', 'Pas de publicité ni de réseaux sociaux.')}{' '}
                  {frontendEnv.flags.publicBeta
                    ? <Trans i18n={i18n} i18nKey="legal:privacy.cookies.beta" defaults="Pendant la bêta publique, ni mesure d&apos;audience ni journal d&apos;erreurs chez un prestataire : détails et choix sur la page <0>Cookies</0>." components={[cookiesLink]} />
                    : frontendEnv.flags.audienceMeasurement
                      ? <Trans i18n={i18n} i18nKey="legal:privacy.cookies.measured" defaults="Nous utilisons une mesure d'audience et un journal d'erreurs : détails et choix sur la page <0>Cookies</0>." components={[cookiesLink]} />
                      : <Trans i18n={i18n} i18nKey="legal:privacy.cookies.notMeasured" defaults="Pas de mesure d'audience ; un journal d'erreurs technique : détails et choix sur la page <0>Cookies</0>." components={[cookiesLink]} />}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Database}>{t('legal:privacy.retention.title', 'Durées de conservation')}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>{t('legal:privacy.retention.intro', "Ce qui est appliqué automatiquement aujourd'hui (purge hebdomadaire, chaque dimanche à 3 h, heure UTC) :")}</p>
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm text-start border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">{t('legal:privacy.retention.data', 'Données')}</th>
                        <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">{t('legal:privacy.retention.duration', 'Durée appliquée')}</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 divide-y divide-slate-100">
                      {retentionApplied(t).map(([what, how]) => (
                        <tr key={what}><td className="px-4 py-2">{what}</td><td className="px-4 py-2">{how}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p><strong>{t('legal:privacy.retention.notYetLabel', 'Pas encore appliqué automatiquement :')}</strong> {t('legal:privacy.retention.notYet', "suppression des comptes inactifs ; durée des messages et documents du Coffre (conservés jusqu'à leur suppression ou celle du compte) ; dossiers de suivi des structures ; demandes de contact.")}</p>
                <p>{t('legal:privacy.retention.deletion', 'Pour supprimer votre compte : la demande est enregistrée tout de suite, puis exécutée après une vérification humaine.')}</p>
                <p><Trans i18n={i18n} i18nKey="legal:privacy.retention.contact" defaults="Contact protection des données : <0/>." components={[contactValue('contact')]} /></p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={EyeOff}>{t('legal:privacy.never.title', 'Ce que nous ne faisons pas')}</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <ul className="list-none space-y-3 text-sm">
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>{t('legal:privacy.never.sell', 'Vendre vos données ou les utiliser pour de la publicité.')}</span></li>
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>{t('legal:privacy.never.transmit', 'Transmettre vos données à un organisme (France Travail, CAF…) sans votre accord, sauf si la loi nous y oblige — nous vérifions alors chaque demande.')}</span></li>
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>{t('legal:privacy.never.ai', "Envoyer vos questions ou vos dossiers à un fournisseur d'IA extérieur.")}</span></li>
                </ul>

                <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4" data-legal-version={LEGAL_DOCS_VERSION.version} {...fr}>
                  {LEGAL_DOCS_LABEL}
                </p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
