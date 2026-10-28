// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import React from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { client } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import NotFound from './NotFound';
import Gone from './Gone';
import { generateActualiteSchema, generateBreadcrumbSchema } from '@/utils/schema';
import ProvenanceFreshness from '@/components/ProvenanceFreshness';
import FalcSummary from '@/components/FalcSummary';
import { htmlToPlainText } from '@/lib/htmlText';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import EmptyState from '@/components/ui/EmptyState';
import {
  ArrowLeft,
  Calendar,
  Star,
  RefreshCw,
  AlertTriangle,
  Info,
  ExternalLink
} from 'lucide-react';
import { getProvenance } from '@/lib/provenance';

const TYPE_ICONS = {
  nouveaute: Star,
  modification: RefreshCw,
  alerte: AlertTriangle,
  info: Info,
};

const TYPE_COLORS = {
  nouveaute: 'bg-green-100 text-green-800',
  modification: 'bg-blue-100 text-blue-800',
  alerte: 'bg-red-100 text-red-800',
  info: 'bg-slate-100 text-slate-800',
};

const CATEGORIES = {
  logement: 'Logement',
  sante: 'Santé',
  handicap: 'Handicap',
  emploi: 'Emploi',
  famille: 'Famille',
  budget: 'Budget',
  mobilite: 'Mobilité',
  justice: 'Justice',
  numerique: 'Numérique',
  etrangers: 'Nouveaux arrivants',
  general: 'Général',
};

/** @typedef {Error & { status?: number }} ApiError */

export default function ActualiteDetail() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const identifier = slug || id;

  const { data: actu, isLoading, error, refetch } = useQuery({
    queryKey: ['actualite', identifier],
    queryFn: async () => {
      if (!identifier) return null;

      // Prefer the canonical endpoint for slug-based routes.
      if (slug) {
        const res = await fetch(`/api/actualites/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          /** @type {ApiError} */
          const apiError = new Error(`HTTP ${res.status}`);
          apiError.status = res.status;
          throw apiError;
        }
        return await res.json();
      }

      // Legacy route: /actualites/view?id=...
      try {
        return await client.entities.Actualite.get(id);
      } catch (e) {
        /** @type {ApiError} */
        const apiError = e;
        if (apiError?.status === 404 || apiError?.status === 410) throw apiError;
        throw apiError;
      }
    },
    enabled: !!identifier,
  });

  // Canonical Redirect: If accessed via ID but slug exists, redirect to slug URL
  React.useEffect(() => {
    if (actu && !slug && actu.slug) {
      navigate(`/actualites/${actu.slug}`, { replace: true });
    }
  }, [actu, slug, navigate]);

  if (isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (error) {
    /** @type {ApiError} */
    const apiError = error;
    const status = apiError?.status;
    if (status === 410) return <Gone />;
    if (status === 404) return <NotFound />;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <EmptyState
          headingLevel={1}
          title="Impossible de charger cette actualité"
          description="Vérifiez votre connexion puis réessayez."
          actions={
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={() => refetch()}>Réessayer</Button>
              <Link to={createPageUrl('Actualites')}>
                <Button>Retour aux actualités</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (!actu) {
    return <NotFound />;
  }

  const TypeIcon = TYPE_ICONS[actu.type_actu] || Info;
  const sourceName = actu.source_nom || actu.source_name || actu.source || '';
  const sourceUrl = actu.canonical_url || actu.lien_url || actu.url || actu.source_url || '';
  const provenance = getProvenance(actu);
  const descriptionText = htmlToPlainText(
    actu.summary_falc || actu.resume || actu.contenu || '',
    { maxLength: 160 },
  );
  const contentText = htmlToPlainText(actu.contenu || '');

  const breadcrumbs = [
    { name: 'Accueil', url: '/' },
    { name: 'Actualités', url: '/actualites' },
    { name: actu.titre, url: `/actualites/${actu.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateActualiteSchema(actu)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={actu.titre}
        description={descriptionText}
        path={`/actualites/${actu.slug}`}
        schema={schema}
      />

      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">Accueil</Link>
            <span className="text-slate-400">/</span>
            <Link to={createPageUrl('Actualites')} className="hover:text-blue-600">Actualités</Link>
            <span className="text-slate-400">/</span>
            <span className="text-slate-900 line-clamp-1">{actu.titre}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to={createPageUrl('Actualites')}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux actualités
        </Link>

        <Card className={`mb-6 ${actu.est_important ? 'border-l-4 border-l-blue-500' : ''}`}>
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge className={TYPE_COLORS[actu.type_actu] || 'bg-slate-100 text-slate-800'}>
                <TypeIcon className="h-3 w-3 mr-1" />
                {actu.type_actu === 'nouveaute' ? 'Nouveauté' :
                  actu.type_actu === 'modification' ? 'Modification' :
                    actu.type_actu === 'alerte' ? 'Alerte' : 'Information'}
              </Badge>
              {actu.categorie && (
                <Badge variant="outline">
                  {CATEGORIES[actu.categorie] || actu.categorie}
                </Badge>
              )}
              {actu.est_important && (
                <Badge className="bg-amber-100 text-amber-800">
                  Important
                </Badge>
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6">
              {actu.titre}
            </h1>

            <div className="flex items-center gap-4 text-sm text-slate-500 mb-8 pb-4 border-b border-slate-100">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(actu.date_publication).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </span>
              {sourceName && (
                <span>Source : {sourceName}</span>
              )}
            </div>

            <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-line">
              {contentText}
            </div>

            {sourceUrl && (
              <div className="mt-8">
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <Button variant="outline" className="gap-2">
                    Lire la source officielle
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* FALC Summary */}
        <FalcSummary text={actu?.summary_falc} />

        <ProvenanceFreshness provenance={provenance} />
      </div>
    </div>
  );
}
