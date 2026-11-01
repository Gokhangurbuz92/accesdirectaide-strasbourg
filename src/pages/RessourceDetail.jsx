// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';

import { Link, useParams, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import NotFound from "./NotFound";
import LoadError from '@/components/LoadError';
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { generateBreadcrumbSchema, generateRessourceSchema } from '@/utils/schema';
import SourceTraceability from '@/components/SourceTraceability';
import FalcSummary from '@/components/FalcSummary';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ChevronRight,
  FileText
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';

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
    return <NotFound />;
  }

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
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('resources:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="rtl-flip h-4 w-4" />
            <Link to="/ressources" className="hover:text-blue-600">{t('resources:breadcrumb.resources', 'Ressources')}</Link>
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
              <Badge className="bg-blue-100 text-blue-800" {...fr}>
                {ressource.type}
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
              <div className="prose max-w-none text-slate-700" {...fr}>
                {ressource.content}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Source Traceability */}
        <SourceTraceability
          source_url={ressource.source_url}
          retrieved_at={ressource.retrieved_at || ressource.fetched_at || ressource.createdAt}
          last_checked_at={ressource.last_checked_at || ressource.updatedAt}
          source_last_modified={ressource.source_last_modified}
        />
      </div>
    </div>
  );
}
