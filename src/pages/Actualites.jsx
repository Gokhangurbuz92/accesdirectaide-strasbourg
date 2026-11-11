// @ts-nocheck
/**
 * Actualités v2 (owner directive 11/11/2026): France first (≈ 70 % / 30 % Monde at the start, configurable, never invented), Monde, Alsace/Strasbourg;
 * editorial categories; one card per story (other reports listed under « Sources et couverture »); search, source, dates, newest/relevant; filters in
 * the address (shareable); articles saved on this device only. What each card shows depends on the source's rights (api/_services/news/feed.js).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, Search, SlidersHorizontal, X } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const featured = !searched && page === 1 && items.length > 2 ? items[0] : null;
  const rest = featured ? items.slice(1) : items;
  const save = (it) => bookmarks.toggle({ id: it.id, slug: it.slug, titre: it.titre, date: it.date_publication, publisher: it.publisher });

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO title={t('news:list.seo_title', 'Actualités')} description={t('news:list.seo_description_v2', 'L’actualité utile en France et dans le monde, avec sa source, ses droits de réutilisation et ses corrections.')} path="/actualites" schema={schema} />
      <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
      <PageHeader title={t('news:list.title', 'Actualités')} description={t('news:list.description_v2', 'France d’abord, le monde ensuite : des informations sourcées, datées et vérifiables.')} />

      {!nothingPublished && (
        <div className="sticky top-16 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <nav aria-label={t('news:geo.nav', 'Choisir la zone géographique')} className="-mx-1 flex gap-1 overflow-x-auto pb-1" data-testid="news-geo-tabs">
              {GEO_TABS.map((g) => {
                const active = !saved && geo === g.id;
                return (
                  <button key={g.id || 'all'} type="button" onClick={() => { const p = new URLSearchParams(sp); p.delete('saved'); p.delete('page'); if (g.id) p.set('geo', g.id); else p.delete('geo'); setSp(p); }}
                    aria-pressed={active} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>
                    <span aria-hidden="true">{g.flag}</span>{g.id ? geoLabel(g.id, t) : t('news:geo.une', 'À la une')}
                    {g.id && facets.geo?.[g.id] != null && <span className="rounded-full bg-white/20 px-1.5 text-xs">{facets.geo[g.id]}</span>}
                  </button>
                );
              })}
              <button type="button" onClick={() => setSp(saved ? {} : { saved: '1' })} aria-pressed={saved}
                className={`ms-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${saved ? 'bg-blue-700 text-white' : 'bg-blue-50 text-blue-900 hover:bg-blue-100'}`}>
                <Bookmark className="h-4 w-4" aria-hidden="true" />{t('news:saved.tab', 'Enregistrés')} ({bookmarks.items.length})
              </button>
            </nav>
            {!saved && (
              <form onSubmit={(e) => { e.preventDefault(); setParam('q', queryInput.trim()); }} className="flex flex-col gap-2 sm:flex-row" role="search">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input value={queryInput} onChange={(e) => setQueryInput(e.target.value)} maxLength={80} className="h-11 ps-10"
                    placeholder={t('news:search.placeholder', 'Rechercher une actualité (ex: APL, RSA, logement...)')} aria-label={t('news:search.label', 'Rechercher une actualité')} />
                </div>
                <Button type="submit" className="h-11">{t('news:search.submit', 'Rechercher')}</Button>
                <Button type="button" variant="outline" className="h-11 gap-2" aria-expanded={filtersOpen} aria-controls="news-filters" onClick={() => setFiltersOpen((o) => !o)}>
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t('news:filters.toggle', 'Filtres')}
                </Button>
              </form>
            )}
            {!saved && (
              <div className="-mx-1 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('news:filters.category', 'Catégorie')} data-testid="news-topic-chips">
                {TOPIC_CHIPS.map((id) => (
                  <button key={id} type="button" aria-pressed={topic === id} onClick={() => setParam('topic', topic === id ? '' : id)}
                    className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${topic === id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'}`}>
                    {topicLabel(id, t)}{facets.topics?.[id] ? <span className="ms-1.5 text-xs opacity-80">{facets.topics[id]}</span> : null}
                  </button>
                ))}
              </div>
            )}
            {!saved && filtersOpen && (
              <div id="news-filters" className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-semibold text-slate-900">{t('news:filters.source', 'Source')}
                  <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" value={source} onChange={(e) => setParam('source', e.target.value)}>
                    <option value="">{t('news:filters.all_sources', 'Toutes les sources')}</option>
                    {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-900">{t('news:filters.from', 'Publiée à partir du')}
                  <input type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" value={from} onChange={(e) => setParam('from', e.target.value)} />
                </label>
                <label className="text-sm font-semibold text-slate-900">{t('news:filters.to', 'Publiée jusqu’au')}
                  <input type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" value={to} onChange={(e) => setParam('to', e.target.value)} />
                </label>
                <label className="text-sm font-semibold text-slate-900">{t('news:filters.sort', 'Trier par')}
                  <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" value={sort} onChange={(e) => setParam('sort', e.target.value === 'recent' ? '' : e.target.value)}>
                    <option value="recent">{t('news:sort.recent', 'Plus récentes')}</option>
                    <option value="relevance">{t('news:sort.relevant', 'Plus pertinentes (recherche)')}</option>
                  </select>
                </label>
              </div>
            )}
            {searched && !saved && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">{t('news:filters.active', 'Filtres actifs :')}</span>
                {[geo && geoLabel(geo, t), topic && topicLabel(topic, t), q && `« ${q} »`, source, from && `≥ ${formatDate(from)}`, to && `≤ ${formatDate(to)}`].filter(Boolean).map((x) => <span key={x} className="rounded bg-slate-100 px-2 py-0.5 text-slate-800">{x}</span>)}
                <button type="button" onClick={clearFilters} className="inline-flex min-h-9 items-center gap-1 rounded px-2 font-semibold text-blue-800 underline-offset-2 hover:underline"><X className="h-4 w-4" aria-hidden="true" />{t('news:filters.reset', 'Réinitialiser')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {saved ? (
          bookmarks.items.length ? (
            <section aria-labelledby="saved-title">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="saved-title" className="text-xl font-bold text-slate-900">{t('news:saved.title', 'Articles enregistrés sur cet appareil')}</h2>
                <Button type="button" variant="ghost" onClick={bookmarks.clear}>{t('news:saved.clear', 'Tout effacer')}</Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">{t('news:saved.privacy', 'Cette liste reste dans ce navigateur : elle n’est envoyée à personne.')}</p>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white" data-testid="news-saved-list">
                {bookmarks.items.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 p-4">
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
          <>
            {featured && (
              <section aria-label={t('news:geo.une', 'À la une')} className="mb-6">
                <NewsCardV2 item={featured} featured falc={isFalcEnabled} saved={bookmarks.isSaved(featured.id)} onToggleSave={save} />
              </section>
            )}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="actualites-results-list">
              {rest.map((it) => <NewsCardV2 key={it.id} item={it} falc={isFalcEnabled} saved={bookmarks.isSaved(it.id)} onToggleSave={save} />)}
            </div>
            {pagination.totalPages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-3" aria-label={t('news:pagination.nav', 'Pages des actualités')}>
                <Button variant="outline" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>{t('news:pagination.previous', 'Précédent')}</Button>
                <span className="px-3 text-sm font-medium">{t('news:pagination.page', 'Page {{page}} / {{total}}', { page, total: pagination.totalPages })}</span>
                <Button variant="outline" disabled={!pagination.hasNext} onClick={() => setParam('page', String(page + 1))}>{t('news:pagination.next', 'Suivant')}</Button>
              </nav>
            )}
            <p className="mt-8 text-xs text-slate-600">{t('news:method.note', 'Méthode : classement par date (ou par pertinence d’une recherche), sans mise en avant d’un éditeur ; le lieu indiqué est celui de l’événement ; un même sujet couvert par plusieurs sources forme une seule carte.')}</p>
          </>
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
