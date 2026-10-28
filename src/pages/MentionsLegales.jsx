import SEO from '@/components/SEO';
import { Scale, Building2, Server, FileText, AlertTriangle, ExternalLink, Mail } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL, LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import brand from '@/lib/brand-config';

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/01_MENTIONS_LEGALES.md — status: LEGAL_DOCS_VERSION.status.
// The "[À COMPLÉTER : …]" placeholders are intentional and must be filled by the owner before any public launch.
export default function MentionsLegales() {
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title="Mentions légales"
        description="Informations légales : éditeur, hébergement, responsabilités et contact du site AccesDirectAide."
        path="/mentions-legales"
      />

      {/* Hero Section */}
      <div className="bg-slate-900 text-white pt-16 pb-24 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400 mb-6 ring-1 ring-blue-500/30">
            <Scale className="w-8 h-8" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight text-slate-50">Mentions légales</h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Qui édite AccesDirectAide, qui l&apos;héberge, d&apos;où viennent les informations.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-10 relative z-10">
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6 md:p-10 space-y-12">

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">1. Éditeur du site</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p><strong>Nom du service :</strong> AccesDirectAide (accesdirectaide.fr)</p>
                <p><strong>Nature du service :</strong> Service gratuit d&apos;information sur les droits sociaux et d&apos;aide à l&apos;orientation. Ce n&apos;est pas un site de l&apos;administration. Il n&apos;est pas édité par l&apos;État, une collectivité, la CAF ou un autre organisme payeur.</p>
                <p><strong>Éditeur :</strong> <em>{LEGAL_PLACEHOLDERS.publisherIdentity}</em></p>
                {/* Owner decision 2026-10-23: the project status, which is NOT the publisher identification (no association is registered yet) */}
                <p data-testid="legal-project-status"><strong>État du projet :</strong> {brand.legal.projectStatement} Aucune association n&apos;est encore inscrite au registre des associations du tribunal judiciaire de Strasbourg : l&apos;identification complète de l&apos;éditeur sera publiée après l&apos;inscription.</p>
                <p><strong>Adresse électronique :</strong> contact@accesdirectaide.fr</p>
                <p><strong>Directeur ou directrice de la publication :</strong> <em>{LEGAL_PLACEHOLDERS.publicationDirector}</em></p>
                <p><strong>Territoire :</strong> Centré sur Strasbourg et le Bas-Rhin.</p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Server className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">2. Hébergement et stockage des données</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Voici l&apos;hébergeur et les prestataires qui stockent des données pour le service. Certains sont seulement prévus pour la mise en ligne.
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-2">
                  <li><strong>Hébergement de l&apos;application (site et fonctions serveur) :</strong> Vercel Inc. — région d&apos;exécution choisie : Francfort (<code>fra1</code>) — <em>{LEGAL_PLACEHOLDERS.hostAddress}</em> — prévu pour la production.</li>
                  <li><strong>Base de données :</strong> <em>[À COMPLÉTER : prestataire retenu, adresse et téléphone]</em> — prévu.</li>
                  <li><strong>Stockage des fichiers (Coffre, pièces jointes) :</strong> <em>[À COMPLÉTER : prestataire retenu, adresse et téléphone]</em> — prévu.</li>
                  <li><strong>Limitation de débit (sécurité) :</strong> <em>[À COMPLÉTER : prestataire retenu, adresse et téléphone]</em> — prévu.</li>
                  <li><strong>Journal des erreurs techniques :</strong> Sentry — <em>[À COMPLÉTER : entité contractante, adresse et téléphone]</em> — actif si configuré.</li>
                </ul>
                <p className="text-sm text-slate-600">
                  Vercel Inc. et l&apos;éditeur de Sentry sont des sociétés américaines. Le lieu de stockage et les garanties de transfert sont décrits dans la{' '}
                  <a href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">3. Contenus, sources et propriété intellectuelle</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Les textes originaux, la mise en forme et l&apos;identité visuelle d&apos;AccesDirectAide appartiennent à <em>{LEGAL_PLACEHOLDERS.rightsHolder}</em>, sauf mention contraire.
                </p>
                <p>
                  Les informations sur les aides proviennent de sources publiques (par exemple les fiches de Service-Public.gouv.fr / DILA, réutilisées sous Licence Ouverte 2.0) et de contenus rédigés par l&apos;équipe. Chaque réutilisation indique sa source, sa date de mise à jour et un lien. Cette réutilisation ne signifie aucune caution de l&apos;administration.
                </p>
                <p>
                  Les textes simplifiés (FALC — Facile à lire et à comprendre) peuvent être rédigés automatiquement, par un modèle exécuté par AccesDirectAide, à partir de la source officielle. Ils ne sont publiés qu&apos;après un contrôle automatique de leur cohérence avec cette source ; la fiche indique quand un texte a aussi été relu par une personne. Chacun renvoie à sa source officielle.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">4. Responsabilité et limites</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Les informations sur les aides, montants, conditions et délais sont données à titre indicatif. Elles peuvent changer. Une simulation ou une orientation sur AccesDirectAide <strong>n&apos;est pas une décision</strong> : seul l&apos;organisme compétent (CAF, MSA, CPAM, France Travail, Collectivité européenne d&apos;Alsace, CCAS, etc.) décide de l&apos;attribution d&apos;une aide.
                </p>
                <p>
                  L&apos;assistant automatique ne donne pas de conseil juridique. L&apos;éditeur corrige les erreurs signalées dans les meilleurs délais et reste responsable de ses fautes dans les conditions prévues par la loi. La sécurité des données est décrite dans la{' '}
                  <a href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">5. Nous contacter</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Pour une question d&apos;ordre légal, un droit d&apos;auteur, signaler un contenu illicite ou une erreur, ou nos conditions d&apos;utilisation : contact@accesdirectaide.fr ou le formulaire de contact.
                </p>
                <p>
                  Pour signaler une faille de sécurité : <em>{LEGAL_PLACEHOLDERS.securityContact}</em>.
                </p>
                <p>
                  Pour vos données personnelles : <em>{LEGAL_PLACEHOLDERS.dataProtectionContact}</em>.
                </p>
                <p className="mt-4">
                  <a href="/contact" className="text-blue-600 font-medium hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                    Remplir notre formulaire de contact <ExternalLink className="w-4 h-4" />
                  </a>
                </p>
                <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4" data-legal-version={LEGAL_DOCS_VERSION.version}>
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
