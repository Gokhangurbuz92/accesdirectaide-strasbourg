// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, Calendar, AlertTriangle, Info, RefreshCw, Star, Brain } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import CategoryChip from '@/components/ui/CategoryChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/layout/PageHeader';
import EmptyCatalogue from '@/components/layout/EmptyCatalogue';
import ListSkeleton from '@/components/feedback/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import NewsFallback from '@/components/news/NewsFallback';
import { generateBreadcrumbSchema } from '@/utils/schema';
import { formatProvenanceDate, getProvenance } from '@/lib/provenance';
import { htmlToPlainText } from '@/lib/htmlText';
import { newsSourceLabel, shownNewsCategory } from '@/lib/newsSource';
import { RecordProvenance, CardActionStrip } from '@/components/cards/RecordCardParts';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

/**
 * @typedef {object} ActualiteListItem
 * @property {string} id
 * @property {string=} slug
 * @property {string} titre
 * @property {string=} resume
 * @property {string=} summary_falc
 * @property {string | Date} date_publication
 * @property {string=} type_actu
 * @property {string=} categorie
 * @property {boolean=} est_important
 * @property {string=} source_nom
 * @property {string=} source_name
 * @property {string=} source
 * @property {string=} canonical_url
 * @property {string=} lien_url
 * @property {string=} url
 * @property {string=} source_url
 * @property {{ verifiedAt?: string|null, fetchedAt?: string|null, sourceUrl?: string|null, sourceHost?: string|null }=} provenance
 */

// Categories are loaded dynamically from /api/taxonomy

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

const DEFAULT_LIMIT = 10;
const LIMIT_OPTIONS = [10, 20, 50];
/** @type {ActualiteListItem[]} */
const EMPTY_ITEMS = [];

