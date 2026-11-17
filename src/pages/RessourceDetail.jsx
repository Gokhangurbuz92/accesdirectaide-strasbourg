// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';

import { Link, useParams, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import NotFound from "./NotFound";
import LoadError from '@/components/LoadError';
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { generateBreadcrumbSchema, generateRessourceSchema } from '@/utils/schema';
import FalcSummary from '@/components/FalcSummary';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  FileText
} from 'lucide-react';
import { formatDate, useLanguage, useT } from '@/i18n';

export default function RessourceDetail() {
  const { t } = useT('resources');
  const { isSource } = useLanguage();
  // R32: the resource's own texts come from the API in French: marked as such when the interface is in another language
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const identifier = slug || id;

  const fetchRessource = async () => {
    let url = `/api/ressources?`;
    if (slug) url += `slug=${encodeURIComponent(slug)}`;   // R7: encoded (it was concatenated as typed)
    else if (id) url += `id=${encodeURIComponent(id)}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      // C12: a withdrawn document says so (its address stays known), never « page not found » nor its old content
      if (res.status === 410) return { withdrawn: true };
      throw new Error('Failed to fetch');
    }
    return res.json();
  };

  const { data: ressource, isLoading, isError, refetch } = useQuery({
    queryKey: ['ressource', identifier],
    queryFn: fetchRessource,
    enabled: !!identifier
  });

  if (isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  // R7: an outage is said as such (it showed « Page introuvable », as if the resource did not exist)
  if (isError) {
    return <div className="max-w-4xl mx-auto px-4 py-8"><LoadError what={t('resources:detail.error-what', 'cette ressource')} onRetry={() => refetch()} testId="ressource-error" headingLevel={1} /></div>;
  }

  if (!ressource) {
    return <NotFound kind="record" />;
  }

  if (ressource.withdrawn) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <SEO title={t('resources:withdrawn.title', 'Document retiré')} path={`/ressources/${slug || ''}`} noindex />
        <h1 className="text-2xl font-bold text-slate-900">{t('resources:withdrawn.title', 'Document retiré')}</h1>
        <p className="mt-2 text-slate-700" data-testid="ressource-withdrawn">{t('resources:withdrawn.text', 'Ce document a été retiré de la page Ressources. Consultez directement les sites officiels, ou les aides et démarches vérifiées.')}</p>
        <Link to="/ressources" className="mt-4 inline-flex min-h-11 items-center text-blue-700 underline">{t('resources:detail.back', 'Retour aux ressources')}</Link>
      </div>
    );
  }
  const typeLabel = (x) => ({ guide: t('resources:type.guide', 'Guide'), tool: t('resources:type.tool', 'Outil'), document: t('resources:type.document', 'Document'), link: t('resources:type.link', 'Lien utile') }[x] || x);
  const day = (d) => formatDate(d, { year: 'numeric', month: 'long', day: 'numeric' }) || '';

  const breadcrumbs = [
    { name: t('resources:breadcrumb.home', 'Accueil'), url: '/' },
    { name: t('resources:breadcrumb.resources', 'Ressources'), url: '/ressources' },
    { name: ressource.title, url: `/ressources/${ressource.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateRessourceSchema(ressource)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={ressource.title}
        description={ressource.content?.substring(0, 150)}
        path={`/ressources/${ressource.slug}`}
        schema={schema}
      />

      {/* Breadcrumbs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="inline-flex min-h-6 min-w-6 items-center justify-center py-0.5 hover:text-blue-600">{t('resources:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="rtl-flip h-4 w-4" />
            <Link to="/ressources" className="inline-flex min-h-6 min-w-6 items-center justify-center py-0.5 hover:text-blue-600">{t('resources:breadcrumb.resources', 'Ressources')}</Link>
            <ChevronRight className="rtl-flip h-4 w-4" />
            <span className="text-slate-900 truncate max-w-[200px]" {...fr}>{ressource.title}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to="/ressources"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="rtl-flip h-4 w-4" />
          {t('resources:detail.back', 'Retour aux ressources')}
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {ressource.type && (
              <Badge className="bg-blue-100 text-blue-800">
                {typeLabel(ressource.type)}
              </Badge>
            )}
            {ressource.territory_scope && (
              <
// @ts-ignore
              Badge variant="outline" {...fr}>
                {ressource.territory_scope}
              </Badge>
            )}
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4" {...fr}>
            {ressource.title}
          </h1>
        </div>

        {/* FALC Summary */}
        <FalcSummary text={ressource?.resume_falc || ressource?.summary_falc || ressource?.description_falc} />

        {/* Content */}
        {ressource.content && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                {t('resources:detail.content', 'Contenu')}
              </h2>
              {/* plain text only (the server refuses markup); rendered as text, line breaks kept */}
              <div className="prose max-w-none whitespace-pre-line text-slate-700" {...fr}>
                {ressource.content}
              </div>
            </CardContent>
          </Card>
        )}

        {/* C12: the official source, its publisher and the date a person verified this document against it (never an import date) */}
        {ressource.source_url && (
          <section aria-labelledby="ressource-source-title" data-testid="ressource-source-block" className="rounded-lg border border-blue-200 bg-blue-50 p-6">
            <h2 id="ressource-source-title" className="mb-3 flex items-center gap-2 text-lg font-semibold text-blue-900">{t('resources:detail.source_title', 'Source officielle')}</h2>
            <dl className="space-y-2 text-sm text-blue-950">
              <div>
                <dt className="inline font-medium">{t('resources:detail.publisher', 'Éditeur :')}</dt>{' '}
                <dd className="inline" {...fr}>{ressource.source_publisher}</dd>
              </div>
              <div>
                <dt className="inline font-medium">{t('resources:detail.address', 'Adresse :')}</dt>{' '}
                <dd className="inline">
                  <a href={ressource.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-blue-800 underline">
                    <span dir="ltr">{ressource.source_url}</span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 rtl-flip" aria-hidden="true" />
                    <span className="sr-only">{t('resources:detail.new_tab', '(s’ouvre dans un nouvel onglet)')}</span>
                  </a>
                </dd>
              </div>
              {ressource.verified_at && (
                <div data-testid="ressource-verified">
                  <dt className="inline font-medium">{t('resources:detail.verified', 'Vérifié le :')}</dt>{' '}
                  <dd className="inline">{day(ressource.verified_at)}</dd>
                </div>
              )}
            </dl>
            {ressource.freshness === 'update_needed' && (
              <p className="mt-3 text-sm text-amber-900" data-testid="ressource-update-needed">{t('resources:card.update_needed', 'Vérifié il y a plus de trois mois : consultez aussi la source officielle.')}</p>
            )}
            <p className="mt-3 text-sm text-blue-950">{t('resources:detail.source_rule', 'Ce document présente la source officielle ; en cas de différence, la source officielle fait foi.')}</p>
          </section>
        )}
      </div>
    </div>
  );
}
