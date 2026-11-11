// @ts-nocheck
import OfficialResourcesNotice from '@/components/OfficialResourcesNotice';
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { List, Map as MapIcon } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { ActiveFilters, CatalogBody, ChoiceChips, FilterField, HeroSearch, InlineSelect, MobileFilters, Pager, ResultsBar, TEXT_INPUT } from '@/components/layout/catalog';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import NoResultsHelp from '@/components/search/NoResultsHelp';
import StructureCard from '@/components/cards/StructureCard';
import { generateBreadcrumbSchema } from '@/utils/schema';
import { useT } from '@/i18n';
import serviceTerritory from '../../data/geography/service-territory.v1.json';

const StructureMap = React.lazy(() => import('../components/StructureMap'));

const DEFAULT_LIMIT = 12;
const LIMIT_OPTIONS = [12, 24, 48];

// R32: `label` is the French label; typeLabel() gives it in the interface language (the names of public bodies and the acronyms are not translated)
const TYPE_STRUCTURES = [
  { value: '', label: 'Tous les types' },
  { value: 'association', label: 'Association' },
  { value: 'service_public', label: 'Service public' },
  { value: 'etablissement_sante', label: 'Établissement de santé' },
  { value: 'mairie', label: 'Mairie' },
  { value: 'caf', label: 'CAF' },
  { value: 'mdph', label: 'MDPH' },
  { value: 'france_travail', label: 'France Travail' },
  { value: 'cpam', label: 'CPAM' },
  { value: 'ccas', label: 'CCAS' },
  { value: 'ehpad', label: 'EHPAD' },
  { value: 'france_services', label: 'France Services' },
  { value: 'carsat', label: 'CARSAT' },
  { value: 'mission_locale', label: 'Mission Locale' },
  { value: 'pmi', label: 'PMI' },
];

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

