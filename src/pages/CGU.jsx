import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { FileCheck, Users, ShieldCheck, AlertTriangle, Ban, RefreshCw, Mail } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL } from '@/config/legal-documents';
import i18n, { useLanguage, useT } from '@/i18n';

// R32: translated (namespace « legal »); the French text stays the legal reference (the version label of the configuration is shown as written).
export default function CGU() {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title={t('legal:terms.seo.title', "Conditions Générales d'Utilisation")}
        description={t('legal:terms.seo.description', "Conditions générales d'utilisation de la plateforme AccesDirectAide : droits, obligations et règles d'usage du service.")}
        path="/cgu"
      />

      {/* Hero Section */}
      <PageHeader width="reading" title={t('legal:terms.title', 'Conditions générales d’utilisation')} description={t('legal:terms.intro', "Règles d'usage de la plateforme Accès Direct Aide — une plateforme d'information solidaire.")} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LegalTranslationNotice />
        <BetaProcessingNotice />
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6 md:p-10 space-y-12">

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <FileCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.purpose.title', '1. Objet et acceptation')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:terms.purpose.scope" defaults="Les présentes Conditions Générales d'Utilisation (CGU) régissent l'accès et l'utilisation de la plateforme <strong>Accès Direct Aide</strong> (ci-après « le Service »), accessible à l'adresse <0>www.accesdirectaide.fr</0>."
                    components={[<a key="site" href="https://www.accesdirectaide.fr" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">www.accesdirectaide.fr</a>]} />
                </p>
                <p>
                  {t('legal:terms.purpose.acceptance', "L'utilisation du Service implique l'acceptation pleine et entière des présentes CGU. Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser le Service.")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.service.title', '2. Description du Service')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:terms.service.intro', "Accès Direct Aide est un service gratuit d'information qui facilite l'accès aux aides sociales, démarches administratives et structures d'accompagnement. Ce n'est pas un service de l'administration. Le Service propose notamment :")}
                </p>
                <ul className="list-disc ps-5 mt-2 space-y-2">
                  <li><Trans i18n={i18n} i18nKey="legal:terms.service.search" defaults="Un <strong>moteur de recherche</strong> des aides sociales disponibles (nationales, régionales, locales)." /></li>
                  <li><Trans i18n={i18n} i18nKey="legal:terms.service.directory" defaults="Un <strong>annuaire</strong> des structures d'accompagnement social de proximité." /></li>
                  <li><Trans i18n={i18n} i18nKey="legal:terms.service.assistant" defaults="Un <strong>assistant d'orientation</strong> (IA) pour guider les usagers vers les aides pertinentes." /></li>
                  <li><Trans i18n={i18n} i18nKey="legal:terms.service.procedures" defaults="Des <strong>fiches démarches</strong> détaillant les procédures administratives." /></li>
                  <li><Trans i18n={i18n} i18nKey="legal:terms.service.pro" defaults="Un <strong>espace professionnel</strong> pour les travailleurs sociaux (gestion de rendez-vous, dossiers)." /></li>
                </ul>
                <p className="mt-3">
                  <Trans i18n={i18n} i18nKey="legal:terms.service.free" defaults="Le Service est <strong>gratuit</strong>, <strong>sans publicité</strong> et <strong>sans revente de données</strong>." />
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.obligations.title', "3. Obligations de l'utilisateur")}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>{t('legal:terms.obligations.intro', "En utilisant le Service, l'utilisateur s'engage à :")}</p>
                <ul className="list-disc ps-5 mt-2 space-y-2">
                  <li>{t('legal:terms.obligations.accurate', "Fournir des informations exactes lors de la création d'un compte (espace usager ou professionnel).")}</li>
                  <li>{t('legal:terms.obligations.access', "Ne pas tenter d'accéder de manière non autorisée aux systèmes ou données du Service.")}</li>
                  <li>{t('legal:terms.obligations.purposes', 'Ne pas utiliser le Service à des fins commerciales, frauduleuses ou illicites.')}</li>
                  <li>{t('legal:terms.obligations.sensitive', "Ne pas transmettre de données sensibles (numéro de sécurité sociale, données bancaires) à l'assistant IA.")}</li>
                  <li>{t('legal:terms.obligations.ip', 'Respecter les droits de propriété intellectuelle du Service.')}</li>
                </ul>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.liability.title', '4. Limitation de responsabilité')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:terms.liability.indicative" defaults="Les informations présentées sur la plateforme (montants d'aides, critères d'éligibilité, délais) sont fournies à <strong>titre indicatif</strong> et proviennent de sources publiques officielles (Open Data gouvernemental, collectivités territoriales)." />
                </p>
                <p>
                  {t('legal:terms.liability.decisions', 'Le Service ne se substitue en aucun cas aux décisions officielles de la CAF, MSA, CPAM, France Travail, des Conseils Départementaux ou de tout autre organisme public. En cas de divergence, seules les décisions de ces organismes font foi.')}
                </p>
                <p>
                  {t('legal:terms.liability.assistant', "Les réponses de l'assistant d'orientation sont générées automatiquement et peuvent contenir des inexactitudes. Elles constituent une aide à l'orientation, non un avis juridique ou administratif.")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-red-50 rounded-lg">
                  <Ban className="w-5 h-5 text-red-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.ip.title', '5. Propriété intellectuelle')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:terms.ip.owner', "Le code source, l'identité visuelle, les textes originaux et la structure de la plateforme appartiennent à l'éditeur du service.")}
                </p>
                <p>
                  {t('legal:terms.ip.data', "Les données relatives aux aides sociales sont issues de données publiques ouvertes et restent soumises à la licence de chaque source (le plus souvent la Licence Ouverte / Open Licence 2.0 d'Etalab, indiquée par la source).")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.changes.title', '6. Modification des CGU')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:terms.changes.text', "L'éditeur se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront informés de toute modification substantielle. La poursuite de l'utilisation du Service après modification vaut acceptation des nouvelles conditions.")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:terms.contact.title', '7. Contact')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:terms.contact.intro', 'Pour toute question relative aux présentes CGU, vous pouvez nous contacter :')}
                </p>
                <p className="mt-2">
                  <a href="/contact" className="text-blue-600 font-medium hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                    {t('legal:terms.contact.form', 'Via notre formulaire de contact')}
                  </a>
                </p>
                <p>
                  {t('legal:terms.contact.email', 'Ou par email :')} <code>contact@accesdirectaide.fr</code>
                </p>
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
