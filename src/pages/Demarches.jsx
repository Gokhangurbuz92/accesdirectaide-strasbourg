import OfficialResourcesNotice from '@/components/OfficialResourcesNotice';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, RotateCcw } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { ActiveFilters, CatalogBody, FilterField, HeroSearch, InlineSelect, MobileFilters, Pager, ResultsBar, SELECT } from '@/components/layout/catalog';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import NoResultsHelp from '@/components/search/NoResultsHelp';
import DemarcheCard from '@/components/cards/DemarcheCard';
import { generateBreadcrumbSchema } from '@/utils/schema';
import { useT } from '@/i18n';

/** @typedef {{ slug: string, label: string }} TaxonomyItem */
/** @typedef {{ categories?: TaxonomyItem[], situations?: TaxonomyItem[] }} TaxonomyData */
/** @typedef {{ slug?: string, label?: string }} CategoryRef */
/** @typedef {{ id: string, slug?: string | null, titre?: string, description_courte?: string | null, summary_falc?: string | null, category?: CategoryRef | null }} DemarcheListItem */
/** @typedef {{ total?: number, page?: number, limit?: number, pageSize?: number, totalPages?: number, hasNext?: boolean }} Pagination */

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50];

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

export default function Demarches() {
  const { t } = useT('demarches');
  const [searchParams, setSearchParams] = useSearchParams();

  const q = (searchParams.get('q') || '').trim();
  const category = (searchParams.get('category') || searchParams.get('theme') || '').trim();
  const situation = (searchParams.get('situation') || '').trim();
  const page = parsePage(searchParams.get('page'));
  const limit = parseLimit(searchParams.get('limit') || searchParams.get('pageSize'));
  const sort = (searchParams.get('sort') || (q ? 'relevance' : 'quality')).trim();

  const [queryInput, setQueryInput] = useState(q);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  // Fetch Taxonomy
  const { data: taxonomy } = useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => client.taxonomy.get(),
  });

  /** @type {TaxonomyData | undefined} */
  const taxonomyData = taxonomy;

  // Fetch Demarches (Server-side)
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['demarches', { q, category, situation, sort, page, limit }],
    queryFn: () => client.entities.Demarche.filter({
      q,
      category,
      situation,
      sort,
      page,
      limit,
    }),
  });

  /** @type {DemarcheListItem[]} */
  const items = data?.items || [];
  /** @type {Pagination} */
  const pagination = data?.pagination || {};

  const liveMessage = useMemo(() => {
    if (isLoading || isFetching) return t('demarches:list.live.loading', 'Chargement des démarches...');
    if (error) return t('demarches:list.live.error', "Erreur lors du chargement des démarches.");
    if (!items.length) return t('demarches:list.live.empty', 'Aucune démarche trouvée.');
    const total = typeof pagination.total === 'number' ? pagination.total : items.length;
    return t('demarches:list.count', { count: total, defaultValue_one: '{{count}} démarche trouvée.', defaultValue_other: '{{count}} démarches trouvées.' });
  }, [isLoading, isFetching, error, items.length, pagination.total, t]);

  /**
   * @param {string} key
   * @param {string} value
   */
  const handleParamChange = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    if (key !== 'page') {
      newParams.set('page', '1');
    }
    setSearchParams(newParams);
  };

  const clearFilters = () => {
    setSearchParams({});
  };

  const getTitle = () => {
    if (q) return t('demarches:seo.title_query', 'Démarches - {{q}}', { q });
    if (category && taxonomyData) {
      const cat = taxonomyData.categories?.find((c) => c.slug === category);
      if (cat) return t('demarches:seo.title_category', 'Démarches - {{category}}', { category: cat.label });
    }
    if (situation && taxonomyData) {
      const sit = taxonomyData.situations?.find((s) => s.slug === situation);
      if (sit) return t('demarches:seo.title_situation', 'Démarches pour : {{situation}}', { situation: sit.label });
    }
    return t('demarches:seo.title', 'Démarches administratives');
  };

  const getDescription = () => {
    if (q) return t('demarches:seo.description_query', 'Résultats pour la recherche "{{q}}" sur les démarches disponibles.', { q });
    if (category && taxonomyData) {
      const cat = taxonomyData.categories?.find((c) => c.slug === category);
      if (cat) return t('demarches:seo.description_category', 'Toutes les démarches administratives et guides pas à pas pour la catégorie {{category}}.', { category: cat.label });
    }
    if (situation && taxonomyData) {
      const sit = taxonomyData.situations?.find((s) => s.slug === situation);
      if (sit) return t('demarches:seo.description_situation', 'Guides et démarches pour votre situation : {{situation}}.', { situation: sit.label });
    }
    return t('demarches:seo.description', 'Besoin d\'aide pour vos démarches ? Retrouvez nos guides pas à pas pour la CAF, le RSA, vos papiers d\'identité et plus encore.');
  };

  const schema = useMemo(() => {
    return [
      generateBreadcrumbSchema([
        { name: t('demarches:breadcrumb.home', 'Accueil'), url: '/' },
        { name: t('demarches:breadcrumb.demarches', 'Démarches'), url: '/demarches' },
      ]),
    ].filter(Boolean);
  }, [t]);

  const hasFilters = Boolean(q || category || situation);
  const categoryName = (/** @type {string} */ slug) => taxonomyData?.categories?.find((c) => c.slug === slug)?.label || slug;
  const situationName = (/** @type {string} */ slug) => taxonomyData?.situations?.find((c) => c.slug === slug)?.label || slug;
  /** @typedef {{ key: string, label: string, onRemove: () => void, lang?: string }} ActiveFilter */
  /** @type {ActiveFilter[]} */
  const activeFilters = /** @type {ActiveFilter[]} */ ([
    q && { key: 'q', label: `« ${q} »`, onRemove: () => handleParamChange('q', '') },
    category && { key: 'category', label: categoryName(category), lang: 'fr', onRemove: () => handleParamChange('category', '') },
    situation && { key: 'situation', label: situationName(situation), lang: 'fr', onRemove: () => handleParamChange('situation', '') },
  ].filter(Boolean));

  /** the filter fields, drawn in the sidebar (prefix '') and in the phone sheet (prefix 'm-') @param {string} prefix */
  // 11/11/2026: the « Source » select was removed — /api/demarches has no source parameter (searchDemarchesSchema), so it changed the address and
  // nothing else; a control that does nothing misleads
  const renderFilters = (prefix) => (
    <div className="space-y-5">
      <FilterField id={`${prefix}demarches-category`} label={t('demarches:filters.category', 'Catégorie')}>
        <select id={`${prefix}demarches-category`} className={SELECT} value={category} onChange={(e) => handleParamChange('category', e.target.value)}>
          <option value="">{t('demarches:filters.all', 'Toutes')}</option>
          {(taxonomyData?.categories || []).map((cat) => <option key={cat.slug} value={cat.slug}>{cat.label}</option>)}
        </select>
      </FilterField>
      <FilterField id={`${prefix}demarches-situation`} label={t('demarches:filters.situation', 'Situation')}>
        <select id={`${prefix}demarches-situation`} className={SELECT} value={situation} onChange={(e) => handleParamChange('situation', e.target.value)}>
          <option value="">{t('demarches:filters.all', 'Toutes')}</option>
          {(taxonomyData?.situations || []).map((sit) => <option key={sit.slug} value={sit.slug}>{sit.label}</option>)}
        </select>
      </FilterField>
      {hasFilters && (
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={clearFilters}>{t('demarches:filters.reset', 'Réinitialiser')}</Button>
      )}
    </div>
  );

  const countText = t('demarches:list.count', { count: pagination.total ?? items.length, defaultValue_one: '{{count}} démarche trouvée.', defaultValue_other: '{{count}} démarches trouvées.' });

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO
        title={getTitle()}
        description={getDescription()}
        path="/demarches"
        schema={schema}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <PageHeader
        title={t('demarches:list.title', 'Démarches')}
        description={t('demarches:list.intro', 'Trouvez une démarche, filtrez par catégorie ou situation, et accédez aux liens officiels.')}
      >
        <HeroSearch
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={() => handleParamChange('q', queryInput.trim())}
          label={t('demarches:search.label', 'Rechercher une démarche')}
          placeholder={t('demarches:search.placeholder', 'Rechercher une démarche (ex: passeport, RSA...)')}
          submitLabel={t('demarches:search.submit', 'Rechercher')}
          inputTestId="demarches-search-input"
          submitTestId="demarches-search-submit"
        />
      </PageHeader>

      <CatalogBody sidebar={renderFilters('')} sidebarLabel={t('demarches:filters.toggle', 'Filtres')}>
        <ResultsBar summary={!error && !isLoading && items.length > 0 ? <span data-testid="demarches-success-state">{countText}</span> : null}>
          <MobileFilters title={t('demarches:filters.toggle', 'Filtres')} count={activeFilters.filter((f) => f.key !== 'q').length} render={renderFilters} onReset={clearFilters} />
          <InlineSelect id="demarches-sort" label={t('demarches:filters.sort', 'Trier')} value={sort} onChange={(v) => handleParamChange('sort', v)}>
            <option value="quality">{t('demarches:filters.sort_quality', 'Qualité')}</option>
            <option value="recent">{t('demarches:filters.sort_recent', 'Récents')}</option>
            <option value="relevance" disabled={!q}>
              {t('demarches:filters.sort_relevance', 'Pertinence')} {q ? '' : t('demarches:filters.needs_query', '(nécessite une recherche)')}
            </option>
          </InlineSelect>
          <InlineSelect id="demarches-limit" label={t('demarches:filters.per_page', 'Par page')} value={String(limit)} onChange={(v) => handleParamChange('limit', v)}>
            {LIMIT_OPTIONS.map((opt) => <option key={opt} value={String(opt)}>{opt}</option>)}
          </InlineSelect>
        </ResultsBar>
        <ActiveFilters items={activeFilters} onClear={clearFilters} />

        {error && (
          <EmptyState
            title={t('demarches:error.title', 'Impossible de charger les démarches')}
            description={t('demarches:error.description', 'Vérifiez votre connexion puis réessayez.')}
            icon={<RotateCcw className="h-6 w-6" />}
            actions={
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RotateCcw className="me-2 h-4 w-4" />
                {t('demarches:error.retry', 'Réessayer')}
              </Button>
            }
            role="alert"
            data-testid="demarches-error-state"
          />
        )}

        {isLoading && !error && (
          <div className="grid gap-5 md:grid-cols-2" data-testid="demarches-loading-state">
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-white p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-5 w-3/4" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {!error && !isLoading && !isFetching && items.length === 0 && (
          <div data-testid="demarches-empty-state">
            <OfficialResourcesNotice />
            <EmptyState
              title={hasFilters ? t('demarches:empty.title_filtered', "Aucune démarche trouvée") : t('demarches:empty.title', "Démarches en cours d'intégration")}
              description={
                hasFilters
                  ? t('demarches:empty.description_filtered', "Essayez une autre recherche ou ajustez les filtres.")
                  : t('demarches:empty.description', "Notre catalogue de démarches est en cours de constitution. En attendant, les sites officiels ci-dessus et les structures d’accompagnement de l’annuaire peuvent vous aider.")
              }
              icon={<Search className="h-6 w-6" />}
              actions={
                hasFilters ? (
                  <Button type="button" variant="outline" onClick={clearFilters} data-testid="empty-reset">
                    {t('demarches:empty.reset', 'Réinitialiser les filtres')}
                  </Button>
                ) : undefined
              }
              data-testid="demarches-empty-component"
            />
            {hasFilters && <NoResultsHelp kind="demarches" q={q} />}
            {/* launch-readiness item 58: this pointed to the orientation assistant, whose calculation needs the OpenFisca engine that production does not have
                (it answers 503 there); the directory of support structures works */}
            {!hasFilters && (
              <div className="mt-4 flex justify-center">
                <Link to="/structures">
                  <Button variant="outline" className="gap-2" data-testid="demarches-empty-directory">
                    {t('demarches:empty.directory', "Trouver une structure d'accompagnement")}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}

        {!error && !isLoading && items.length > 0 && (
          <>
            <div className={`grid gap-5 md:grid-cols-2 ${isFetching ? 'opacity-60 transition-opacity' : ''}`} aria-busy={isFetching || undefined} data-testid="demarches-results-list">
              {items.map((demarche) => (
                <DemarcheCard key={demarche.id} demarche={demarche} />
              ))}
            </div>

            <Pager
              page={page}
              totalPages={pagination.totalPages || 1}
              hasNext={pagination.hasNext != null ? Boolean(pagination.hasNext) : page < (pagination.totalPages || 1)}
              onPage={(p) => handleParamChange('page', String(p))}
              label={t('demarches:pagination.nav', 'Pages des démarches')}
              previous={t('demarches:pagination.previous', 'Précédent')}
              next={t('demarches:pagination.next', 'Suivant')}
              status={t('demarches:pagination.page', 'Page {{page}} sur {{total}}', { page, total: pagination.totalPages || 1 })}
            />
          </>
        )}
      </CatalogBody>
    </div>
  );
}