export default function Annuaire() {
  const { t } = useT('structures');
  const [searchParams, setSearchParams] = useSearchParams();
  // PKG-11 / P28: a link that arrives with a location filter (e.g. from /territoire) shows it, so the person knows the list is filtered
  // PKG-11 / P28: a link that arrives with a location filter (e.g. from /territoire) shows it — 11/11/2026: as an active-filter chip above the results
  // (and in the always-visible sidebar from `lg`), so the person knows the list is filtered
  const [viewMode, setViewMode] = useState('list');

  const q = (searchParams.get('q') || '').trim();
  const type = (searchParams.get('type') || '').trim();
  const city = (searchParams.get('city') || '').trim();
  const departement = (searchParams.get('departement') || searchParams.get('territory') || searchParams.get('geo') || '').trim();
  // PKG-11 / E05: an INSEE commune code — only the places whose REVIEWED service area covers that commune (not just the places located there)
  const serves = /^(\d{5}|2[AB]\d{3})$/.test((searchParams.get('serves') || '').trim()) ? searchParams.get('serves').trim() : '';
  const servesName = serves ? (/** @type {[string, string][]} */ (serviceTerritory.communes).find(([code]) => code === serves) || [])[1] || '' : '';
  const pmrRaw = (searchParams.get('pmr') || '').trim();
  const pmrEnabled = pmrRaw === '1' || pmrRaw === 'true';
  const page = parsePage(searchParams.get('page'));
  const limit = parseLimit(searchParams.get('limit') || searchParams.get('pageSize'));
  const sort = (searchParams.get('sort') || (q ? 'relevance' : 'quality')).trim();

  const [queryInput, setQueryInput] = useState(q);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['structures', { q, type, city, departement, serves, pmr: pmrEnabled, sort, page, limit }],
    queryFn: () => client.entities.Structure.filter({
      q: q || undefined,
      type: type || undefined,
      city: city || undefined,
      departement: departement || undefined,
      serves: serves || undefined,
      pmr: pmrEnabled ? '1' : undefined,
      sort,
      page,
      limit,
    }),
  });

  const structures = data?.items || [];
  const pagination = data?.pagination || {};

  const liveMessage = useMemo(() => {
    if (isLoading || isFetching) return t('structures:list.live.loading', "Chargement de l'annuaire...");
    if (error) return t('structures:list.live.error', "Erreur lors du chargement de l'annuaire.");
    if (!structures.length) return t('structures:list.live.empty', 'Aucune structure trouvée.');
    const total = typeof pagination.total === 'number' ? pagination.total : structures.length;
    return t('structures:list.count', { count: total, defaultValue_one: '{{count}} structure trouvée.', defaultValue_other: '{{count}} structures trouvées.' });
  }, [isLoading, isFetching, error, structures.length, pagination.total, t]);

  /** a type of structure in the interface language @param {{ value: string, label: string }} opt */
  const typeLabel = (opt) => {
    switch (opt.value) {
      case '': return t('structures:types.all', 'Tous les types');
      case 'association': return t('structures:types.association', 'Association');
      case 'service_public': return t('structures:types.service_public', 'Service public');
      case 'etablissement_sante': return t('structures:types.etablissement_sante', 'Établissement de santé');
      case 'mairie': return t('structures:types.mairie', 'Mairie');
      default: return opt.label;   // CAF, MDPH, France Travail, CPAM, CCAS, EHPAD, France Services, CARSAT, Mission Locale, PMI
    }
  };

  /**
   * @param {string} key
   * @param {string} value
   */
  const handleParamChange = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') {
      params.set('page', '1');
    }
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearchParams({});
  };

  const handlePageChange = (/** @type {number} */ nextPage) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(nextPage));
    setSearchParams(params);
  };

  const schema = useMemo(() => {
    return [
      generateBreadcrumbSchema([
        { name: t('structures:breadcrumb.home', 'Accueil'), url: '/' },
        { name: t('structures:breadcrumb.directory', 'Annuaire'), url: '/annuaire' },
      ]),
    ].filter(Boolean);
  }, [t]);

  const hasNext = Boolean(pagination.hasNext);
  const totalPages = pagination.totalPages || 1;

  const typeOptions = TYPE_STRUCTURES.map((opt) => ({ value: opt.value, label: opt.value ? typeLabel(opt) : t('structures:filters.all', 'Tous') }));
  const activeFilters = [
    q && { key: 'q', label: `« ${q} »`, onRemove: () => handleParamChange('q', '') },
    type && { key: 'type', label: typeLabel(TYPE_STRUCTURES.find((o) => o.value === type) || { value: type, label: type }), onRemove: () => handleParamChange('type', '') },
    city && { key: 'city', label: city, lang: 'fr', onRemove: () => handleParamChange('city', '') },
    departement && { key: 'departement', label: departement, onRemove: () => handleParamChange('departement', '') },
    pmrEnabled && { key: 'pmr', label: t('structures:filters.pmr_only', 'Accessible PMR uniquement'), onRemove: () => handleParamChange('pmr', '') },
  ].filter(Boolean);

  /** the place filters, in the sidebar (prefix '') and in the phone sheet (prefix 'm-'); the types are the chips above the results @param {string} prefix */
  const renderFilters = (prefix) => (
    <div className="space-y-5">
      <FilterField id={`${prefix}structures-city`} label={t('structures:filters.city', 'Ville')}>
        <input id={`${prefix}structures-city`} type="text" className={TEXT_INPUT} value={city} onChange={(e) => handleParamChange('city', e.target.value)}
          placeholder={t('structures:filters.city_placeholder', 'Ex: Strasbourg')} autoComplete="off" />
      </FilterField>
      <FilterField id={`${prefix}structures-departement`} label={t('structures:filters.departement', 'Département')}>
        <input id={`${prefix}structures-departement`} type="text" inputMode="numeric" className={TEXT_INPUT} value={departement} onChange={(e) => handleParamChange('departement', e.target.value)}
          placeholder={t('structures:filters.departement_placeholder', 'Ex: 67')} autoComplete="off" />
      </FilterField>
      <label htmlFor={`${prefix}structures-pmr`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
        <input id={`${prefix}structures-pmr`} type="checkbox" className="h-5 w-5 rounded border-slate-400 accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          checked={pmrEnabled} onChange={(e) => handleParamChange('pmr', e.target.checked ? '1' : '')} />
        {t('structures:filters.pmr_only', 'Accessible PMR uniquement')}
      </label>
      {activeFilters.length > 0 && <Button type="button" variant="ghost" className="h-11 w-full" onClick={clearFilters}>{t('structures:filters.reset', 'Réinitialiser')}</Button>}
    </div>
  );

  /** list / map: a real tab pair (arrow keys move between the two, the panel is labelled by its tab) @param {import('react').KeyboardEvent} e */
  const onTabKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = viewMode === 'list' ? 'map' : 'list';
      setViewMode(next);
      document.getElementById(`annuaire-tab-${next}`)?.focus();
    }
  };
  const tabClass = (active) => `inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${active ? 'bg-white text-blue-900 shadow-subtle' : 'text-slate-700 hover:text-slate-900'}`;
  const total = typeof pagination.total === 'number' ? pagination.total : structures.length;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO
        title={t('structures:seo.title', 'Annuaire')}
        description={t('structures:seo.description', 'Trouvez des structures (associations, services publics) et leurs coordonnées.')}
        path="/structures"
        schema={schema}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <PageHeader title={t('structures:list.title', 'Annuaire')} description={t('structures:list.intro', 'Recherchez une structure et filtrez par type ou localisation.')}>
        <HeroSearch
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={() => handleParamChange('q', queryInput.trim())}
          label={t('structures:search.label', 'Rechercher une structure')}
          placeholder={t('structures:search.placeholder', 'Rechercher une structure (ex: médiation numérique, CCAS...)')}
          submitLabel={t('structures:search.submit', 'Rechercher')}
          inputTestId="structures-search-input"
          submitTestId="structures-search-submit"
        />
      </PageHeader>

      <CatalogBody sidebar={renderFilters('')} sidebarLabel={t('structures:filters.toggle', 'Filtres')}>
        <div className="mb-5">
          <ChoiceChips label={t('structures:filters.type', 'Type')} options={typeOptions} value={type} onChange={(v) => handleParamChange('type', v)} testId="structures-type-chips" />
        </div>

        <ResultsBar summary={!isLoading && !error && structures.length > 0
          ? t('structures:list.count', { count: total, defaultValue_one: '{{count}} structure trouvée.', defaultValue_other: '{{count}} structures trouvées.' }) : null}>
          <MobileFilters title={t('structures:filters.toggle', 'Filtres')} count={[city, departement, pmrEnabled].filter(Boolean).length} render={renderFilters} onReset={clearFilters} />
          <div role="tablist" aria-label={t('structures:view.label', 'Affichage')} className="inline-flex rounded-lg bg-slate-100 p-1">
            <button id="annuaire-tab-list" role="tab" type="button" aria-selected={viewMode === 'list'} aria-controls="annuaire-panel" tabIndex={viewMode === 'list' ? 0 : -1}
              className={tabClass(viewMode === 'list')} onClick={() => setViewMode('list')} onKeyDown={onTabKey}>
              <List className="h-4 w-4" aria-hidden="true" />{t('structures:view.list', 'Liste')}
            </button>
            <button id="annuaire-tab-map" role="tab" type="button" aria-selected={viewMode === 'map'} aria-controls="annuaire-panel" tabIndex={viewMode === 'map' ? 0 : -1}
              className={tabClass(viewMode === 'map')} onClick={() => setViewMode('map')} onKeyDown={onTabKey}>
              <MapIcon className="h-4 w-4" aria-hidden="true" />{t('structures:view.map', 'Carte')}
            </button>
          </div>
          <InlineSelect id="structures-sort" label={t('structures:filters.sort', 'Trier')} value={sort} onChange={(v) => handleParamChange('sort', v)}>
            <option value="quality">{t('structures:filters.sort_quality', 'Qualité')}</option>
            <option value="recent">{t('structures:filters.sort_recent', 'Récents')}</option>
            <option value="alpha">{t('structures:filters.sort_alpha', 'A-Z')}</option>
            <option value="relevance" disabled={!q}>
              {t('structures:filters.sort_relevance', 'Pertinence')} {q ? '' : t('structures:filters.needs_query', '(nécessite une recherche)')}
            </option>
          </InlineSelect>
          <InlineSelect id="structures-limit" label={t('structures:filters.per_page', 'Par page')} value={String(limit)} onChange={(v) => handleParamChange('limit', v)}>
            {LIMIT_OPTIONS.map((opt) => <option key={opt} value={String(opt)}>{opt}</option>)}
          </InlineSelect>
        </ResultsBar>
        <ActiveFilters items={activeFilters} onClear={clearFilters} />

        {serves && (
          <p className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900" data-testid="annuaire-serves-filter">
            {servesName
              ? t('structures:serves.named', "Lieux dont la zone d'intervention, vérifiée par ADA, couvre {{commune}} (code Insee {{code}}).", { commune: servesName, code: serves })
              : t('structures:serves.code', "Lieux dont la zone d'intervention, vérifiée par ADA, couvre la commune de code Insee {{code}}.", { code: serves })}
            <button type="button" className="min-h-11 font-semibold underline underline-offset-2" onClick={() => handleParamChange('serves', '')}>{t('structures:serves.remove', 'Retirer ce filtre')}</button>
          </p>
        )}

        <div id="annuaire-panel" role="tabpanel" aria-labelledby={`annuaire-tab-${viewMode}`}>
          {isLoading ? (
            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3" role="status" aria-label={t('structures:list.loading_results', 'Chargement des résultats')}>
              {Array.from({ length: Math.min(limit, 12) }).map((_, idx) => (
                <div key={idx} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              title={t('structures:error.title', "Impossible de charger l'annuaire")}
              description={t('structures:error.description', 'Vérifiez votre connexion puis réessayez.')}
              actions={
                <Button type="button" onClick={() => refetch()}>
                  {t('structures:error.retry', 'Réessayer')}
                </Button>
              }
              role="alert"
            />
          ) : structures.length > 0 ? (
            <>
              {viewMode === 'map' ? (
                <>
                  {/* N11: the map tiles come from OpenStreetMap's servers, only once the visitor chooses « Carte »; the page says so */}
                  <p className="mb-3 text-sm text-slate-600" data-testid="map-provider-notice">
                    {t('structures:map.provider_notice', 'Fonds de carte © OpenStreetMap. En affichant la carte, votre navigateur les charge depuis les serveurs de la fondation OpenStreetMap, qui reçoivent votre adresse IP. La vue « Liste » n’en charge aucun.')}
                  </p>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle">
                    <React.Suspense fallback={<div className="flex h-96 items-center justify-center text-slate-600">{t('structures:map.loading', 'Chargement de la carte…')}</div>}>
                      <StructureMap structures={structures} />
                    </React.Suspense>
                  </div>
                </>
              ) : (
                <div className={`grid gap-5 md:grid-cols-2 2xl:grid-cols-3 ${isFetching ? 'opacity-60 transition-opacity' : ''}`} aria-busy={isFetching || undefined} data-testid="structures-results-list">
                  {structures.map((/** @type {{ id: string | number }} */ s) => (
                    <StructureCard key={s.id} structure={s} />
                  ))}
                </div>
              )}

              <Pager
                page={page}
                totalPages={totalPages}
                hasNext={hasNext}
                onPage={handlePageChange}
                label={t('structures:pagination.nav', "Pages de l'annuaire")}
                previous={t('structures:pagination.previous', 'Précédent')}
                next={t('structures:pagination.next', 'Suivant')}
                status={t('structures:pagination.page', 'Page {{page}} / {{total}}', { page, total: totalPages })}
              />
            </>
          ) : (
            <EmptyState
              title={t('structures:empty.title', 'Aucune structure trouvée')}
              description={serves
                ? t('structures:empty.description_serves', "Aucune structure n'a encore une zone d'intervention vérifiée qui couvre cette commune. Les lieux situés dans la commune restent visibles sans ce filtre.")
                : t('structures:empty.description', "Nous n'avons trouvé aucune structure correspondant à vos critères.")}
              actions={<Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>{t('structures:empty.show_all', 'Voir toutes les structures')}</Button>}
              data-testid="annuaire-empty"
            />
          )}
          {!isLoading && !structures.length && (
            <NoResultsHelp kind="structures" q={q} />
          )}
          {!isLoading && !structures.length ? <OfficialResourcesNotice /> : null}
        </div>
      </CatalogBody>
    </div>
  );
}
