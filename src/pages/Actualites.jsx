// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, Calendar, ExternalLink, AlertTriangle, Info, RefreshCw, Star, ArrowRight, Brain } from 'lucide-react';
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
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';

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

export default function Actualites() {
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
    if (isLoading || isFetching) return 'Chargement des actualités...';
    if (error) return "Erreur lors du chargement des actualités.";
    if (!actualites.length) return "Aucune actualité trouvée.";
    const total = typeof pagination.total === 'number' ? pagination.total : actualites.length;
    return `${total} actualité${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}.`;
  }, [isLoading, isFetching, error, actualites.length, pagination.total]);

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
        { name: 'Accueil', url: '/' },
        { name: 'Actualités', url: '/actualites' },
      ]),
    ].filter(Boolean);
  }, []);

  const sourceOptions = useMemo(() => {
    const fromItems = actualites
      .map((a) => getSourceName(a))
      .filter((v) => v);
    const unique = Array.from(new Set(fromItems)).sort((a, b) => a.localeCompare(b, 'fr'));
    const options = [{ value: '', label: 'Toutes les sources' }, ...unique.map((v) => ({ value: v, label: v }))];
    if (source && !unique.includes(source)) {
      options.splice(1, 0, { value: source, label: source });
    }
    return options;
  }, [actualites, source]);

  const hasNext = Boolean(pagination.hasNext);
  const totalPages = pagination.totalPages || 1;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <SEO
        title="Actualités"
        description="Les dernières informations officielles sur les aides et les droits."
        path="/actualites"
        schema={schema}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <PageHeader title="Actualités" description="Les changements utiles sur vos droits et vos démarches, avec leur source officielle." />

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
              Filtres
            </Button>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Rechercher une actualité (ex: APL, RSA, logement...)"
                aria-label="Rechercher une actualité"
                className="pl-10 h-11 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
            <Button type="submit" className="h-11">
              Rechercher
            </Button>
          </form>

          {/* Filters */}
          {isFiltersOpen && (
            <Card>
              <CardContent className="p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor="actualites-source" className="block text-sm font-semibold text-slate-900 mb-1">
                      Source
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
                      Résultats par page
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
                    <p className="block text-sm font-semibold text-slate-900 mb-2">Catégorie</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={categorie === '' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleParamChange('categorie', '')}
                      >
                        Toutes
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
                    Réinitialiser
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
          <ListSkeleton layout="list" count={5} message="Chargement des actualités..." />
        ) : error ? (
          <EmptyState
            title="Impossible de charger les actualités"
            description="Un problème est survenu lors de la récupération des actualités. Vous pouvez réessayer."
            actions={<Button type="button" variant="outline" className="min-h-11" onClick={() => refetch()}>Réessayer</Button>}
            role="alert"
            data-testid="actualites-error"
          />
        ) : actualites.length > 0 ? (
          <>
            <div className="space-y-6" data-testid="actualites-results-list">
              {actualites.map((actu, idx) => {
                const typeKey = actu.type_actu || 'info';
                const TypeIcon = TYPE_ICONS[typeKey] || Info;
                const linkUrl = actu.slug ? `/actualites/${actu.slug}` : `/actualites/view?id=${actu.id}`;
                const sourceName = getSourceName(actu);
                const sourceUrl = getSourceUrl(actu);
                const provenance = getProvenance(actu);
                const verifiedAt = formatProvenanceDate(provenance.verifiedAt);
                const sourceHost = provenance.sourceHost;
                const excerpt = htmlToPlainText(actu.summary_falc || actu.resume || '', { maxLength: 220 });

                return (
                  <AnimatedCard index={idx} key={actu.id}>
                    <Card
                      className={`group hover:shadow-lg transition-all relative ${actu.est_important ? 'border-l-4 border-l-blue-500' : ''}`}
                      data-testid="actualite-card"
                    >
                      {/* Overlay Link */}
                      <Link
                        to={linkUrl}
                        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
                        aria-label={`Lire l'actualité ${actu.titre}`}
                      >
                        <span className="sr-only">Lire l'actualité {actu.titre}</span>
                      </Link>

                      <CardContent className="p-6">
                        <div className="flex flex-wrap gap-2 mb-3">
                          <Badge className={TYPE_COLORS[typeKey] || 'bg-slate-100 text-slate-800'}>
                            <TypeIcon className="h-3 w-3 mr-1" />
                            {typeKey === 'nouveaute' ? 'Nouveauté'
                              : typeKey === 'modification' ? 'Modification'
                                : typeKey === 'alerte' ? 'Alerte'
                                  : 'Information'}
                          </Badge>
                          {actu.categorie && (
                            <CategoryChip slug={actu.categorie} />
                          )}
                          {actu.est_important && (
                            <Badge className="bg-amber-100 text-amber-800">
                              Important
                            </Badge>
                          )}
                        </div>

                        <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-700 transition-colors mb-3" data-testid="actualite-title">
                          {actu.titre}
                        </h2>

                        <p className="text-slate-600 mb-4 leading-relaxed line-clamp-5">
                          {isFalcEnabled && actu.summary_falc ? actu.summary_falc : excerpt}
                        </p>

                        {/* FALC badge */}
                        {isFalcEnabled && actu.summary_falc && (
                          <div className="mb-4">
                            <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                              <Brain className="h-3 w-3" />
                              Simplifié
                            </Badge>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100 relative z-20">
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {new Date(actu.date_publication).toLocaleDateString('fr-FR', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                              })}
                            </span>
                            {verifiedAt && (
                              <span>Vérifié: {verifiedAt}</span>
                            )}
                            {sourceHost && (
                              <span>Source: {sourceHost}</span>
                            )}
                            {!sourceHost && sourceName && (
                              <span>Source: {sourceName}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-4">
                            {sourceUrl && (
                              <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-500 hover:text-blue-600 text-sm font-medium flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Source
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <span className="text-blue-600 group-hover:text-blue-800 text-sm font-bold flex items-center gap-1 transition-colors">
                              Lire la suite
                              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AnimatedCard>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-center mt-10 gap-3">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Précédent
                </Button>
                <span className="flex items-center px-4 text-sm font-medium">
                  Page {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={!hasNext}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Suivant
                </Button>
              </div>
            )}
          </>
        ) : nothingPublished ? (
          <EmptyCatalogue title="Aucune actualité n’est encore publiée" testId="actualites-none-published">
            <p>Chaque actualité est relue avant publication et cite sa source officielle. Aucune n’a encore été publiée pendant la bêta.</p>
          </EmptyCatalogue>
        ) : (
          <NewsFallback />
        )}
      </div>
    </div>
  );
}
