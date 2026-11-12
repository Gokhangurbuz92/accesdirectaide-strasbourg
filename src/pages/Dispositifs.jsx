import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import DispositifCard from '@/components/cards/DispositifCard';
import LoadError from '@/components/LoadError';
import PageHeader from '@/components/layout/PageHeader';
import EmptyCatalogue from '@/components/layout/EmptyCatalogue';
import { ActiveFilters, CatalogBody, ChoiceChips, FilterField, HeroSearch, MobileFilters, Pager, ResultsBar, SELECT } from '@/components/layout/catalog';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';

/**
 * Catalogue (12/11/2026) — « Dispositifs et guides officiels »: the local programmes verified on their organisation's page and, since the catalogue work, the
 * official Service-Public fiches that explain a right, a rule or a public programme (neither a benefit nor a procedure). Hundreds of records: the list is paged,
 * searchable and filtered on the server (/api/dispositifs?page=…), in the shared catalogue layout of Aides and Démarches.
 */
const LIMIT = 20;
/** @typedef {{ slug: string, label: string }} TaxonomyItem */
/** @param {unknown} v */
const parsePage = (v) => { const n = Number.parseInt(String(v ?? '1'), 10); return Number.isFinite(n) && n >= 1 ? n : 1; };

export default function Dispositifs() {
  const { t } = useT('dispositifs');
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') || '').trim();
  const category = (searchParams.get('category') || '').trim();
  const scope = ['local', 'national'].includes(searchParams.get('scope') || '') ? String(searchParams.get('scope')) : '';
  const page = parsePage(searchParams.get('page'));
  const [queryInput, setQueryInput] = useState(q);
  useEffect(() => { setQueryInput(q); }, [q]);

  const { data: taxonomy } = useQuery({ queryKey: ['taxonomy'], queryFn: () => client.taxonomy.get() });
  /** @type {TaxonomyItem[]} */
  const categories = /** @type {any} */ (taxonomy)?.categories || [];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['dispositifs', { q, category, scope, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (q) params.set('q', q); if (category) params.set('category', category); if (scope) params.set('scope', scope);
      const res = await fetch(`/api/dispositifs?${params}`);
      if (!res.ok) throw new Error(`dispositifs ${res.status}`);
      const body = await res.json();
      // an older server answers the plain array: paged here
      if (Array.isArray(body)) return { items: body.slice((page - 1) * LIMIT, page * LIMIT), pagination: { total: body.length, totalPages: Math.max(1, Math.ceil(body.length / LIMIT)), hasNext: page * LIMIT < body.length } };
      return body;
    },
  });
  /** @type {any[]} */
  const items = data?.items || [];
  const pagination = data?.pagination || {};
  const total = typeof pagination.total === 'number' ? pagination.total : items.length;

  /** @param {string} key @param {string} value */
  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };
  const clearFilters = () => setSearchParams({});
  const hasFilters = Boolean(q || category || scope);
  const categoryName = (/** @type {string} */ slug) => categories.find((c) => c.slug === slug)?.label || slug;
  const scopeOptions = [
    { value: '', label: t('dispositifs:scope.all', 'Tout') },
    { value: 'local', label: t('dispositifs:scope.local', 'Programmes locaux') },
    { value: 'national', label: t('dispositifs:scope.national', 'Règles et droits nationaux') },
  ];
  /** @typedef {{ key: string, label: string, onRemove: () => void, lang?: string }} ActiveFilter */
  /** @type {ActiveFilter[]} */
  const activeFilters = /** @type {ActiveFilter[]} */ ([
    q && { key: 'q', label: `« ${q} »`, onRemove: () => setParam('q', '') },
    category && { key: 'category', label: categoryName(category), lang: 'fr', onRemove: () => setParam('category', '') },
    scope && { key: 'scope', label: scopeOptions.find((o) => o.value === scope)?.label || scope, onRemove: () => setParam('scope', '') },
  ].filter(Boolean));

  /** @param {string} prefix */
  const renderFilters = (prefix) => (
    <div className="space-y-5">
      <FilterField id={`${prefix}dispositifs-category`} label={t('dispositifs:filters.category', 'Catégorie')}>
        <select id={`${prefix}dispositifs-category`} className={SELECT} value={category} onChange={(e) => setParam('category', e.target.value)}>
          <option value="">{t('dispositifs:filters.all', 'Toutes')}</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </select>
      </FilterField>
      {hasFilters && <Button type="button" variant="ghost" className="h-11 w-full" onClick={clearFilters}>{t('dispositifs:filters.reset', 'Réinitialiser')}</Button>}
    </div>
  );
  // 12/11/2026 — nothing published yet (total 0, no search or filter): the catalogue is still being prepared from the official sources. Said plainly, with
  // where to go meanwhile, instead of a bare « 0 dispositif ou guide » (the publication itself is a separate owner gate: the data and the API are unchanged).
  const preparing = !error && !isLoading && total === 0 && items.length === 0 && !hasFilters;
  const countText = t('dispositifs:list.count', { count: total, defaultValue_one: '{{count}} dispositif ou guide', defaultValue_other: '{{count}} dispositifs et guides' });
  const liveMessage = useMemo(() => (isLoading || isFetching ? t('dispositifs:list.loading', 'Chargement...') : error || preparing ? '' : countText), [isLoading, isFetching, error, preparing, countText, t]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO title={t('dispositifs:list.title2', 'Dispositifs et guides officiels')} description={t('dispositifs:seo.description2', 'Les programmes locaux et les fiches officielles qui expliquent vos droits et les règles qui s’appliquent.')} path="/dispositifs" />
      <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
      <PageHeader title={t('dispositifs:list.title2', 'Dispositifs et guides officiels')} description={t('dispositifs:list.intro2', 'Les programmes locaux de Strasbourg et du Bas-Rhin, et les fiches officielles de Service-Public.gouv.fr qui expliquent un droit, une règle ou un programme public.')}>
        <HeroSearch value={queryInput} onChange={setQueryInput} onSubmit={() => setParam('q', queryInput.trim())}
          label={t('dispositifs:search.label', 'Rechercher un dispositif ou un guide')} placeholder={t('dispositifs:search.placeholder', 'Ex. : congé parental, surendettement, tutelle…')}
          submitLabel={t('dispositifs:search.submit', 'Rechercher')} inputTestId="dispositifs-search-input" submitTestId="dispositifs-search-submit" maxLength={120} />
      </PageHeader>

      <CatalogBody sidebar={renderFilters('')} sidebarLabel={t('dispositifs:filters.toggle', 'Filtres')}>
        {!preparing && (
          <>
            <ChoiceChips label={t('dispositifs:scope.label', 'Portée')} options={scopeOptions} value={scope} onChange={(v) => setParam('scope', v)} testId="dispositifs-scope" />
            <ResultsBar summary={!error && !isLoading && items.length > 0 ? <span data-testid="dispositifs-count">{countText}</span> : null}>
              <MobileFilters title={t('dispositifs:filters.toggle', 'Filtres')} count={category ? 1 : 0} render={renderFilters} onReset={clearFilters} />
            </ResultsBar>
            <ActiveFilters items={activeFilters} onClear={clearFilters} />
          </>
        )}

        {error ? (
          <LoadError what={t('dispositifs:load.list', 'les dispositifs')} onRetry={() => refetch()} testId="dispositifs-error" />
        ) : isLoading ? (
          <div className="grid gap-5 md:grid-cols-2" data-testid="dispositifs-loading">
            {[1, 2, 3, 4].map((n) => <div key={n} className="rounded-2xl border border-slate-200 bg-white p-5"><Skeleton className="h-5 w-3/4" /><Skeleton className="mt-2 h-4 w-full" /></div>)}
          </div>
        ) : preparing ? (
          <EmptyCatalogue title={t('dispositifs:preparing.title', 'La liste des dispositifs et guides est en préparation')} testId="dispositifs-none-published" exclude={['aides', 'demarches', 'outils']}>
            <div role="status" data-testid="dispositifs-preparing">
              <p>{t('dispositifs:preparing.why', 'Cette liste est en cours de constitution à partir des sources officielles : chaque programme local et chaque fiche n’apparaît ici qu’après sa vérification sur la page officielle de l’organisme concerné. Aucun élément n’est encore publié.')}</p>
              <p className="mt-2">{t('dispositifs:preparing.meanwhile', 'En attendant, ces pages sont déjà disponibles :')}</p>
            </div>
            <ul className="mt-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6" data-testid="dispositifs-preparing-links">
              <li><Link to="/aides" className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-900">{t('dispositifs:preparing.aides', 'Aides')}</Link></li>
              <li><Link to="/demarches" className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-900">{t('dispositifs:preparing.demarches', 'Démarches')}</Link></li>
              <li><Link to="/outils#services-officiels" className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-900">{t('dispositifs:preparing.services', 'Services en ligne officiels (page Outils)')}</Link></li>
            </ul>
          </EmptyCatalogue>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center" data-testid="dispositifs-empty">
            <p role="status" className="text-slate-700">{hasFilters ? t('dispositifs:list.empty', 'Aucun dispositif trouvé pour ces critères.') : t('dispositifs:list.emptyPage', 'Aucun résultat sur cette page.')}</p>
            {hasFilters ? <Button type="button" variant="outline" className="mt-3 h-11" onClick={clearFilters}>{t('dispositifs:filters.clear', 'Effacer la recherche et les filtres')}</Button>
              : <Button type="button" variant="outline" className="mt-3 h-11" onClick={() => setParam('page', '')}>{t('dispositifs:pagination.first', 'Revenir à la première page')}</Button>}
          </div>
        ) : (
          <>
            <div className={`grid gap-5 md:grid-cols-2 ${isFetching ? 'opacity-60 transition-opacity' : ''}`} aria-busy={isFetching || undefined} data-testid="dispositifs-list">
              {items.map((d) => <DispositifCard key={d.id} dispositif={d} />)}
            </div>
            <Pager page={page} totalPages={pagination.totalPages || 1} hasNext={Boolean(pagination.hasNext)} onPage={(p) => setParam('page', String(p))}
              label={t('dispositifs:pagination.nav', 'Pages des dispositifs')} previous={t('dispositifs:pagination.previous', 'Précédent')} next={t('dispositifs:pagination.next', 'Suivant')}
              status={t('dispositifs:pagination.page', 'Page {{page}} sur {{total}}', { page, total: pagination.totalPages || 1 })} />
          </>
        )}
      </CatalogBody>
    </div>
  );
}
