// @ts-nocheck
/**
 * Actualités v2 (owner directive 11/11/2026): France first (≈ 70 % / 30 % Monde at the start, configurable, never invented), Monde, Alsace/Strasbourg;
 * editorial categories; one card per story (other reports listed under « Sources et couverture »); search, source, dates, newest/relevant; filters in
 * the address (shareable); articles saved on this device only. What each card shows depends on the source's rights (api/_services/news/feed.js).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, SlidersHorizontal } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ActiveFilters, CONTAINER, FilterField, HeroSearch, MobileFilters, Pager, ResultsBar, SELECT, TEXT_INPUT } from '@/components/layout/catalog';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/layout/PageHeader';
import EmptyCatalogue from '@/components/layout/EmptyCatalogue';
import ListSkeleton from '@/components/feedback/ListSkeleton';
import NewsFallback from '@/components/news/NewsFallback';
import NewsCardV2 from '@/components/news/NewsCardV2';
import { GEO_TABS, TOPIC_CHIPS, geoLabel, topicLabel } from '@/components/news/newsLabels';
import useNewsBookmarks from '@/hooks/useNewsBookmarks';
import { generateBreadcrumbSchema } from '@/utils/schema';
import { useFalc } from '@/contexts/FalcContext';
import { formatDate, useT } from '@/i18n';

const PAGE_SIZE = 12;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const parsePage = (v) => { const n = Number.parseInt(String(v ?? '1'), 10); return Number.isFinite(n) && n > 0 ? n : 1; };

export default function Actualites() {
  const { t } = useT('news');
  const [sp, setSp] = useSearchParams();
  const { isFalcEnabled } = useFalc();
  const bookmarks = useNewsBookmarks();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const geo = ['france', 'monde', 'alsace'].includes(sp.get('geo') || '') ? sp.get('geo') : '';
  const topic = TOPIC_CHIPS.includes(sp.get('topic') || '') ? sp.get('topic') : '';
  const q = (sp.get('q') || '').trim().slice(0, 80);
  const source = (sp.get('source') || '').trim().slice(0, 80);
  const from = ISO_DAY.test(sp.get('from') || '') ? sp.get('from') : '';
  const to = ISO_DAY.test(sp.get('to') || '') ? sp.get('to') : '';
  const sort = sp.get('sort') === 'relevance' ? 'relevance' : 'recent';
  const saved = sp.get('saved') === '1';
  const page = parsePage(sp.get('page'));
  const searched = Boolean(geo || topic || q || source || from || to);
  const [queryInput, setQueryInput] = useState(q);
  useEffect(() => setQueryInput(q), [q]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['actualites-v2', { geo, topic, q, source, from, to, sort, page }],
    enabled: !saved,
    queryFn: async () => {
      const out = await client.entities.Actualite.filter({ view: 'v2', geo: geo || undefined, topic: topic || undefined, q: q || undefined, source: source || undefined,
        from: from || undefined, to: to || undefined, sort, page, pageSize: PAGE_SIZE, statut: 'publie' });
      if (out && out.degraded) throw new Error('actualites_degraded');
      return out;
    },
  });
  const items = data?.items || [];
  const facets = data?.facets || { topics: {}, geo: {}, sources: {} };
  const pagination = data?.pagination || {};
  const nothingPublished = !saved && !isLoading && !error && !searched && items.length === 0 && page === 1;

  const setParam = (key, value) => {
    const p = new URLSearchParams(sp);
    if (!value) p.delete(key); else p.set(key, value);
    if (key !== 'page') p.delete('page');
    setSp(p);
  };
  const clearFilters = () => { setSp({}); setFiltersOpen(false); };
  const liveMessage = useMemo(() => {
    if (saved) return t('news:saved.count', { count: bookmarks.items.length, defaultValue_one: '{{count}} article enregistré.', defaultValue_other: '{{count}} articles enregistrés.' });
    if (isLoading || isFetching) return t('news:list.loading', 'Chargement des actualités...');
    if (error) return t('news:live.error', 'Erreur lors du chargement des actualités.');
    if (!items.length) return t('news:live.none', 'Aucune actualité trouvée.');
    return t('news:live.found', { count: pagination.total ?? items.length, defaultValue_one: '{{count}} actualité trouvée.', defaultValue_other: '{{count}} actualités trouvées.' });
  }, [saved, bookmarks.items.length, isLoading, isFetching, error, items.length, pagination.total, t]);
  const schema = useMemo(() => [generateBreadcrumbSchema([{ name: t('news:breadcrumb.home', 'Accueil'), url: '/' }, { name: t('news:breadcrumb.news', 'Actualités'), url: '/actualites' }])].filter(Boolean), [t]);
  const sourceOptions = Object.keys(facets.sources || {}).sort((a, b) => a.localeCompare(b, 'fr'));
  // the lead story and the two next ones beside it (a front page) on the first page of the unfiltered feed
  const featured = !searched && page === 1 && items.length > 3 ? items[0] : null;
  const rest = featured ? items.slice(1) : items;
  const save = (it) => bookmarks.toggle({ id: it.id, slug: it.slug, titre: it.titre, date: it.date_publication, publisher: it.publisher });

  const secondary = featured ? rest.slice(0, 2) : [];
  const grid = featured ? rest.slice(2) : rest;
  const advancedCount = [source, from, to, sort === 'relevance' ? sort : ''].filter(Boolean).length;
  const activeFilters = searched ? [
    geo && { key: 'geo', label: geoLabel(geo, t), onRemove: () => setParam('geo', '') },
    topic && { key: 'topic', label: topicLabel(topic, t), onRemove: () => setParam('topic', '') },
    q && { key: 'q', label: `« ${q} »`, onRemove: () => setParam('q', '') },
    source && { key: 'source', label: source, onRemove: () => setParam('source', '') },
    from && { key: 'from', label: `≥ ${formatDate(from)}`, onRemove: () => setParam('from', '') },
    to && { key: 'to', label: `≤ ${formatDate(to)}`, onRemove: () => setParam('to', '') },
  ].filter(Boolean) : [];
  const setGeo = (id) => { const p = new URLSearchParams(sp); p.delete('saved'); p.delete('page'); if (id) p.set('geo', id); else p.delete('geo'); setSp(p); };

  /** the advanced filters (source, dates, order), inline from `lg` and in the phone sheet (prefix 'm-') @param {string} prefix */
  const renderFilters = (prefix) => (
    <div className={prefix ? 'space-y-5' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4'}>
      <FilterField id={`${prefix}news-source`} label={t('news:filters.source', 'Source')}>
        <select id={`${prefix}news-source`} className={SELECT} value={source} onChange={(e) => setParam('source', e.target.value)}>
          <option value="">{t('news:filters.all_sources', 'Toutes les sources')}</option>
          {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </FilterField>
      <FilterField id={`${prefix}news-from`} label={t('news:filters.from', 'Publiée à partir du')}>
        <input id={`${prefix}news-from`} type="date" className={TEXT_INPUT} value={from} onChange={(e) => setParam('from', e.target.value)} />
      </FilterField>
      <FilterField id={`${prefix}news-to`} label={t('news:filters.to', 'Publiée jusqu’au')}>
        <input id={`${prefix}news-to`} type="date" className={TEXT_INPUT} value={to} onChange={(e) => setParam('to', e.target.value)} />
      </FilterField>
      <FilterField id={`${prefix}news-sort`} label={t('news:filters.sort', 'Trier par')}>
        <select id={`${prefix}news-sort`} className={SELECT} value={sort} onChange={(e) => setParam('sort', e.target.value === 'recent' ? '' : e.target.value)}>
          <option value="recent">{t('news:sort.recent', 'Plus récentes')}</option>
          <option value="relevance">{t('news:sort.relevant', 'Plus pertinentes (recherche)')}</option>
        </select>
      </FilterField>
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO title={t('news:list.seo_title', 'Actualités')} description={t('news:list.seo_description_v2', 'L’actualité utile en France et dans le monde, avec sa source, ses droits de réutilisation et ses corrections.')} path="/actualites" schema={schema} />
      <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
      <PageHeader title={t('news:list.title', 'Actualités')} description={t('news:list.description_v2', 'France d’abord, le monde ensuite : des informations sourcées, datées et vérifiables.')}>
        {!nothingPublished && !saved && (
          <HeroSearch value={queryInput} onChange={setQueryInput} onSubmit={() => setParam('q', queryInput.trim())} maxLength={80}
            label={t('news:search.label', 'Rechercher une actualité')} placeholder={t('news:search.placeholder', 'Rechercher une actualité (ex: APL, RSA, logement...)')}
            submitLabel={t('news:search.submit', 'Rechercher')} />
        )}
      </PageHeader>

      {!nothingPublished && (
        <div className="border-b border-slate-200 bg-white print:hidden">
          <div className={`${CONTAINER} flex flex-col gap-3 py-3`}>
            <nav aria-label={t('news:geo.nav', 'Choisir la zone géographique')} className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="news-geo-tabs">
              {GEO_TABS.map((g) => {
                const active = !saved && geo === g.id;
                return (
                  <button key={g.id || 'all'} type="button" onClick={() => setGeo(g.id)} aria-pressed={active}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${active ? 'bg-blue-900 text-white' : 'text-slate-800 hover:bg-slate-100'}`}>
                    <span aria-hidden="true">{g.flag}</span>{g.id ? geoLabel(g.id, t) : t('news:geo.une', 'À la une')}
                    {g.id && facets.geo?.[g.id] != null && <span className={`rounded-full px-1.5 text-xs ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>{facets.geo[g.id]}</span>}
                  </button>
                );
              })}
              <button type="button" onClick={() => setSp(saved ? {} : { saved: '1' })} aria-pressed={saved}
                className={`ms-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${saved ? 'bg-blue-700 text-white' : 'bg-blue-50 text-blue-900 hover:bg-blue-100'}`}>
                <Bookmark className="h-4 w-4" aria-hidden="true" />{t('news:saved.tab', 'Enregistrés')} ({bookmarks.items.length})
              </button>
            </nav>
            {!saved && (
              <div role="group" aria-label={t('news:filters.category', 'Catégorie')} data-testid="news-topic-chips" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-wrap lg:overflow-visible">
                {TOPIC_CHIPS.map((id) => (
                  <button key={id} type="button" aria-pressed={topic === id} onClick={() => setParam('topic', topic === id ? '' : id)}
                    className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${topic === id ? 'border-blue-800 bg-blue-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:text-blue-900'}`}>
                    {topicLabel(id, t)}{facets.topics?.[id] ? <span className={`ms-1.5 text-xs ${topic === id ? 'text-blue-100' : 'text-slate-500'}`}>{facets.topics[id]}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`${CONTAINER} py-6 sm:py-8`}>
        {!saved && !nothingPublished && (
          <>
            <ResultsBar summary={!isLoading && !error && items.length ? t('news:live.found', { count: pagination.total ?? items.length, defaultValue_one: '{{count}} actualité trouvée.', defaultValue_other: '{{count}} actualités trouvées.' }) : null}>
              <Button type="button" variant="outline" className="hidden h-11 gap-2 lg:inline-flex" aria-expanded={filtersOpen} aria-controls="news-filters" onClick={() => setFiltersOpen((o) => !o)}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t('news:filters.toggle', 'Filtres')}
                {advancedCount > 0 && <span className="rounded-full bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white">{advancedCount}</span>}
              </Button>
              <MobileFilters title={t('news:filters.toggle', 'Filtres')} count={advancedCount} render={renderFilters} onReset={clearFilters} />
            </ResultsBar>
            {filtersOpen && (
              <div id="news-filters" className="mb-5 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-subtle lg:block">{renderFilters('')}</div>
            )}
            <ActiveFilters items={activeFilters} onClear={clearFilters} />
          </>
        )}
        {saved ? (
          bookmarks.items.length ? (
            <section aria-labelledby="saved-title">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="saved-title" className="font-heading text-xl font-bold text-slate-900">{t('news:saved.title', 'Articles enregistrés sur cet appareil')}</h2>
                <Button type="button" variant="ghost" onClick={bookmarks.clear}>{t('news:saved.clear', 'Tout effacer')}</Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">{t('news:saved.privacy', 'Cette liste reste dans ce navigateur : elle n’est envoyée à personne.')}</p>
              <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white" data-testid="news-saved-list">
                {bookmarks.items.map((b) => (
                  <li key={b.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <Link to={b.slug ? `/actualites/${b.slug}` : `/actualites/view?id=${b.id}`} className="font-semibold text-slate-900 hover:text-blue-800" lang="fr">{b.titre}</Link>
                    <span className="shrink-0 text-xs text-slate-600">{b.publisher}{b.date ? ` · ${formatDate(b.date)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState title={t('news:saved.none', 'Aucun article enregistré')} description={t('news:saved.how', 'Utilisez le bouton « Enregistrer » d’un article : il restera sur cet appareil.')} />
          )
        ) : isLoading ? (
          <ListSkeleton layout="list" count={6} message={t('news:list.loading', 'Chargement des actualités...')} />
        ) : error ? (
          <EmptyState title={t('news:error.title', 'Impossible de charger les actualités')} description={t('news:error.text', 'Un problème est survenu lors de la récupération des actualités. Vous pouvez réessayer.')}
            actions={<Button type="button" variant="outline" className="min-h-11" onClick={() => refetch()}>{t('news:retry', 'Réessayer')}</Button>} role="alert" data-testid="actualites-error" />
        ) : items.length ? (
          <div className={isFetching ? 'opacity-60 transition-opacity' : ''} aria-busy={isFetching || undefined}>
            {featured && (
              <section aria-label={t('news:geo.une', 'À la une')} className="mb-5 grid gap-5 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <NewsCardV2 item={featured} featured falc={isFalcEnabled} saved={bookmarks.isSaved(featured.id)} onToggleSave={save} />
                </div>
                {secondary.length > 0 && (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                    {secondary.map((it) => <NewsCardV2 key={it.id} item={it} compact falc={isFalcEnabled} saved={bookmarks.isSaved(it.id)} onToggleSave={save} />)}
                  </div>
                )}
              </section>
            )}
            {grid.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="actualites-results-list">
                {grid.map((it) => <NewsCardV2 key={it.id} item={it} falc={isFalcEnabled} saved={bookmarks.isSaved(it.id)} onToggleSave={save} />)}
              </div>
            )}
            <Pager page={page} totalPages={pagination.totalPages || 1} hasNext={Boolean(pagination.hasNext)} onPage={(n) => setParam('page', String(n))}
              label={t('news:pagination.nav', 'Pages des actualités')} previous={t('news:pagination.previous', 'Précédent')} next={t('news:pagination.next', 'Suivant')}
              status={t('news:pagination.page', 'Page {{page}} / {{total}}', { page, total: pagination.totalPages || 1 })} />
            <p className="mt-8 max-w-3xl text-xs leading-relaxed text-slate-600">{t('news:method.note', 'Méthode : classement par date (ou par pertinence d’une recherche), sans mise en avant d’un éditeur ; le lieu indiqué est celui de l’événement ; un même sujet couvert par plusieurs sources forme une seule carte.')}</p>
          </div>
        ) : nothingPublished ? (
          <EmptyCatalogue title={t('news:none.title', 'Aucune actualité n’est encore publiée')} testId="actualites-none-published">
            <p>{t('news:none.text_v2', 'Chaque actualité publiée cite sa source et la licence qui permet de la reprendre ; les textes officiels sont vérifiés automatiquement sur leur page d’origine.')}</p>
          </EmptyCatalogue>
        ) : (
          <NewsFallback />
        )}
      </div>
    </div>
  );
}