/** @param {unknown} value */
function parsePage(value) {
  const parsed = Number.parseInt(String(value ?? '1'), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/** @param {unknown} value */
function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  if (parsed < 1) return 1;
  if (parsed > 50) return 50;
  return parsed;
}

/** @param {ActualiteListItem | null | undefined} actu */
function getSourceName(actu) {
  return actu?.source_nom || actu?.source_name || actu?.source || '';
}

/** @param {ActualiteListItem | null | undefined} actu */
function getSourceUrl(actu) {
  return actu?.canonical_url || actu?.lien_url || actu?.url || actu?.source_url || '';
}

/** the kind of a news item, in the interface language (R32: explicit keys, French defaults) @param {string} typeKey @param {(k: string, d: string) => string} t */
function typeLabel(typeKey, t) {
  if (typeKey === 'nouveaute') return t('news:type.nouveaute', 'Nouveauté');
  if (typeKey === 'modification') return t('news:type.modification', 'Modification');
  if (typeKey === 'alerte') return t('news:type.alerte', 'Alerte');
  return t('news:type.info', 'Information');
}

/** one news item of the list — R32: its title and summary are the record's own text (French, marked lang="fr", until a verified translation exists) */
function NewsCard({ actu, index, isFalcEnabled }) {
  const { t } = useT('news');
  const tr = useContentTranslation('actualite', actu);
  const typeKey = actu.type_actu || 'info';
  const TypeIcon = TYPE_ICONS[typeKey] || Info;
  const linkUrl = actu.slug ? `/actualites/${actu.slug}` : `/actualites/view?id=${actu.id}`;
  const sourceName = getSourceName(actu);
  const sourceUrl = getSourceUrl(actu);
  const provenance = getProvenance(actu);
  const verifiedAt = formatProvenanceDate(provenance.verifiedAt);
  const sourceLabel = newsSourceLabel(sourceUrl, sourceName);
  const title = tr.value('titre');
  const falc = tr.value('summary_falc');
  const excerpt = htmlToPlainText(falc || tr.value('resume') || '', { maxLength: 220 });
  const readLabel = t('news:card.read_label', "Lire l'actualité {{title}}", { title });

  return (
    <AnimatedCard index={index}>
      <Card
        className={`group relative flex h-full flex-col overflow-hidden hover:shadow-lg transition-all ${actu.est_important ? 'border-s-4 border-s-blue-500' : ''}`}
        data-testid="actualite-card"
      >
        {/* Overlay Link */}
        <Link
          to={linkUrl}
          className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
          aria-label={readLabel}
        >
          <span className="sr-only">{readLabel}</span>
        </Link>

        <CardContent className="flex-1 p-6">
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge className={TYPE_COLORS[typeKey] || 'bg-slate-100 text-slate-800'}>
              <TypeIcon className="h-3 w-3 me-1" />
              {typeLabel(typeKey, t)}
            </Badge>
            {shownNewsCategory(actu.categorie) && (
              <CategoryChip slug={actu.categorie} />
            )}
            {actu.est_important && (
              <Badge className="bg-amber-100 text-amber-800">
                {t('news:badge.important', 'Important')}
              </Badge>
            )}
          </div>

          <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-700 transition-colors mb-3" data-testid="actualite-title" {...tr.attrs('titre')}>
            {title}
          </h2>

          <p className="text-slate-600 mb-4 leading-relaxed line-clamp-5" {...tr.attrs(falc ? 'summary_falc' : 'resume')}>
            {isFalcEnabled && falc ? falc : excerpt}
          </p>

          {/* FALC badge */}
          {isFalcEnabled && falc && (
            <div className="mb-4">
              <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                <Brain className="h-3 w-3" />
                {t('news:badge.simplified', 'Simplifié')}
              </Badge>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {t('news:card.published_on', 'Publiée le {{date}}', { date: formatDate(actu.date_publication, { day: 'numeric', month: 'long', year: 'numeric' }) })}
            </span>
          </div>
          <div className="mt-2"><RecordProvenance verifiedAt={verifiedAt} sourceHost={sourceLabel} sourceUrl={sourceUrl || null} /></div>
        </CardContent>
        <CardActionStrip label={t('news:card.action', 'Lire l’actualité')} />
      </Card>
    </AnimatedCard>
  );
}

export default function Actualites() {
  const { t } = useT('news');
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const { isFalcEnabled } = useFalc();

  const q = (searchParams.get('q') || '').trim();
  const categorie = (searchParams.get('categorie') || '').trim();
  const source = (searchParams.get('source') || '').trim();
  const page = parsePage(searchParams.get('page'));
  const limit = parseLimit(searchParams.get('limit') || searchParams.get('pageSize'));
  const sort = (searchParams.get('sort') || 'recent').trim();
  const searched = Boolean(q || categorie || source);

  const [queryInput, setQueryInput] = useState(q);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  // Dynamic taxonomy
  const { data: taxonomy } = useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => client.taxonomy.get(),
    staleTime: 5 * 60 * 1000,
  });
  const taxonomyCategories = taxonomy?.categories || [];

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['actualites', { q, categorie, source, sort, page, limit }],
    queryFn: async () => {
      const out = await client.entities.Actualite.filter({
        q: q || undefined,
        categorie: categorie || undefined,
        source: source || undefined,
        sort,
        page,
        limit,
        statut: 'publie',
      });
      // PKG-11 audit: a degraded answer (the database could not be read) is an error, never « Aucune actualité trouvée »
      if (out && out.degraded) throw new Error('actualites_degraded');
      return out;
    },
  });

  /** @type {ActualiteListItem[]} */
  const actualites = (data?.items ?? EMPTY_ITEMS);
  // nothing published at all (not a search without result): the page says so and offers the verified content instead
  const nothingPublished = !isLoading && !error && !searched && actualites.length === 0 && page === 1;
  const pagination = data?.pagination || {};

  const liveMessage = useMemo(() => {
    if (isLoading || isFetching) return t('news:list.loading', 'Chargement des actualités...');
    if (error) return t('news:live.error', "Erreur lors du chargement des actualités.");
    if (!actualites.length) return t('news:live.none', "Aucune actualité trouvée.");
    const total = typeof pagination.total === 'number' ? pagination.total : actualites.length;
    return t('news:live.found', { count: total, defaultValue_one: '{{count}} actualité trouvée.', defaultValue_other: '{{count}} actualités trouvées.' });
  }, [isLoading, isFetching, error, actualites.length, pagination.total, t]);

  /**
   * @param {string} key
   * @param {string} value
   */
  const handleParamChange = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (!value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const handleSearchSubmit = (event) => {
    event.preventDefault();
    handleParamChange('q', queryInput.trim());
  };

  /** @param {number} nextPage */
  const handlePageChange = (nextPage) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(nextPage));
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearchParams({});
    setIsFiltersOpen(false);
  };

  const schema = useMemo(() => {
    return [
      generateBreadcrumbSchema([
        { name: t('news:breadcrumb.home', 'Accueil'), url: '/' },
        { name: t('news:breadcrumb.news', 'Actualités'), url: '/actualites' },
      ]),
    ].filter(Boolean);
  }, [t]);

  const sourceOptions = useMemo(() => {
    const fromItems = actualites
      .map((a) => getSourceName(a))
      .filter((v) => v);
    const unique = Array.from(new Set(fromItems)).sort((a, b) => a.localeCompare(b, 'fr'));
    const options = [{ value: '', label: t('news:filters.all_sources', 'Toutes les sources') }, ...unique.map((v) => ({ value: v, label: v }))];
    if (source && !unique.includes(source)) {
      options.splice(1, 0, { value: source, label: source });
    }
    return options;
  }, [actualites, source, t]);

  const hasNext = Boolean(pagination.hasNext);
  const totalPages = pagination.totalPages || 1;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO
        title={t('news:list.seo_title', 'Actualités')}
        description={t('news:list.seo_description', 'Les dernières informations officielles sur les aides et les droits.')}
        path="/actualites"
        schema={schema}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <PageHeader title={t('news:list.title', 'Actualités')} description={t('news:list.description', 'Les changements utiles sur vos droits et vos démarches, avec leur source officielle.')} />

      {/* Header — R26: no search bar over an empty list (nothing published and nothing searched) */}
      {!nothingPublished && (
      <div className="bg-white border-b border-slate-200 py-4 sticky top-16 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setIsFiltersOpen((open) => !open)}
              aria-expanded={isFiltersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {t('news:filters.toggle', 'Filtres')}
            </Button>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('news:search.placeholder', 'Rechercher une actualité (ex: APL, RSA, logement...)')}
                aria-label={t('news:search.label', 'Rechercher une actualité')}
                className="ps-10 h-11 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
            <Button type="submit" className="h-11">
              {t('news:search.submit', 'Rechercher')}
            </Button>
          </form>

          {/* Filters */}
          {isFiltersOpen && (
            <Card>
              <CardContent className="p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor="actualites-source" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('news:filters.source', 'Source')}
                    </label>
                    <select
                      id="actualites-source"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={source}
                      onChange={(e) => handleParamChange('source', e.target.value)}
                    >
                      {sourceOptions.map((opt) => (
                        <option key={opt.value || 'all'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="actualites-limit" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('news:filters.per_page', 'Résultats par page')}
                    </label>
                    <select
                      id="actualites-limit"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={String(limit)}
                      onChange={(e) => handleParamChange('limit', e.target.value)}
                    >
                      {LIMIT_OPTIONS.map((opt) => (
                        <option key={opt} value={String(opt)}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <p className="block text-sm font-semibold text-slate-900 mb-2">{t('news:filters.category', 'Catégorie')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={categorie === '' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleParamChange('categorie', '')}
                      >
                        {t('news:filters.all_categories', 'Toutes')}
                      </Button>
                      {taxonomyCategories.map((cat) => (
                        <Button
                          type="button"
                          key={cat.slug}
                          variant={categorie === cat.slug ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleParamChange('categorie', cat.slug)}
                        >
                          {cat.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    {t('news:filters.reset', 'Réinitialiser')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      )}

      <div className={`${nothingPublished ? 'max-w-7xl' : 'max-w-4xl'} mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`}>
        {isLoading ? (
          <ListSkeleton layout="list" count={5} message={t('news:list.loading', 'Chargement des actualités...')} />
        ) : error ? (
          <EmptyState
            title={t('news:error.title', 'Impossible de charger les actualités')}
            description={t('news:error.text', 'Un problème est survenu lors de la récupération des actualités. Vous pouvez réessayer.')}
            actions={<Button type="button" variant="outline" className="min-h-11" onClick={() => refetch()}>{t('news:retry', 'Réessayer')}</Button>}
            role="alert"
            data-testid="actualites-error"
          />
        ) : actualites.length > 0 ? (
          <>
            <div className="space-y-6" data-testid="actualites-results-list">
              {actualites.map((actu, idx) => (
                <NewsCard key={actu.id} actu={actu} index={idx} isFalcEnabled={isFalcEnabled} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-center mt-10 gap-3">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  {t('news:pagination.previous', 'Précédent')}
                </Button>
                <span className="flex items-center px-4 text-sm font-medium">
                  {t('news:pagination.page', 'Page {{page}} / {{total}}', { page, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  disabled={!hasNext}
                  onClick={() => handlePageChange(page + 1)}
                >
                  {t('news:pagination.next', 'Suivant')}
                </Button>
              </div>
            )}
          </>
        ) : nothingPublished ? (
          <EmptyCatalogue title={t('news:none.title', 'Aucune actualité n’est encore publiée')} testId="actualites-none-published">
            <p>{t('news:none.text', 'Chaque actualité est relue avant publication et cite sa source officielle. Aucune n’a encore été publiée pendant la bêta.')}</p>
          </EmptyCatalogue>
        ) : (
          <NewsFallback />
        )}
      </div>
    </div>
  );
}
