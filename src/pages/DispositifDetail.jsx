// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';

import { Link, useParams, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import NotFound from "./NotFound";
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { generateBreadcrumbSchema, generateDispositifSchema } from '@/utils/schema';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Banknote,
  Flag
} from 'lucide-react';
import SourceTraceability from '@/components/SourceTraceability';
import FalcSummary from '@/components/FalcSummary';
import AutoVerificationNote from '@/components/AutoVerificationNote';
import LoadError from '@/components/LoadError';

export default function DispositifDetail() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const identifier = slug || id;

  const fetchDispositif = async () => {
    let url = `/api/dispositifs?`;
    if (slug) url += `slug=${slug}`;
    else if (id) url += `id=${id}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch');
    }
    return res.json();
  };

  const { data: dispositif, isLoading, isError, refetch } = useQuery({
    queryKey: ['dispositif', identifier],
    queryFn: fetchDispositif,
    enabled: !!identifier
  });

  if (isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (isError) {
    return <div className="max-w-4xl mx-auto px-4 py-8"><LoadError what="ce dispositif" onRetry={() => refetch()} testId="dispositif-error" headingLevel={1} /></div>;
  }

  if (!dispositif) {
    return <NotFound />;
  }

  const breadcrumbs = [
    { name: 'Accueil', url: '/' },
    { name: 'Dispositifs', url: '/dispositifs' },
    { name: dispositif.titre, url: `/dispositifs/${dispositif.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateDispositifSchema(dispositif)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={dispositif.titre}
        description={dispositif.description_falc}
        path={`/dispositifs/${dispositif.slug}`}
        schema={schema}
      />

      {/* Breadcrumbs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">Accueil</Link>
            <ChevronRight className="h-4 w-4" />
            <Link to="/dispositifs" className="hover:text-blue-600">Dispositifs</Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-slate-900 truncate max-w-[200px]">{dispositif.titre}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to="/dispositifs"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux dispositifs
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {dispositif.departement && (
              <Badge variant="outline" className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {dispositif.departement === '67' ? 'Bas-Rhin (67)' :
                  dispositif.departement === '68' ? 'Haut-Rhin (68)' : dispositif.departement}
              </Badge>
            )}
            {dispositif.public && dispositif.public.map((/** @type {any} */ p, /** @type {any} */ i) => (
              <Badge key={i} className="bg-blue-100 text-blue-800">
                {p}
              </Badge>
            ))}
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
            {dispositif.titre}
          </h1>

          {dispositif.montant && (
            <div className="flex items-center gap-2 text-green-700 font-medium bg-green-50 px-4 py-2 rounded-lg inline-flex mb-4">
              <Banknote className="h-5 w-5" />
              <span>{dispositif.montant}</span>
            </div>
          )}

          {/* Metadata / Source Info */}
          <div className="text-xs text-slate-600 mt-4 border-t pt-4">
            Source : {dispositif.source_url_exact ? 'Officielle' : 'Interne'} • Mis à jour le {new Date(dispositif.updatedAt).toLocaleDateString('fr-FR')}
          </div>
          {/* PKG-12: checked by the automatic verification chain like the aides (when, against which source, how the texts were written) */}
          <div className="mt-4"><AutoVerificationNote record={dispositif} kind="dispositif" /></div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* FALC Summary */}
            {dispositif?.summary_falc ? <FalcSummary text={dispositif.summary_falc} /> : null}

            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-3">Description</h2>
                <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap" data-testid="dispositif-description">
                  {dispositif.description_falc || "Aucune description disponible."}
                </div>
              </CardContent>
            </Card>

            {/* Liens */}
            {dispositif.liens && Array.isArray(dispositif.liens) && dispositif.liens.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">Liens utiles</h2>
                  <ul className="space-y-3">
                    {dispositif.liens.map((/** @type {{ url: any; nom: any; }} */ link, /** @type {any} */ idx) => (
                      <li key={idx}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-blue-600 hover:underline font-medium"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {link.nom || "Voir le lien"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* PKG-11 / P09: the related aides and structures, only those that are public themselves (decided by the server) */}
            {dispositif.related?.aides?.length > 0 && (
              <Card data-testid="dispositif-related-aides">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">Aides liées</h2>
                  <ul className="space-y-2">
                    {dispositif.related.aides.map((a) => (
                      <li key={a.slug}><Link to={`/aides/${a.slug}`} className="inline-flex min-h-11 items-center text-blue-800 underline">{a.titre}</Link></li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {dispositif.related?.structures?.length > 0 && (
              <Card data-testid="dispositif-related-structures">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">Structures qui accompagnent</h2>
                  <ul className="space-y-2">
                    {dispositif.related.structures.map((st) => (
                      <li key={st.slug}><Link to={`/structures/${st.slug}`} className="inline-flex min-h-11 items-center text-blue-800 underline">{st.nom}{st.ville ? ` — ${st.ville}` : ''}</Link></li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Source Traceability */}
            <SourceTraceability
              source_url={dispositif.source_url || dispositif.source_url_exact}
              retrieved_at={dispositif.retrieved_at}
              last_checked_at={dispositif.last_checked_at}
              source_last_modified={dispositif.source_last_modified}
            />

            <Card>
              <CardContent className="p-6 space-y-3">
                <Link to={createPageUrl('Contact') + `?page=${encodeURIComponent(window.location.href)}&sujet=signalement_erreur`}>
                  <Button variant="ghost" className="w-full text-slate-600">
                    <Flag className="mr-2 h-4 w-4" />
                    Signaler une erreur
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
