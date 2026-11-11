// @ts-nocheck
import OfficialResourcesNotice from '@/components/OfficialResourcesNotice';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { track } from '@vercel/analytics';
import { Search, RotateCcw } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { ActiveFilters, CatalogBody, ChoiceChips, FilterField, HeroSearch, InlineSelect, MobileFilters, Pager, ResultsBar, SELECT } from '@/components/layout/catalog';
import { Skeleton } from '@/components/ui/skeleton';
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

// 11/11/2026: only the urgency remains local state. The old sidebar « Catégorie » kept a slug and looked for it inside titles (« social-sante » in
// « Revenu de solidarité active »): any choice emptied the list. The category is now the API filter (chips), the same as the old top select.
const INITIAL_LOCAL_FILTERS = { urgentOnly: false };

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
  const [localFilters, setLocalFilters] = useState(INITIAL_LOCAL_FILTERS);

  const hasActiveLocalFilters = localFilters.urgentOnly;

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
  // the API applies every filter (category, situation, territory, urgency): nothing is filtered again in the browser
  const filteredItems = apiItems;

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

  const categoryOptions = [
    { value: '', label: t('aides:filters.all', 'Toutes') },
    ...(taxonomy?.categories || []).map((/** @type {{ label: string, slug: string }} */ cat) => ({ value: cat.slug, label: categoryText(cat), lang: categoryLang(cat) })),
  ];
  const situationLabel = (code) => taxonomy?.aidSituations?.find((/** @type {{ code: string; slug: string; }} */ s) => s.code === code || s.slug === code)?.label || code;
  const territoryLabel = (value) => territoryOptions.find((o) => o.value === value)?.label || value;
  const activeFilters = [
    q && { key: 'q', label: `« ${q} »`, onRemove: () => handleParamChange('q', '') },
    category && !categorySlug && { key: 'category', label: (categoryOptions.find((o) => o.value === category) || { label: category }).label, lang: (categoryOptions.find((o) => o.value === category) || {}).lang, onRemove: () => handleParamChange('category', '') },
    situation && { key: 'situation', label: situationLabel(situation), lang: 'fr', onRemove: () => handleParamChange('situation', '') },
    territory && !territorySlug && { key: 'territory', label: territoryLabel(territory), onRemove: () => handleParamChange('territory', '') },
    localFilters.urgentOnly && { key: 'urgent', label: t('aides:filters.urgent_only', 'Urgence uniquement'), onRemove: () => setLocalFilters({ ...localFilters, urgentOnly: false }) },
  ].filter(Boolean);
  const resetAll = () => { clearFilters(); resetLocalFilters(); };

  /** the filter fields, in the sidebar (prefix '') and in the phone sheet (prefix 'm-'); the categories are the chips above the results @param {string} prefix */
  const renderFilters = (prefix) => (
    <div className="space-y-5">
      <FilterField id={`${prefix}aides-situation`} label={t('aides:filters.situation', 'Situation')}>
        <select id={`${prefix}aides-situation`} className={SELECT} value={situation} onChange={(e) => handleParamChange('situation', e.target.value)}>
          <option value="">{t('aides:filters.all', 'Toutes')}</option>
          {/* the situations are named by the API (French) */}
          {(taxonomy?.aidSituations || []).map((/** @type {{ code: string | number, label: string | number }} */ sit) => (
            <option key={sit.code} value={sit.code} lang="fr">{sit.label}</option>
          ))}
        </select>
      </FilterField>
      <FilterField id={`${prefix}aides-territory`} label={t('aides:filters.territory', 'Territoire')}>
        <select id={`${prefix}aides-territory`} className={SELECT} value={territory} onChange={(e) => handleParamChange('territory', e.target.value)}>
          {territoryOptions.map((opt) => <option key={opt.value || 'all'} value={opt.value} lang={opt.lang}>{opt.label}</option>)}
        </select>
      </FilterField>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-slate-900">{t('aides:filters.priority', 'Priorité')}</legend>
        <label htmlFor={`${prefix}filter-urgent`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
          <input id={`${prefix}filter-urgent`} type="checkbox" checked={localFilters.urgentOnly} onChange={(e) => setLocalFilters({ ...localFilters, urgentOnly: e.target.checked })}
            className="h-5 w-5 rounded border-slate-400 accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" />
          {t('aides:filters.urgent_only', 'Urgence uniquement')}
        </label>
      </fieldset>
      {hasAnyFilters && <Button type="button" variant="ghost" className="h-11 w-full" onClick={resetAll}>{t('aides:filters.reset_all', 'Réinitialiser les filtres')}</Button>}
    </div>
  );

  const countText = t('aides:list.results', { count: pagination?.total ?? filteredItems.length, defaultValue_one: '{{count}} aide trouvée.', defaultValue_other: '{{count}} aides trouvées.' });

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

      <PageHeader
        title={
          /* Q10: the address is never echoed into the heading — only a known theme / commune is named */
          !categorySlug
            ? t('aides:list.title', 'Aides sociales')
            : themeKnown
              ? (communeKnown
                ? t('aides:list.title_theme_commune', 'Aides : {{theme}} à {{commune}}', { theme: categoryText(themeKnown), commune: communeKnown })
                : t('aides:list.title_theme', 'Aides : {{theme}}', { theme: categoryText(themeKnown) }))
              : taxonomy ? t('aides:list.title', 'Aides sociales') : t('aides:list.title_short', 'Aides')
        }
        description={
          <>
            {categorySlug && taxonomy && !themeKnown ? (
              <span className="mb-1 block text-white" data-testid="aides-unknown-theme">
                {t('aides:list.unknown_theme', "Ce thème n'est pas reconnu.")} <Link to="/aides" className="underline underline-offset-2">{t('aides:list.see_all', 'Voir toutes les aides')}</Link>
              </span>
            ) : null}
            {categorySlug && territorySlug
              ? t('aides:list.intro_territory', 'Explorez les dispositifs et accompagnements disponibles pour votre région.')
              : t('aides:list.intro', 'Filtrez par catégorie, situation ou territoire, ou lancez une recherche.')}
          </>
        }
      >
        <HeroSearch
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={() => handleSearchSubmit({ preventDefault() {} })}
          label={t('aides:search.label', 'Rechercher une aide')}
          placeholder={t('aides:search.placeholder', 'Rechercher une aide (ex: APL, CSS, Visale...)')}
          submitLabel={t('aides:search.submit', 'Rechercher')}
        >
          <Link to="/recherche" className="ada-target font-semibold text-white underline-offset-2 hover:underline">
            {t('aides:list.smart_search', 'Recherche intelligente')}
          </Link>
          <span>
            <Trans
              i18n={i18n}
              i18nKey="aides:list.glossary_tip"
              defaults="Astuce : consultez notre <0>glossaire</0> pour comprendre les sigles (RSA, APL, AAH...)"
              components={[<Link key="glossaire" to="/glossaire" className="font-semibold text-white underline underline-offset-2" />]}
            />
          </span>
        </HeroSearch>
      </PageHeader>

      <CatalogBody sidebar={renderFilters('')} sidebarLabel={t('aides:filters.region_label', 'Filtres de recherche')}>
        {!categorySlug && (
          <div className="mb-5">
            <ChoiceChips label={t('aides:filters.category', 'Catégorie')} options={categoryOptions} value={category} onChange={(v) => handleParamChange('category', v)} testId="aides-category-chips" />
          </div>
        )}
        <ResultsBar summary={isSuccess && filteredItems.length > 0 ? <span data-testid="aides-success-state">{countText}</span> : null}>
          <MobileFilters title={t('aides:filters.title', 'Filtres')} count={[situation, territory && !territorySlug, localFilters.urgentOnly].filter(Boolean).length} render={renderFilters} onReset={resetAll} />
          <InlineSelect id="aides-sort" label={t('aides:filters.sort', 'Trier')} value={sort} onChange={(v) => handleParamChange('sort', v)}>
            <option value="quality">{t('aides:sort.quality', 'Qualité')}</option>
            <option value="recent">{t('aides:sort.recent', 'Récents')}</option>
            <option value="relevance" disabled={!q}>
              {q ? t('aides:sort.relevance', 'Pertinence') : t('aides:sort.relevance_needs_query', 'Pertinence (nécessite une recherche)')}
            </option>
          </InlineSelect>
          <InlineSelect id="aides-limit" label={t('aides:filters.per_page', 'Par page')} value={String(limit)} onChange={(v) => handleParamChange('limit', v)}>
            {LIMIT_OPTIONS.map((opt) => <option key={opt} value={String(opt)}>{opt}</option>)}
          </InlineSelect>
        </ResultsBar>
        <ActiveFilters items={activeFilters} onClear={resetAll} />

        <section className="min-w-0" aria-label={t('aides:list.results_label', 'Résultats des aides')}>
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
            <div className="grid gap-5 sm:grid-cols-2" data-testid="aides-loading-state">
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <div key={value} className="rounded-2xl border border-border bg-card p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-3 h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {/* Success state */}
          {isSuccess && !isError && (
            <>
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
                    onReset={resetAll}
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
                  onReset={resetAll}
                />
              )}

              {/* Pagination */}
              {filteredItems.length > 0 && (
                <Pager
                  page={page}
                  totalPages={totalPages}
                  hasNext={hasNext}
                  onPage={handlePageChange}
                  label={t('aides:pagination.nav', 'Pages des aides')}
                  previous={t('aides:pagination.previous', 'Précédent')}
                  next={t('aides:pagination.next', 'Suivant')}
                  status={t('aides:pagination.page', 'Page {{page}} / {{total}}', { page, total: totalPages })}
                />
              )}
            </>
          )}
        </section>
      </CatalogBody>
    </div>
  );
}
