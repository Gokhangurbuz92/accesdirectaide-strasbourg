import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { Building2, Server, FileText, AlertTriangle, ExternalLink, Mail } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL, LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import brand from '@/lib/brand-config';
import { frontendEnv } from "@/config/env";
import { currentPublisherConfig, HOST } from '@/config/legal-publisher';
import { LEGAL_NOTICE_VARIANT_DOCUMENT, currentDraftContext, draftVisibility } from '@/config/legal-drafts';
import LegalDraftBanner from '@/components/legal/LegalDraftBanner';
import i18n, { useLanguage, useT } from '@/i18n';

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/01_MENTIONS_LEGALES.md — status: LEGAL_DOCS_VERSION.status.
// The "[À COMPLÉTER : …]" placeholders are intentional and must be filled by the owner before any public launch.
// R32: translated (namespace « legal »); the French text stays the legal reference. Values of the configuration (publisher identity, host address,
// project status, version label) are shown as written and marked as French when the interface is in another language.
export default function MentionsLegales() {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const intro = t('legal:mentions.intro', "Qui édite AccesDirectAide, qui l'héberge, d'où viennent les informations.");
  const dbLabel = t('legal:mentions.host.dbLabel', 'Base de données :');
  const filesLabel = t('legal:mentions.host.filesLabel', 'Stockage des fichiers (Coffre, pièces jointes) :');
  const rateLabel = t('legal:mentions.host.rateLabel', 'Limitation de débit (sécurité) :');
  const errorsLabel = t('legal:mentions.host.errorsLabel', 'Journal des erreurs techniques :');
  const toComplete = t('legal:mentions.host.toComplete', '[À COMPLÉTER : prestataire retenu, adresse et téléphone]');
  const planned = t('legal:mentions.host.planned', 'prévu.');
  // R45 (ENG-LR-4): A-I / A-II variant of the publisher block. UNSET (Production today) = the block below, unchanged. The variant text is a draft:
  // it renders only when approved (VITE_LEGAL_DOCS_APPROVED_VERSION) or in LAB preview, otherwise the page keeps the current block (fail-closed).
  const publisher = currentPublisherConfig();
  const variantState = draftVisibility(LEGAL_NOTICE_VARIANT_DOCUMENT, currentDraftContext());
  const mode = variantState === 'HIDDEN' ? 'UNSET' : publisher.mode;
  const privacyLink = <a key="privacy" href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>;
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title={t('legal:mentions.title', 'Mentions légales')}
        description={t('legal:mentions.seo.description', 'Informations légales : éditeur, hébergement, responsabilités et contact du site AccesDirectAide.')}
        path="/mentions-legales"
      />

      {/* Hero Section — French keeps its written heading (read by e2e/legal-pages.spec.js and the source guard); the other languages show its translation */}
      {isSource
        ? <PageHeader width="reading" title={<>Mentions légales</>} description={intro} />
        : <PageHeader width="reading" title={t('legal:mentions.title', 'Mentions légales')} description={intro} />}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LegalTranslationNotice />
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6 md:p-10 space-y-12">

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:mentions.publisher.title', '1. Éditeur du site')}</h2>
              </div>
              {mode === 'UNSET' ? (
                <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                  <p><strong>{t('legal:mentions.publisher.serviceLabel', 'Nom du service :')}</strong> AccesDirectAide (accesdirectaide.fr)</p>
                  <p><strong>{t('legal:mentions.publisher.natureLabel', 'Nature du service :')}</strong> {t('legal:mentions.publisher.nature', "Service gratuit d'information sur les droits sociaux et d'aide à l'orientation. Ce n'est pas un site de l'administration. Il n'est pas édité par l'État, une collectivité, la CAF ou un autre organisme payeur.")}</p>
                  <p><strong>{t('legal:mentions.publisher.publisherLabel', 'Éditeur :')}</strong> <em {...fr}>{LEGAL_PLACEHOLDERS.publisherIdentity}</em></p>
                  {/* R42-A01 (04/11/2026): the project status, which is NOT the publisher identification — no association has been created; the publisher is the natural-person project carrier */}
                  <p data-testid="legal-project-status"><strong>{t('legal:mentions.publisher.statusLabel', 'État du projet :')}</strong> <span {...fr}>{brand.legal.projectStatement}</span> {t('legal:mentions.publisher.statusNote', "Aucune association n'a été créée à ce jour : le site est édité par une personne physique, porteuse du projet AccesDirectAide. L'association envisagée n'existe pas encore ; si elle est créée puis inscrite au registre des associations du tribunal judiciaire de Strasbourg, ces mentions seront mises à jour.")}</p>
                  <p><strong>{t('legal:mentions.publisher.emailLabel', 'Adresse électronique :')}</strong> contact@accesdirectaide.fr</p>
                  <p><strong>{t('legal:mentions.publisher.directorLabel', 'Directeur ou directrice de la publication :')}</strong> <em {...fr}>{LEGAL_PLACEHOLDERS.publicationDirector}</em></p>
                  <p><strong>{t('legal:mentions.publisher.territoryLabel', 'Territoire :')}</strong> {t('legal:mentions.publisher.territory', 'Centré sur Strasbourg et le Bas-Rhin.')}</p>
                </div>
              ) : (
                <div className="space-y-3 text-slate-700 leading-relaxed px-2" data-testid="legal-publisher-variant" data-publisher-mode={mode}>
                  {variantState === 'PREVIEW' && <LegalDraftBanner version={`${LEGAL_NOTICE_VARIANT_DOCUMENT.id}@${LEGAL_NOTICE_VARIANT_DOCUMENT.version}`} />}
                  <p><strong>{t('legal:mentions.publisher.serviceLabel', 'Nom du service :')}</strong> AccesDirectAide (accesdirectaide.fr)</p>
                  <p><strong>{t('legal:mentions.publisher.natureLabel', 'Nature du service :')}</strong> {t('legal:mentions.publisher.nature', "Service gratuit d'information sur les droits sociaux et d'aide à l'orientation. Ce n'est pas un site de l'administration. Il n'est pas édité par l'État, une collectivité, la CAF ou un autre organisme payeur.")}</p>
                  {mode === 'A_II' ? (
                    <>
                      <p><strong>{t('legal:mentions.publisher.publisherLabel', 'Éditeur :')}</strong> {t('legal:mentions.a2.publisher', "AccesDirectAide est édité à titre non professionnel, gratuitement et sans but lucratif, par une personne physique. Aucune association n'a été créée à ce jour.")}</p>
                      <p data-testid="legal-a2-anonymity">{t('legal:mentions.a2.anonymity', "Conformément à l'article 1-1, II de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique, l'éditeur a choisi de ne pas rendre publics ses éléments d'identification personnelle. Il les a communiqués à l'hébergeur indiqué ci-dessous, qui est tenu au secret professionnel, sauf à l'égard de l'autorité judiciaire.")}</p>
                      <p data-testid="legal-publication-contact"><strong>{t('legal:mentions.a2.contactLabel', 'Contact de la publication :')}</strong> {publisher.publicationContact
                        ? <span {...fr}>{publisher.publicationContact}</span>
                        : <em>{t('legal:mentions.a2.contactPending', 'en cours de désignation')}</em>}</p>
                    </>
                  ) : (
                    <>
                      <p><strong>{t('legal:mentions.publisher.publisherLabel', 'Éditeur :')}</strong> {t('legal:mentions.a1.publisher', "AccesDirectAide est édité par une personne physique, à titre personnel, gratuitement et sans but lucratif. Aucune association n'a été créée à ce jour.")}</p>
                      <p><strong>{t('legal:mentions.a1.nameLabel', 'Nom et prénoms :')}</strong> <span {...fr}>{LEGAL_PLACEHOLDERS.publisherIdentity}</span></p>
                      <p data-testid="legal-a1-domicile"><strong>{t('legal:mentions.a1.domicileLabel', 'Domicile :')}</strong> <span {...fr}>{publisher.identification ? publisher.identification.domicile : t('legal:mentions.a1.missing', '[À COMPLÉTER : variable de build manquante]')}</span></p>
                      <p><strong>{t('legal:mentions.a1.phoneLabel', 'Téléphone :')}</strong> <span {...fr}>{publisher.identification ? publisher.identification.phone : t('legal:mentions.a1.missing', '[À COMPLÉTER : variable de build manquante]')}</span></p>
                      <p><strong>{t('legal:mentions.publisher.emailLabel', 'Adresse électronique :')}</strong> contact@accesdirectaide.fr</p>
                      <p><strong>{t('legal:mentions.publisher.directorLabel', 'Directeur ou directrice de la publication :')}</strong> <em {...fr}>{LEGAL_PLACEHOLDERS.publicationDirector}</em> — {t('legal:mentions.a1.directorNote', "lorsque le service est fourni par une personne physique, le directeur de la publication est cette personne (loi n° 82-652 du 29 juillet 1982, art. 93-2).")}</p>
                    </>
                  )}
                  <p data-testid="legal-host-lcen"><strong>{t('legal:mentions.hostBlock.label', 'Hébergeur :')}</strong> <span {...fr}>{HOST.name}, {HOST.address}</span> — {t('legal:mentions.hostBlock.phoneLabel', 'téléphone :')} <span {...fr}>{publisher.host.phone}</span></p>
                  <p className="text-sm text-slate-600">{t('legal:mentions.hostBlock.source', 'Nom et adresse publiés par Vercel (vercel.com/legal/privacy-policy, page lue le 5 novembre 2026).')}</p>
                  <h3 className="pt-2 text-lg font-semibold text-slate-900">{t('legal:mentions.reply.title', 'Droit de réponse')}</h3>
                  <p data-testid="legal-right-of-reply">{t('legal:mentions.reply.text', "Toute personne nommée ou désignée sur le site peut demander l'insertion d'une réponse, dans les trois mois qui suivent la mise à la disposition du public du contenu en cause. Indiquez le contenu visé, son adresse web et le texte de la réponse demandée.")}</p>
                  <p>{mode === 'A_II'
                    ? t('legal:mentions.reply.a2', "Envoyez la demande à l'adresse de contact de la publication ci-dessus, ou à l'hébergeur : l'éditeur ayant gardé l'anonymat, l'hébergeur transmet sans délai la demande au directeur de la publication.")
                    : t('legal:mentions.reply.a1', "Envoyez la demande au directeur de la publication, à l'adresse électronique ci-dessus.")}</p>
                  <p>{t('legal:mentions.reply.delay', 'La réponse est insérée dans les trois jours qui suivent la réception de la demande (loi n° 2004-575 du 21 juin 2004, art. 1-1, III).')}</p>
                  <p><strong>{t('legal:mentions.publisher.territoryLabel', 'Territoire :')}</strong> {t('legal:mentions.publisher.territory', 'Centré sur Strasbourg et le Bas-Rhin.')}</p>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Server className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:mentions.host.title', '2. Hébergement et stockage des données')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:mentions.host.intro', "Voici l'hébergeur et les prestataires qui stockent des données pour le service. Certains sont seulement prévus pour la mise en ligne.")}
                </p>
                <ul className="list-disc ps-5 mt-2 space-y-2">
                  <li>
                    <strong>{t('legal:mentions.host.appLabel', "Hébergement de l'application (site et fonctions serveur) :")}</strong> Vercel Inc. — <Trans i18n={i18n} i18nKey="legal:mentions.host.region" defaults="région d'exécution choisie : Francfort (<0>fra1</0>)" components={[<code key="region" />]} /> — <em {...fr}>{LEGAL_PLACEHOLDERS.hostAddress}</em> — {frontendEnv.flags.publicBeta
                      ? t('legal:mentions.host.appBeta', "en service pour la bêta publique. Les fonctions serveur s'exécutent à Francfort ; les pages et fichiers publics sont distribués par le réseau mondial de Vercel, au plus près du visiteur.")
                      : t('legal:mentions.host.appPlanned', 'prévu pour la production.')}
                  </li>
                  {frontendEnv.flags.publicBeta ? (
                    <>
                      <li data-testid="beta-host-db"><strong>{dbLabel}</strong> {t('legal:mentions.host.dbBeta', "Neon, LLC (groupe Databricks ; Databricks, Inc., 160 Spear Street, Suite 1300, San Francisco, CA 94105, États-Unis) — base hébergée à Francfort (Union européenne), souscrite par l'intermédiaire de Vercel.")}</li>
                      <li><strong>{filesLabel}</strong> {t('legal:mentions.host.filesBeta', 'non utilisé pendant la bêta publique (aucun document ne peut être envoyé).')}</li>
                      <li><strong>{rateLabel}</strong> {t('legal:mentions.host.rateBeta', "Upstash, Inc. — données hébergées à Francfort (Union européenne), souscrit par l'intermédiaire de Vercel ; coordonnées : https://upstash.com.")}</li>
                      <li><strong>{errorsLabel}</strong> {t('legal:mentions.host.errorsBeta', "Sentry n'est pas activé pendant la bêta publique.")}</li>
                      <li><strong>{t('legal:mentions.host.mailLabel', 'Messagerie de contact :')}</strong> {t('legal:mentions.host.mailBeta', "Microsoft (Outlook), pour l'adresse de contact publiée ci-dessus : les messages reçus servent seulement à répondre.")}</li>
                    </>
                  ) : (
                    <>
                      <li><strong>{dbLabel}</strong> <em>{toComplete}</em> — {planned}</li>
                      <li><strong>{filesLabel}</strong> <em>{toComplete}</em> — {planned}</li>
                      <li><strong>{rateLabel}</strong> <em>{toComplete}</em> — {planned}</li>
                      <li><strong>{errorsLabel}</strong> Sentry — <em>{t('legal:mentions.host.errorsToComplete', '[À COMPLÉTER : entité contractante, adresse et téléphone]')}</em> — {t('legal:mentions.host.errorsPlanned', 'actif si configuré.')}</li>
                    </>
                  )}
                </ul>
                <p className="text-sm text-slate-600">
                  <Trans i18n={i18n} i18nKey="legal:mentions.host.transfers" defaults="Vercel Inc. et l'éditeur de Sentry sont des sociétés américaines. Le lieu de stockage et les garanties de transfert sont décrits dans la <0>politique de confidentialité</0>."
                    components={[privacyLink]} />
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:mentions.content.title', '3. Contenus, sources et propriété intellectuelle')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:mentions.content.rights" defaults="Les textes originaux, la mise en forme et l'identité visuelle d'AccesDirectAide appartiennent à <0/>, sauf mention contraire."
                    components={[<em key="holder" {...fr}>{LEGAL_PLACEHOLDERS.rightsHolder}</em>]} />
                </p>
                <p>
                  {t('legal:mentions.content.sources', "Les informations sur les aides proviennent de sources publiques (par exemple les fiches de Service-Public.gouv.fr / DILA, réutilisées sous Licence Ouverte 2.0) et de contenus rédigés par l'équipe. Chaque réutilisation indique sa source, sa date de mise à jour et un lien. Cette réutilisation ne signifie aucune caution de l'administration.")}
                </p>
                <p>
                  {t('legal:mentions.content.falc', "Les textes simplifiés (FALC — Facile à lire et à comprendre) peuvent être rédigés automatiquement, par un modèle exécuté par AccesDirectAide, à partir de la source officielle. Ils ne sont publiés qu'après un contrôle automatique de leur cohérence avec cette source ; la fiche indique quand un texte a aussi été relu par une personne. Chacun renvoie à sa source officielle.")}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:mentions.liability.title', '4. Responsabilité et limites')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="legal:mentions.liability.indicative" defaults="Les informations sur les aides, montants, conditions et délais sont données à titre indicatif. Elles peuvent changer. Une simulation ou une orientation sur AccesDirectAide <strong>n'est pas une décision</strong> : seul l'organisme compétent (CAF, MSA, CPAM, France Travail, Collectivité européenne d'Alsace, CCAS, etc.) décide de l'attribution d'une aide." />
                </p>
                <p>
                  <Trans i18n={i18n} i18nKey="legal:mentions.liability.assistant" defaults="L'assistant automatique ne donne pas de conseil juridique. L'éditeur corrige les erreurs signalées dans les meilleurs délais et reste responsable de ses fautes dans les conditions prévues par la loi. La sécurité des données est décrite dans la <0>politique de confidentialité</0>."
                    components={[privacyLink]} />
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">{t('legal:mentions.contact.title', '5. Nous contacter')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('legal:mentions.contact.legal', "Pour une question d'ordre légal, un droit d'auteur, signaler un contenu illicite ou une erreur, ou nos conditions d'utilisation : contact@accesdirectaide.fr ou le formulaire de contact.")}
                </p>
                <p>
                  <Trans i18n={i18n} i18nKey="legal:mentions.contact.security" defaults="Pour signaler une faille de sécurité : <0/>."
                    components={[<em key="security" {...fr}>{LEGAL_PLACEHOLDERS.securityContact}</em>]} />
                </p>
                <p>
                  <Trans i18n={i18n} i18nKey="legal:mentions.contact.data" defaults="Pour vos données personnelles : <0/>."
                    components={[<em key="data" {...fr}>{LEGAL_PLACEHOLDERS.dataProtectionContact}</em>]} />
                </p>
                <p className="mt-4">
                  <a href="/contact" className="text-blue-600 font-medium hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                    {t('legal:mentions.contact.form', 'Remplir notre formulaire de contact')} <ExternalLink className="w-4 h-4 rtl-flip" />
                  </a>
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
