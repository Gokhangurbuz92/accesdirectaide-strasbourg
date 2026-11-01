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
import { newsPublisher, newsSourceLabel, shownNewsCategory } from '@/lib/newsSource';
import { Trans } from 'react-i18next';
import i18n, { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';

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

/** the label of a news category in the interface language (R32: explicit keys, French defaults); an unknown category is shown as it is @param {string} slug @param {(k: string, d: string) => string} t */
function categoryLabel(slug, t) {
  switch (slug) {
    case 'logement': return t('news:category.logement', 'Logement');
    case 'sante': return t('news:category.sante', 'Santé');
    case 'handicap': return t('news:category.handicap', 'Handicap');
    case 'emploi': return t('news:category.emploi', 'Emploi');
    case 'famille': return t('news:category.famille', 'Famille');
    case 'budget': return t('news:category.budget', 'Budget');
    case 'mobilite': return t('news:category.mobilite', 'Mobilité');
    case 'justice': return t('news:category.justice', 'Justice');
    case 'numerique': return t('news:category.numerique', 'Numérique');
    case 'etrangers': return t('news:category.etrangers', 'Nouveaux arrivants');
    case 'general': return t('news:category.general', 'Général');
    default: return slug;
  }
}

/** the kind of a news item, in the interface language (R32: explicit keys, French defaults) @param {string} typeKey @param {(k: string, d: string) => string} t */
function typeLabel(typeKey, t) {
  if (typeKey === 'nouveaute') return t('news:type.nouveaute', 'Nouveauté');
  if (typeKey === 'modification') return t('news:type.modification', 'Modification');
  if (typeKey === 'alerte') return t('news:type.alerte', 'Alerte');
  return t('news:type.info', 'Information');
}

const LONG_DAY = { day: 'numeric', month: 'long', year: 'numeric' };

/** @typedef {Error & { status?: number }} ApiError */

export default function ActualiteDetail() {
  const { t } = useT('news');
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
  // R32: the item's own text (title, summary, body) — French, marked lang="fr", until a verified translation may be shown
  const tr = useContentTranslation('actualite', actu);

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
          title={t('news:detail.error.title', 'Impossible de charger cette actualité')}
          description={t('news:detail.error.text', 'Vérifiez votre connexion puis réessayez.')}
          actions={
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={() => refetch()}>{t('news:retry', 'Réessayer')}</Button>
              <Link to={createPageUrl('Actualites')}>
                <Button>{t('news:detail.back', 'Retour aux actualités')}</Button>
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
  const publisher = newsPublisher(sourceUrl);
  const title = tr.value('titre');
  const descriptionText = htmlToPlainText(
    tr.value('summary_falc') || tr.value('resume') || tr.value('contenu') || '',
    { maxLength: 160 },
  );
  const contentText = htmlToPlainText(tr.value('contenu') || '');

  const breadcrumbs = [
    { name: t('news:breadcrumb.home', 'Accueil'), url: '/' },
    { name: t('news:breadcrumb.news', 'Actualités'), url: '/actualites' },
    { name: title, url: `/actualites/${actu.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateActualiteSchema(actu)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={title}
        description={descriptionText}
        path={`/actualites/${actu.slug}`}
        schema={schema}
      />

      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('news:breadcrumb.home', 'Accueil')}</Link>
            <span className="text-slate-400">/</span>
            <Link to={createPageUrl('Actualites')} className="hover:text-blue-600">{t('news:breadcrumb.news', 'Actualités')}</Link>
            <span className="text-slate-400">/</span>
            <span className="text-slate-900 line-clamp-1" {...tr.attrs('titre')}>{title}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to={createPageUrl('Actualites')}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('news:detail.back', 'Retour aux actualités')}
        </Link>

        <Card className={`mb-6 ${actu.est_important ? 'border-s-4 border-s-blue-500' : ''}`}>
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge className={TYPE_COLORS[actu.type_actu] || 'bg-slate-100 text-slate-800'}>
                <TypeIcon className="h-3 w-3 me-1" />
                {typeLabel(actu.type_actu, t)}
              </Badge>
              {shownNewsCategory(actu.categorie) && (
                <Badge variant="outline">
                  {categoryLabel(actu.categorie, t)}
                </Badge>
              )}
              {actu.est_important && (
                <Badge className="bg-amber-100 text-amber-800">
                  {t('news:badge.important', 'Important')}
                </Badge>
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6" {...tr.attrs('titre')}>
              {title}
            </h1>
            <ContentTranslationNotice translation={tr} className="mb-6" />

            <div className="flex items-center gap-4 text-sm text-slate-500 mb-8 pb-4 border-b border-slate-100">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatDate(actu.date_publication, LONG_DAY)}
              </span>
              {(sourceUrl || sourceName) && (
                <span>{t('news:detail.source', 'Source : {{source}}', { source: newsSourceLabel(sourceUrl, sourceName) })}</span>
              )}
            </div>

            <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-line" {...tr.attrs('contenu')}>
              {contentText}
            </div>

            {publisher && (
              <p className="mt-6 text-sm text-slate-600" data-testid="news-attribution">
                {/* R32: the publisher, its owner and the licence are names and stay as they are; only the words around them are translated */}
                <Trans i18n={i18n} i18nKey="news:detail.attribution"
                  defaults="Texte de {{name}}, site de la {{owner}}, repris sans modification sous <licence>{{licence}}<tab> (nouvel onglet)</tab></licence>."
                  values={{ name: publisher.name, owner: publisher.owner, licence: publisher.licence }}
                  components={{ licence: <a href={publisher.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-900">{publisher.licence}</a>, tab: <span className="sr-only" /> }} />
                {actu.auto_publish && actu.published_at && ` ${t('news:detail.auto_published', 'Publié sur AccesDirectAide le {{date}}, après une vérification automatique de la page d’origine (même titre, même date, même texte).', { date: formatDate(actu.published_at, LONG_DAY) })}`}
              </p>
            )}

            {sourceUrl && (
              <div className="mt-8">
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <Button variant="outline" className="gap-2">
                    {t('news:detail.read_source', 'Lire la source officielle')}
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* FALC Summary */}
        <FalcSummary text={tr.value('summary_falc')} />

        <ProvenanceFreshness provenance={provenance} />
      </div>
    </div>
  );
}
