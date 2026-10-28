// @ts-nocheck
import SEO from '@/components/SEO';
import { Database, Search, Sparkles, BookOpenCheck, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SourcesMethode() {
  const sources = [
    {
      id: 'aides-territoires',
      name: 'Aides-Territoires (Beta.gouv.fr)',
      url: 'https://aides-territoires.beta.gouv.fr',
      notes: 'Base de données nationale et locale des aides publiques',
      trust_level: 'officiel'
    },
    {
      id: 'annuaire',
      name: "Annuaire de l'administration (Service-Public)",
      url: 'https://lannuaire.service-public.gouv.fr',
      notes: "Adresses, horaires et contacts des services publics (lieux d'accueil)",
      trust_level: 'officiel'
    },
    {
      id: 'sirene',
      name: 'Annuaire des entreprises (répertoire SIRENE)',
      url: 'https://annuaire-entreprises.data.gouv.fr',
      notes: "Existence, adresse et activité des associations et organismes (établissement ouvert ou fermé)",
      trust_level: 'officiel'
    },
    {
      id: 'service-public',
      name: 'Service-Public.fr',
      url: 'https://www.service-public.fr',
      notes: 'Informations administratives et droits',
      trust_level: 'officiel'
    },
    {
      id: 'data-gouv',
      name: 'Data.gouv.fr',
      url: 'https://www.data.gouv.fr',
      notes: 'Plateforme ouverte des données publiques',
      trust_level: 'officiel'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title="Sources et Méthode FALC"
        description="Comment nous trouvons et simplifions l'information sur les aides avec l'Open Data et l'IA (FALC)."
        path="/sourcesmethode"
      />

      {/* Hero Section */}
      <div className="bg-slate-900 text-white pt-16 pb-24 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-teal-500/20 text-teal-400 mb-6 ring-1 ring-teal-500/30">
            <BookOpenCheck className="w-8 h-8" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight text-slate-50">Sources & Méthodologie</h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            La transparence est la base de la confiance. Découvrez l'exigence avec laquelle nous récoltons et vulgarisons l'information.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-10 relative z-10 space-y-8">

        {/* Le travail de l'IA démystifié */}
        <Card className="border-teal-200 bg-teal-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-teal-100 text-teal-700 rounded-full mt-1">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-teal-900 mb-3">
                  Le rôle de l'IA ? Aider à simplifier, jamais décider.
                </h2>
                {/* PKG-11 audit pass 2: no « closed and audited LLM » exists; FALC texts are drafts (a model run on our own machines, or an automatic summary) reviewed by a person */}
                <div className="space-y-3 text-teal-900/80 leading-relaxed text-sm">
                  <p>
                    Les textes en <strong>FALC (Facile À Lire et à Comprendre)</strong> sont d&apos;abord des brouillons, préparés par un modèle d&apos;IA installé sur nos propres machines ou par un résumé automatique.
                  </p>
                  <p>
                    Chaque texte est contrôlé automatiquement contre la source officielle avant sa publication (aucun nombre inventé, aucune condition contredite) et la fiche indique qu&apos;il a été contrôlé automatiquement ; un texte n&apos;est présenté comme relu par une personne que si une personne l&apos;a réellement relu.
                  </p>
                  <div className="bg-white/60 p-3 rounded-lg border border-teal-200 font-medium">
                    L&apos;IA ne fixe ni conditions ni montants : ils viennent uniquement des sources officielles citées sur chaque fiche.
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
                  <Database className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Origine Gouvernementale</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Une vérification automatique relit chaque fiche sur sa source officielle (données publiques ouvertes de l'État) : une fiche n'est publiée que si sa source la confirme, et elle est retirée ou mise en attente quand la source change ou disparaît.
                </p>
                <div className="grid gap-3 mt-4">
                  {sources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <div>
                        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                          {source.name}
                          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 hidden sm:inline-flex">
                            {source.trust_level === 'officiel' ? 'Fiabilité État' : 'Vérifié'}
                          </Badge>
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{source.notes}</p>
                      </div>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-700 transition"
                        title={`Visiter ${source.url}`}
                        aria-label={`Visiter le site de ${source.name} (nouvel onglet)`}
                        data-testid="source-link"
                      >
                        <ExternalLink className="w-5 h-5" aria-hidden="true" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Notre charte qualité des données</h2>
              </div>
              <div className="space-y-4 px-2">
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-slate-900">Mises à jour régulières</h4>
                    <p className="text-sm text-slate-600">Notre connecteur se synchronise aux bases gouvernementales pour assurer la fraîcheur des dispositifs. Les fiches obsolètes sont passées en "Archivé".</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-slate-900">Traçabilité complète</h4>
                    <p className="text-sm text-slate-600">Chaque fiche vérifiée indique sa source officielle et la date de la dernière vérification, avec un lien « Consulter la source » vers le site officiel.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Ce que nous refusons */}
            <div className="p-6 bg-red-50/50 border border-red-100 rounded-xl space-y-4">
              <h2 className="text-lg font-bold text-red-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                Lignes rouges absolues
              </h2>
              <ul className="space-y-2 text-sm text-red-800">
                <li className="flex items-center gap-2"><span className="font-bold">❌</span> Scraper des blogs ou forums non-sourcés</li>
                <li className="flex items-center gap-2"><span className="font-bold">❌</span> Affirmer l'éligibilité formelle d'un usager (seuls les simulateurs officiels comme mes-droits-sociaux.gouv.fr font foi)</li>
                <li className="flex items-center gap-2"><span className="font-bold">❌</span> Proposer des numéros payants "surtaxés" pour joindre les administrations</li>
              </ul>
            </div>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <RefreshCw className="w-5 h-5 text-slate-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Boucle d'amélioration humaine</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  Les institutions et les citoyens peuvent à tout moment corriger une aide qui comporterait une coquille via le bouton de <strong>Signalement</strong>. L&apos;équipe lit chaque signalement et corrige la fiche si nécessaire ; aucun délai n&apos;est garanti pour l&apos;instant.
                </p>
                <a href="/contact?sujet=signalement_erreur" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium hover:underline mt-2">
                  Signaler une erreur sur la base de données
                </a>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}