import OfficialResourcesNotice from '@/components/OfficialResourcesNotice';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import SEO from '@/components/SEO';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import DemarcheCard from '@/components/cards/DemarcheCard';
import { generateBreadcrumbSchema } from '@/utils/schema';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

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
    if (isLoading || isFetching) return 'Chargement des démarches...';
    if (error) return "Erreur lors du chargement des démarches.";
    if (!items.length) return 'Aucune démarche trouvée.';
    const total = typeof pagination.total === 'number' ? pagination.total : items.length;
    return `${total} démarche${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}.`;
  }, [isLoading, isFetching, error, items.length, pagination.total]);

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

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const handleSearchSubmit = (event) => {
    event.preventDefault();
    handleParamChange('q', queryInput.trim());
  };

  const clearFilters = () => {
    setSearchParams({});
    setIsFiltersOpen(false);
  };

  const getTitle = () => {
    if (q) return `Démarches - ${q}`;
    if (category && taxonomyData) {
      const cat = taxonomyData.categories?.find((c) => c.slug === category);
      if (cat) return `Démarches - ${cat.label}`;
    }
    if (situation && taxonomyData) {
      const sit = taxonomyData.situations?.find((s) => s.slug === situation);
      if (sit) return `Démarches pour : ${sit.label}`;
    }
    return 'Démarches administratives';
  };

  const getDescription = () => {
    if (q) return `Résultats pour la recherche "${q}" sur les démarches disponibles.`;
    if (category && taxonomyData) {
      const cat = taxonomyData.categories?.find((c) => c.slug === category);
      if (cat) return `Toutes les démarches administratives et guides pas à pas pour la catégorie ${cat.label}.`;
    }
    if (situation && taxonomyData) {
      const sit = taxonomyData.situations?.find((s) => s.slug === situation);
      if (sit) return `Guides et démarches pour votre situation : ${sit.label}.`;
    }
    return 'Besoin d\'aide pour vos démarches ? Retrouvez nos guides pas à pas pour la CAF, le RSA, vos papiers d\'identité et plus encore.';
  };

  const schema = useMemo(() => {
    return [
      generateBreadcrumbSchema([
        { name: 'Accueil', url: '/' },
        { name: 'Démarches', url: '/demarches' },
      ]),
    ].filter(Boolean);
  }, []);

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

      {/* Gradient Banner */}
      <div
        className="relative overflow-hidden py-10 sm:py-14"
        style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 30%, #1e3a8a 60%, #3730a3 85%, #4F46E5 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden="true" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md">Démarches</h1>
          <p className="mt-2 text-blue-100/80 text-sm sm:text-base">
            Trouvez une démarche, filtrez par catégorie ou situation, et accédez aux liens officiels.
          </p>
        </div>
      </div>

      {/* Header */}
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
                placeholder="Rechercher une démarche (ex: passeport, RSA...)"
                aria-label="Rechercher une démarche"
                className="pl-10 h-11 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                data-testid="demarches-search-input"
              />
            </div>
            <Button type="submit" className="h-11" data-testid="demarches-search-submit">
              Rechercher
            </Button>
          </form>

          {/* Filters */}
          {isFiltersOpen && (
            <Card>
              <CardContent className="p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor="demarches-category" className="block text-sm font-semibold text-slate-900 mb-1">
                      Catégorie
                    </label>
                    <select
                      id="demarches-category"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={category}
                      onChange={(e) => handleParamChange('category', e.target.value)}
                    >
                      <option value="">Toutes</option>
                      {(taxonomyData?.categories || []).map((cat) => (
                        <option key={cat.slug} value={cat.slug}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="demarches-situation" className="block text-sm font-semibold text-slate-900 mb-1">
                      Situation
                    </label>
                    <select
                      id="demarches-situation"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={situation}
                      onChange={(e) => handleParamChange('situation', e.target.value)}
                    >
                      <option value="">Toutes</option>
                      {(taxonomyData?.situations || []).map((sit) => (
                        <option key={sit.slug} value={sit.slug}>
                          {sit.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="demarches-source" className="block text-sm font-semibold text-slate-900 mb-1">
                      Source
                    </label>
                    <select
                      id="demarches-source"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={searchParams.get('source') || ''}
                      onChange={(e) => handleParamChange('source', e.target.value)}
                    >
                      <option value="">Toutes les sources</option>
                      <option value="service-public">Service-Public</option>
                      <option value="demarches-simplifiees">Démarches Simplifiées</option>
                      <option value="curated">Données vérifiées</option>
                      <option value="aides-territoires">Aides Territoires</option>
                      <option value="grand-est">Grand Est</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="demarches-sort" className="block text-sm font-semibold text-slate-900 mb-1">
                      Trier
                    </label>
                    <select
                      id="demarches-sort"
                      className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={sort}
                      onChange={(e) => handleParamChange('sort', e.target.value)}
                    >
                      <option value="quality">Qualité</option>
                      <option value="recent">Récents</option>
                      <option value="relevance" disabled={!q}>
                        Pertinence {q ? '' : '(nécessite une recherche)'}
                      </option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="demarches-limit" className="block text-sm font-semibold text-slate-900 mb-1">
                      Par page
                    </label>
                    <select
                      id="demarches-limit"
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
                    Réinitialiser
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsFiltersOpen(false)}>
                    Fermer
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {error && (
          <EmptyState
            title="Impossible de charger les démarches"
            description="Vérifiez votre connexion puis réessayez."
            icon={<RotateCcw className="h-6 w-6" />}
            actions={
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Réessayer
              </Button>
            }
            role="alert"
            data-testid="demarches-error-state"
          />
        )}

        {(isLoading || isFetching) && !error && (
          <div className="space-y-3" data-testid="demarches-loading-state">
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <div key={value} className="rounded-xl border border-slate-200 bg-white p-5">
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
              title={q || category || situation ? "Aucune démarche trouvée" : "Démarches en cours d'intégration"}
              description={
                q || category || situation
                  ? "Essayez une autre recherche ou ajustez les filtres."
                  : "Notre catalogue de démarches est en cours de constitution. En attendant, les sites officiels ci-dessus et les structures d’accompagnement de l’annuaire peuvent vous aider."
              }
              icon={<Search className="h-6 w-6" />}
              actions={
                q || category || situation ? (
                  <Button type="button" variant="outline" onClick={clearFilters} data-testid="empty-reset">
                    Réinitialiser les filtres
                  </Button>
                ) : undefined
              }
              data-testid="demarches-empty-component"
            />
            {/* launch-readiness item 58: this pointed to the orientation assistant, whose calculation needs the OpenFisca engine that production does not have
                (it answers 503 there); the directory of support structures works */}
            {!(q || category || situation) && (
              <div className="mt-4 flex justify-center">
                <Link to="/structures">
                  <Button variant="outline" className="gap-2" data-testid="demarches-empty-directory">
                    Trouver une structure d&apos;accompagnement
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}

        {!error && items.length > 0 && (
          <>
            <p className="mb-4 text-sm text-slate-600" data-testid="demarches-success-state">
              {pagination.total ?? items.length} démarche{(pagination.total ?? items.length) > 1 ? 's' : ''} trouvée{(pagination.total ?? items.length) > 1 ? 's' : ''}.
            </p>
            <div className="grid gap-6 md:grid-cols-2" data-testid="demarches-results-list">
              {items.map((demarche) => (
                <DemarcheCard key={demarche.id} demarche={demarche} />
              ))}
            </div>

            {(pagination.totalPages || 1) > 1 && (
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => handleParamChange('page', String(page - 1))}
                >
                  Précédent
                </Button>
                <span className="text-sm text-slate-600">
                  Page {page} sur {pagination.totalPages || 1}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pagination.hasNext != null ? !pagination.hasNext : page >= (pagination.totalPages || 1)}
                  onClick={() => handleParamChange('page', String(page + 1))}
                >
                  Suivant
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
