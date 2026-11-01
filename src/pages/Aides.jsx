// @ts-nocheck
import OfficialResourcesNotice from '@/components/OfficialResourcesNotice';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { track } from '@vercel/analytics';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import FilterPanel from '@/components/organisms/FilterPanel';
import EmptyState from '@/components/ui/EmptyState';
import NoResultsHelp from '@/components/search/NoResultsHelp';
import AidGrid from '@/components/organisms/AidGrid';
import { buildAidesItemListSchema, buildBreadcrumbSchema } from '@/lib/seo';
import { useAidesListing } from '@/lib/hooks/useAidesListing';
import serviceTerritory from '../../data/geography/service-territory.v1.json';
import { categoryLabel } from '@/components/ui/CategoryChip';
import { Trans } from 'react-i18next';
import i18n, { useLanguage, useT } from '@/i18n';

/** @param {string} t */
const slugOf = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50];

const INITIAL_LOCAL_FILTERS = { search: '', category: '', urgentOnly: false };

/** the listing hook (useAidesListing) reports a failure with this French sentence: it is shown in the interface language */
const LISTING_ERROR_FR = 'Impossible de charger les aides. Réessayez.';

/**
 * @param {string | null} value
 */
function parsePage(value) {
  const parsed = Number.parseInt(String(value ?? '1'), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * @param {string | null} value
 */
function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  if (parsed < 1) return 1;
  if (parsed > 50) return 50;
  return parsed;
}

export default function Aides() {
  const { t } = useT('aides');
  const { isSource } = useLanguage();
  // R32: a category as shown — in French the label given by the API (unchanged); in another language the shared name of a taxonomy category
  // (fixed codes, CategoryChip's categoryLabel), else the API label, marked as French
  const categoryText = (/** @type {{ slug: string, label: string }} */ cat) => (!isSource && categoryLabel(cat.slug, t)) || cat.label;
  const categoryLang = (/** @type {{ slug: string }} */ cat) => (!isSource && categoryLabel(cat.slug, t) ? undefined : 'fr');
  const location = useLocation();
  const navigate = useNavigate();
  const { slug, categorySlug, territorySlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState(INITIAL_LOCAL_FILTERS);

  const hasActiveLocalFilters =
    localFilters.search.trim() !== '' ||
    localFilters.category !== '' ||
    localFilters.urgentOnly;

  const resetLocalFilters = () => setLocalFilters(INITIAL_LOCAL_FILTERS);

  // Legacy pretty routes -> canonical query params
  useEffect(() => {
    if (location.pathname.startsWith('/categories/') && slug) {
      const params = new URLSearchParams(searchParams);
      if (!params.get('category') && !params.get('theme') && !params.get('cat')) {
        params.set('category', slug);
      }
      params.set('page', '1');
      navigate(`/aides?${params.toString()}`, { replace: true });
    }
  }, [location.pathname, slug, searchParams, navigate]);

  useEffect(() => {
    if (location.pathname.startsWith('/situations/') && slug) {
      const params = new URLSearchParams(searchParams);
      if (!params.get('situation')) {
        params.set('situation', slug);
      }
      params.set('page', '1');
      navigate(`/aides?${params.toString()}`, { replace: true });
    }
  }, [location.pathname, slug, searchParams, navigate]);

  const q = (searchParams.get('q') || '').trim();
  const category = (categorySlug || searchParams.get('category') || searchParams.get('theme') || '').trim();
  const situation = (searchParams.get('situation') || '').trim();
  const territory = (territorySlug || searchParams.get('territory') || searchParams.get('territoire') || '').trim();
  const source = (searchParams.get('source') || '').trim();
  const page = parsePage(searchParams.get('page'));
  const limit = parseLimit(searchParams.get('limit') || searchParams.get('pageSize'));
  const sort = (searchParams.get('sort') || (q ? 'relevance' : 'quality')).trim();

  const [queryInput, setQueryInput] = useState(q);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  // ------------------------------------------------------------------
  // V2-02: Use useAidesListing hook instead of react-query
  // ------------------------------------------------------------------
  const { status, items: apiItems, pagination, facets, errorMessage, refetch } = useAidesListing({
    q,
    theme: category,
    urgent: localFilters.urgentOnly ? 'true' : undefined,
    sort,
    page,
    pageSize: limit,
    situation,
    territoire: territory,
  });

  const isLoading = status === 'loading' || status === 'idle';
  const isError = status === 'error';
  const isSuccess = status === 'success';

  // ------------------------------------------------------------------
  // Taxonomy (keep react-query for taxonomy — it's not Aides data)
  // ------------------------------------------------------------------
  const { data: taxonomy } = useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => client.taxonomy.get(),
  });
  const themeKnown = categorySlug ? taxonomy?.categories?.find((/** @type {{ slug: string; label: string }} */ c) => c.slug === category) : null;
  const communeKnown = territorySlug ? ((/** @type {[string, string][]} */ (serviceTerritory.communes)).find(([, nom]) => slugOf(nom) === slugOf(territorySlug)) || [])[1] || '' : '';

  // ------------------------------------------------------------------
  // Apply local filters ON TOP of API results
  // ------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    if (!apiItems.length) return apiItems;

    const localSearch = localFilters.search.trim().toLowerCase();

    return apiItems.filter((item) => {
      if (localFilters.category) {
        const searchStr = `${item.title} ${item.summary || ''}`.toLowerCase();
        if (!searchStr.includes(localFilters.category.toLowerCase())) return false;
      }
      if (localSearch) {
        const searchStr = `${item.title} ${item.summary || ''}`.toLowerCase();
        if (!searchStr.includes(localSearch)) return false;
      }
      return true;
    });
  }, [apiItems, localFilters]);

  const hasAnyFilters = hasActiveLocalFilters ||
    Boolean(q) || Boolean(category) || Boolean(situation) || Boolean(territory);

  // ------------------------------------------------------------------
  // SEO & live message
  // ------------------------------------------------------------------
  const liveMessage = useMemo(() => {
    if (isLoading) return t('aides:live.loading', 'Chargement des aides...');
    if (isError) return t('aides:live.error', 'Erreur lors du chargement des aides.');
    if (!filteredItems.length) return t('aides:live.none', 'Aucune aide trouvée.');
    const total = typeof pagination?.total === 'number' ? pagination.total : filteredItems.length;
    return t('aides:list.results', { count: total, defaultValue_one: '{{count}} aide trouvée.', defaultValue_other: '{{count}} aides trouvées.' });
  }, [isLoading, isError, filteredItems.length, pagination?.total, t]);

  const handleParamChange = (/** @type {string} */ key, /** @type {string} */ value) => {
    track('filter_aides', { filter_key: key, filter_value: value || 'all' });
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  const handleSearchSubmit = (/** @type {{ preventDefault: () => void; }} */ event) => {
    event.preventDefault();
    const cleanQuery = queryInput.trim();
    if (cleanQuery) {
      // Privacy (LEGAL_FR 03_COOKIES_TRACEURS.md C3): never send the free-text query to analytics — it may contain
      // personal or health information. Only a coarse length bucket is sent.
      track('search_aides', { length: cleanQuery.length <= 10 ? 'short' : cleanQuery.length <= 30 ? 'medium' : 'long' });
    }
    handleParamChange('q', cleanQuery);
  };

  const clearFilters = () => {
    setSearchParams({});
    setIsFiltersOpen(false);
  };

  const handlePageChange = (/** @type {number} */ nextPage) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(nextPage));
    setSearchParams(params);
  };

  const getTitle = () => {
    if (q) return t('aides:seo.title_search', 'Aides - {{q}}', { q });
    if (category && territory) {
      const taxonomyCat = taxonomy?.categories?.find((/** @type {{ slug: string; }} */ c) => c.slug === category);
      const catLabel = taxonomyCat ? categoryText(taxonomyCat) : category;
      return t('aides:seo.title_theme_territory', 'Aides {{theme}} en {{territory}} | AccesDirectAide', { theme: catLabel, territory });
    }
    if (category && taxonomy?.categories?.length) {
      const found = taxonomy.categories.find((/** @type {{ slug: string; }} */ c) => c.slug === category);
      if (found) return t('aides:seo.title_theme', 'Aides - {{theme}} | AccesDirectAide', { theme: categoryText(found) });
    }
    if (situation && taxonomy?.aidSituations?.length) {
      const found = taxonomy.aidSituations.find((/** @type {{ code: string; slug: string; }} */ s) => s.code === situation || s.slug === situation);
      if (found) return t('aides:seo.title_situation', 'Aides pour : {{situation}} | AccesDirectAide', { situation: found.label });
    }
    return t('aides:seo.title', 'Aides sociales et démarches');
  };

  const getDescription = () => {
    if (q) return t('aides:seo.description_search', 'Résultats pour la recherche "{{q}}" sur les aides disponibles.', { q });
    if (category && territory) {
      const taxonomyCat = taxonomy?.categories?.find((/** @type {{ slug: string; }} */ c) => c.slug === category);
      const catLabel = taxonomyCat ? categoryText(taxonomyCat) : category;
      return t('aides:seo.description_theme_territory', 'Découvrez toutes les aides {{theme}} disponibles en {{territory}}. Accédez aux démarches et accompagnements locaux.', { theme: catLabel, territory });
    }
    if (category && taxonomy?.categories?.length) {
      const found = taxonomy.categories.find((/** @type {{ slug: string; }} */ c) => c.slug === category);
      if (found) return t('aides:seo.description_theme', 'Toutes les aides sociales de la catégorie {{theme}}.', { theme: categoryText(found) });
    }
    if (situation && taxonomy?.aidSituations?.length) {
      const found = taxonomy.aidSituations.find((/** @type {{ code: string; slug: string; }} */ s) => s.code === situation || s.slug === situation);
      if (found) return t('aides:seo.description_situation', 'Toutes les aides sociales pour la situation : {{situation}}.', { situation: found.label });
    }
    return t('aides:seo.description', 'Retrouvez les aides sociales disponibles et filtrez par catégorie ou situation.');
  };

  const schema = useMemo(() => {
    const breadcrumb = buildBreadcrumbSchema([
      { name: t('aides:breadcrumb.home', 'Accueil'), url: '/' },
      { name: t('aides:breadcrumb.aides', 'Aides'), url: '/aides' },
    ]);
    // Pass raw items for SEO (buildAidesItemListSchema expects raw aide objects)
    const itemList = buildAidesItemListSchema(filteredItems);
    return [breadcrumb, itemList].filter(Boolean);
  }, [filteredItems, t]);

  const territoryOptions = useMemo(() => {
    const facetTerritories = facets?.territoires || {};
    const keys = Object.keys(facetTerritories);
    const allTerritories = { value: '', label: t('aides:filters.territory_all', 'Tous les territoires') };
    const national = t('aides:territory.national', 'France entière');
    if (!keys.length) {
      return [
        allTerritories,
        { value: 'national', label: national },
        { value: '67', label: 'Bas-Rhin (67)' },
        { value: '68', label: 'Haut-Rhin (68)' },
      ];
    }
    const sorted = keys
      .filter((key) => key)
      .sort((a, b) => String(a).localeCompare(String(b), 'fr'));
    const formatted = sorted.map((key) => {
      if (key === 'national') return { value: key, label: national };
      if (key === '67') return { value: key, label: 'Bas-Rhin (67)' };
      if (key === '68') return { value: key, label: 'Haut-Rhin (68)' };
      return { value: key, label: String(key), lang: 'fr' };   // a territory named by the API (French)
    });
    return [allTerritories, ...formatted];
  }, [facets?.territoires, t]);

  // the listing hook's own French failure sentence, in the interface language
  const errorText = errorMessage === LISTING_ERROR_FR
    ? t('aides:error.listing', 'Impossible de charger les aides. Réessayez.')
    : errorMessage || t('aides:error.hint', 'Vérifiez votre connexion puis réessayez.');

  const hasNext = Boolean(pagination?.hasNext);
  const totalPages = pagination?.totalPages || 1;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO
        title={getTitle()}
        description={getDescription()}
        path="/aides"
        schema={schema}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* Gradient Banner */}
      <div
        className="relative overflow-hidden py-10 sm:py-14"
        style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 30%, #1e3a8a 60%, #3730a3 85%, #4F46E5 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-16 -end-16 w-72 h-72 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden="true" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md">
            {/* Q10: the address is never echoed into the heading — only a known theme / commune is named */}
            {!categorySlug
              ? t('aides:list.title', 'Aides sociales')
              : themeKnown
                ? (communeKnown
                  ? t('aides:list.title_theme_commune', 'Aides : {{theme}} à {{commune}}', { theme: categoryText(themeKnown), commune: communeKnown })
                  : t('aides:list.title_theme', 'Aides : {{theme}}', { theme: categoryText(themeKnown) }))
                : taxonomy ? t('aides:list.title', 'Aides sociales') : t('aides:list.title_short', 'Aides')}
          </h1>
          {categorySlug && taxonomy && !themeKnown ? (
            <p className="mt-2 text-sm text-white" data-testid="aides-unknown-theme">
              {t('aides:list.unknown_theme', "Ce thème n'est pas reconnu.")} <Link to="/aides" className="underline underline-offset-2">{t('aides:list.see_all', 'Voir toutes les aides')}</Link>
            </p>
          ) : null}
          <p className="mt-2 text-blue-100/80 text-sm sm:text-base">
            {categorySlug && territorySlug
              ? t('aides:list.intro_territory', 'Explorez les dispositifs et accompagnements disponibles pour votre région.')
              : t('aides:list.intro', 'Filtrez par catégorie, situation ou territoire, ou lancez une recherche.')}
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white border-b border-slate-200 py-4 sticky top-20 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <div className="flex items-center gap-2">
              <Link to="/recherche" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
                {t('aides:list.smart_search', 'Recherche intelligente')}
              </Link>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setIsFiltersOpen((open) => !open)}
                aria-expanded={isFiltersOpen}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t('aides:filters.title', 'Filtres')}
              </Button>
            </div>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3" role="search">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('aides:search.placeholder', 'Rechercher une aide (ex: APL, CSS, Visale...)')}
                aria-label={t('aides:search.label', 'Rechercher une aide')}
                className="ps-10 h-11 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
            <Button type="submit" className="h-11 bg-slate-950 text-white hover:bg-slate-800">
              {t('aides:search.submit', 'Rechercher')}
            </Button>
          </form>

          <p className="text-sm text-slate-500">
            <Trans
              i18n={i18n}
              i18nKey="aides:list.glossary_tip"
              defaults="Astuce : consultez notre <0>glossaire</0> pour comprendre les sigles (RSA, APL, AAH...)"
              components={[<Link key="glossaire" to="/glossaire" className="text-blue-600 hover:text-blue-800 underline" />]}
            />
          </p>

          {/* Filters */}
          {isFiltersOpen && (
            <Card>
              <CardContent className="p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <label htmlFor="aides-category" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.category', 'Catégorie')}
                    </label>
                    <select
                      id="aides-category"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={category}
                      onChange={(e) => handleParamChange('category', e.target.value)}
                    >
                      <option value="">{t('aides:filters.all', 'Toutes')}</option>
                      {(taxonomy?.categories || []).map((/** @type {{ label: string, slug: string }} */ cat) => (
                        <option key={cat.slug} value={cat.slug} lang={categoryLang(cat)}>
                          {categoryText(cat)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aides-situation" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.situation', 'Situation')}
                    </label>
                    <select
                      id="aides-situation"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={situation}
                      onChange={(e) => handleParamChange('situation', e.target.value)}
                    >
                      <option value="">{t('aides:filters.all', 'Toutes')}</option>
                      {/* the situations are named by the API (French) */}
                      {(taxonomy?.aidSituations || []).map((/** @type {{ code: string | number, label: string | number }} */ sit) => (
                        <option key={sit.code} value={sit.code} lang="fr">
                          {sit.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aides-territory" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.territory', 'Territoire')}
                    </label>
                    <select
                      id="aides-territory"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={territory}
                      onChange={(e) => handleParamChange('territory', e.target.value)}
                    >
                      {territoryOptions.map((opt) => (
                        <option key={opt.value || 'all'} value={opt.value} lang={opt.lang}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aides-source" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.source', 'Source')}
                    </label>
                    <select
                      id="aides-source"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={source}
                      onChange={(e) => handleParamChange('source', e.target.value)}
                    >
                      <option value="">{t('aides:filters.source_all', 'Toutes les sources')}</option>
                      <option value="aides-territoires">Aides Territoires</option>
                      <option value="drees">DREES</option>
                      <option value="grand-est">Grand Est</option>
                      <option value="agefiph">Agefiph</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aides-sort" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.sort', 'Trier')}
                    </label>
                    <select
                      id="aides-sort"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={sort}
                      onChange={(e) => handleParamChange('sort', e.target.value)}
                    >
                      <option value="quality">{t('aides:sort.quality', 'Qualité')}</option>
                      <option value="recent">{t('aides:sort.recent', 'Récents')}</option>
                      <option value="relevance" disabled={!q}>
                        {q ? t('aides:sort.relevance', 'Pertinence') : t('aides:sort.relevance_needs_query', 'Pertinence (nécessite une recherche)')}
                      </option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aides-limit" className="block text-sm font-semibold text-slate-900 mb-1">
                      {t('aides:filters.per_page', 'Par page')}
                    </label>
                    <select
                      id="aides-limit"
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
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    {t('aides:filters.reset', 'Réinitialiser')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsFiltersOpen(false)}>
                    {t('aides:filters.close', 'Fermer')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Main content: sidebar + results */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Sidebar FilterPanel */}
          <aside className="w-full shrink-0 lg:w-64" aria-label={t('aides:filters.region_label', 'Filtres de recherche')}>
            <FilterPanel
              showSearch={false}
              filters={localFilters}
              onChange={setLocalFilters}
              onReset={resetLocalFilters}
            />
          </aside>

          {/* Results column */}
          <section className="min-w-0 flex-1" aria-label={t('aides:list.results_label', 'Résultats des aides')}>
            {/* Error state */}
            {isError && (
              <EmptyState
                title={t('aides:error.title', 'Impossible de charger les aides')}
                description={errorText}
                icon={<RotateCcw className="h-6 w-6" />}
                actions={
                  <Button type="button" variant="outline" onClick={() => refetch()}>
                    <RotateCcw className="me-2 h-4 w-4" />
                    {t('aides:error.retry', 'Réessayer')}
                  </Button>
                }
                role="alert"
                data-testid="aides-error-state"
              />
            )}

            {/* Loading state — show skeletons */}
            {isLoading && !isError && (
              <div className="space-y-3" data-testid="aides-loading-state">
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <div key={value} className="rounded-xl border border-border bg-card p-5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-3 h-5 w-3/4" />
                    <Skeleton className="mt-2 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-2/3" />
                  </div>
                ))}
              </div>
            )}

            {/* Success state */}
            {isSuccess && !isError && (() => {
              return (
                <>
                  {filteredItems.length > 0 && (
                    <p className="mb-4 text-sm text-muted-foreground" data-testid="aides-success-state">
                      {t('aides:list.results', { count: pagination?.total ?? filteredItems.length, defaultValue_one: '{{count}} aide trouvée.', defaultValue_other: '{{count}} aides trouvées.' })}
                    </p>
                  )}

                  {/* Empty without active filters */}
                  {filteredItems.length === 0 && !hasAnyFilters && (
                    <div className="my-8" data-testid="aides-empty-neutral">
                      <EmptyState
                        title={t('aides:empty.none_title', 'Aucune aide disponible pour le moment')}
                        description={t('aides:empty.none_text', "Notre catalogue d'aides est en cours de mise à jour. N'hésitez pas à revenir plus tard.")}
                        icon={<Search className="h-6 w-6" />}
                      />
                      <OfficialResourcesNotice />
                    </div>
                  )}

                  {/* Empty with active filters — EmptyState via AidGrid */}
                  {/* D-5: a search or filter that matches nothing still points to the official portals (never a dead end, never a fabricated record) */}
                  {filteredItems.length === 0 && hasAnyFilters && (
                    <div data-testid="aides-empty-filtered">
                      <AidGrid
                        items={[]}
                        hasActiveFilters={true}
                        onReset={() => { clearFilters(); resetLocalFilters(); }}
                      />
                      <NoResultsHelp kind="aides" q={q} />
                      <OfficialResourcesNotice />
                    </div>
                  )}

                  {/* Items grid */}
                  {filteredItems.length > 0 && (
                    <AidGrid
                      items={filteredItems}
                      hasActiveFilters={hasAnyFilters}
                      onReset={() => { clearFilters(); resetLocalFilters(); }}
                    />
                  )}

                  {/* Pagination */}
                  {filteredItems.length > 0 && totalPages > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-center mt-10 gap-3">
                      <Button
                        variant="outline"
                        disabled={page <= 1}
                        onClick={() => handlePageChange(page - 1)}
                      >
                        {t('aides:pagination.previous', 'Précédent')}
                      </Button>
                      <span className="flex items-center px-4 text-sm font-medium text-foreground">
                        {t('aides:pagination.page', 'Page {{page}} / {{total}}', { page, total: totalPages })}
                      </span>
                      <Button
                        variant="outline"
                        disabled={!hasNext}
                        onClick={() => handlePageChange(page + 1)}
                      >
                        {t('aides:pagination.next', 'Suivant')}
                      </Button>
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        </div>
      </div>
    </div>
  );
}
