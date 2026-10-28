// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, RotateCcw, FileText, Building2, Newspaper, ArrowRight } from 'lucide-react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import AidesSearchForm from '@/components/search/AidesSearchForm';
import SearchResultsList from '@/components/search/SearchResultsList';
import { isAbortError, normalizeSearchCategory, searchAides } from '@/lib/searchClient';
import useCitizenHistory from '@/hooks/useCitizenHistory';

const DEFAULT_LIMIT = 10;
const EXAMPLE_SEARCHES = [
  { query: 'loyer étudiant Strasbourg', category: 'LOGEMENT' },
  { query: 'aide transport travail', category: 'MOBILITE' },
  { query: 'complémentaire santé solidaire', category: 'SANTE' },
];

/**
 * @param {string | null} value
 */
function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  if (parsed < 1) return 1;
  if (parsed > 30) return 30;
  return parsed;
}

// @ts-ignore
function buildCanonicalSearchParams(/** @type {string} */ query, category, limit, situation) {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }
  if (category) {
    params.set('cat', category);
  }
  if (situation) {
    params.set('situation', situation);
  }
  params.set('limit', String(parseLimit(limit)));
  return params;
}

export default function Recherche() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  const queryFromUrl = (searchParams.get('q') || '').trim();
  const situationFromUrl = (searchParams.get('situation') || searchParams.get('situations') || '').trim();
  const categoryFromUrl = normalizeSearchCategory(
    searchParams.get('cat') ||
    searchParams.get('category') ||
    searchParams.get('categorie') ||
    searchParams.get('theme')
  );
  const limitFromUrl = parseLimit(searchParams.get('limit'));

  const [queryInput, setQueryInput] = useState(queryFromUrl);
  const [categoryInput, setCategoryInput] = useState(categoryFromUrl);
  const [limitInput, setLimitInput] = useState(limitFromUrl);
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const recordHistory = useCitizenHistory();
  const [demarches, setDemarches] = useState([]);
  const [structures, setStructures] = useState([]);
  const [actualites, setActualites] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalAll: 0, message: null });
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setQueryInput(queryFromUrl);
    setCategoryInput(categoryFromUrl);
    setLimitInput(limitFromUrl);
  }, [queryFromUrl, categoryFromUrl, limitFromUrl]);

  useEffect(() => {
    if (!queryFromUrl) {
      setStatus('idle');
      setResults([]);
      setDemarches([]);
      setStructures([]);
      setActualites([]);
      setMeta({ total: 0, totalAll: 0, message: null });
      setErrorMessage('');
      return;
    }

    if (queryFromUrl.length < 2) {
      setStatus('error');
      setResults([]);
      setDemarches([]);
      setStructures([]);
      setActualites([]);
      setMeta({ total: 0, totalAll: 0, message: null });
      setErrorMessage('Veuillez saisir au moins 2 caractères pour lancer la recherche.');
      return;
    }

    let isMounted = true;
    setStatus('loading');
    setErrorMessage('');

    const controller = new AbortController();

    searchAides({
      query: queryFromUrl,
      category: categoryFromUrl,
      limit: limitFromUrl,
      situations: situationFromUrl ? [situationFromUrl] : undefined,
      signal: controller.signal,
    })
      .then((response) => {
        if (!isMounted) return;

        setResults(response.results);
        setDemarches(response.demarches || []);
        setStructures(response.structures || []);
        setActualites(response.actualites || []);
        setMeta(response.meta);
        const hasAny = response.results.length > 0 || (response.demarches?.length > 0) || (response.structures?.length > 0) || (response.actualites?.length > 0);
        setStatus(hasAny ? 'success' : 'empty');
      })
      .catch((error) => {
        if (!isMounted || isAbortError(error)) return;
        setResults([]);
        setDemarches([]);
        setStructures([]);
        setActualites([]);
        setMeta({ total: 0, totalAll: 0, message: null });
        setStatus('error');
        setErrorMessage(error.message || 'La recherche est temporairement indisponible.');
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [queryFromUrl, categoryFromUrl, limitFromUrl, situationFromUrl, refreshKey]);

  // R12 (C11): a finished search goes to the person's opt-in history (signed-in only; the server keeps nothing unless history is on)
  useEffect(() => {
    if ((status === 'success' || status === 'empty') && queryFromUrl) recordHistory({ kind: 'search', label: queryFromUrl, ref: `/recherche?q=${encodeURIComponent(queryFromUrl)}` });
  }, [status, queryFromUrl, recordHistory]);

  const liveMessage = useMemo(() => {
    if (status === 'loading') return 'Recherche en cours...';
    if (status === 'success') return `${meta.totalAll || meta.total} résultat${(meta.totalAll || meta.total) > 1 ? 's' : ''} trouvé${(meta.totalAll || meta.total) > 1 ? 's' : ''}.`;
    if (status === 'empty') return 'Aucun résultat trouvé.';
    if (status === 'error') return `Erreur de recherche: ${errorMessage}`;
    return 'Recherche prête.';
  }, [status, meta.totalAll, meta.total, errorMessage]);

  // @ts-ignore
  const applySearch = (/** @type {string} */ query, /** @type {unknown} */ category, /** @type {any} */ limit) => {
    const normalizedCategory = normalizeSearchCategory(category);
    const nextParams = buildCanonicalSearchParams(query, normalizedCategory, limit, situationFromUrl);
    const currentParams = buildCanonicalSearchParams(queryFromUrl, categoryFromUrl, limitFromUrl, situationFromUrl);

    setSearchParams(nextParams);
    if (nextParams.toString() === currentParams.toString()) {
      setRefreshKey((value) => value + 1);
    }
  };

  const handleSubmit = (/** @type {{ preventDefault: () => void; }} */ event) => {
    event.preventDefault();
    applySearch(queryInput, categoryInput, limitInput);
  };

  const handleRetry = () => {
    setRefreshKey((value) => value + 1);
  };

  const handleExampleClick = (example) => {
    setQueryInput(example.query);
    setCategoryInput(example.category);
    applySearch(example.query, example.category, limitInput);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <SEO
        title="Recherche - Aides"
        description="Recherchez rapidement des aides sociales par mots-clés et catégorie."
        path="/recherche"
      />

      <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 lg:pt-12">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Recherche intelligente</h1>
          <p className="mt-2 max-w-3xl text-slate-700">
            Saisissez votre besoin pour trouver rapidement des aides pertinentes.
          </p>
        </header>

        <AidesSearchForm
          query={queryInput}
          category={categoryInput}
          limit={limitInput}
          onQueryChange={setQueryInput}
          onCategoryChange={setCategoryInput}
          onLimitChange={setLimitInput}
          onSubmit={handleSubmit}
          isLoading={status === 'loading'}
        />

        <p className="sr-only" role="status" aria-live="polite">
          {liveMessage}
        </p>

        <section className="mt-8">
          {status === 'idle' && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6" data-testid="search-idle-state">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-full bg-blue-100 p-2 text-blue-700">
                  <Search className="h-5 w-5" />
                </div>
                <p className="font-semibold text-slate-900">Exemples de recherche</p>
              </div>
              <p className="text-sm text-slate-700">
                Lancez une requête avec une expression naturelle, puis affinez avec la catégorie.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLE_SEARCHES.map((example) => (
                  <Button
                    key={`${example.query}-${example.category}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExampleClick(example)}
                  >
                    {example.query}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="space-y-3" data-testid="search-loading-state">
              {[1, 2, 3].map((value) => (
                <div key={value} className="rounded-xl border border-slate-200 bg-white p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-3 h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {status === 'error' && (
            <EmptyState
              title="Impossible de charger les résultats"
              description={errorMessage}
              icon={<RotateCcw className="h-6 w-6" />}
              actions={
                <Button type="button" variant="outline" onClick={handleRetry}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Réessayer
                </Button>
              }
              role="alert"
              data-testid="search-error-state"
            />
          )}

          {status === 'empty' && (
            <EmptyState
              title="Aucun résultat"
              description="Essayez de modifier vos filtres ou de réinitialiser votre recherche."
              icon={<Search className="h-6 w-6" />}
              actions={
                <Button type="button" variant="outline" onClick={handleRetry}>
                  Relancer la recherche
                </Button>
              }
              data-testid="search-empty-state"
            />
          )}

          {status === 'success' && (
            <>
              <p className="mb-4 text-sm text-slate-700" data-testid="search-success-state">
                {meta.totalAll || meta.total} résultat{(meta.totalAll || meta.total) > 1 ? 's' : ''} affiché{(meta.totalAll || meta.total) > 1 ? 's' : ''}.
              </p>
              {/* R14: a section that could not be searched is said (it used to look like « no result ») */}
              {meta.message && <p role="status" data-testid="search-partial" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{meta.message}</p>}

              {/* Aides */}
              {results.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Search className="h-5 w-5 text-blue-600" />
                    Aides ({results.length})
                  </h2>
                  <SearchResultsList results={results} />
                </div>
              )}

              {/* Démarches */}
              {demarches.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-indigo-600" />
                    Démarches ({demarches.length})
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {demarches.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number }} */ d) => (
                      <li key={d.id}>
                        <Link
                          to={d.slug ? `/demarches/${d.slug}` : `/demarches/view?id=${d.id}`}
                          className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group"
                        >
                          <h3 className="font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors">{d.title}</h3>
                          {d.description && <p className="text-sm text-slate-700 mt-1 line-clamp-2">{d.description}</p>}
                          <span className="inline-flex items-center gap-1 text-indigo-600 text-sm font-medium mt-2">
                            Voir la démarche <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Structures */}
              {structures.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-green-600" />
                    Structures ({structures.length})
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {structures.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number, ville: string | number }} */ s) => (
                      <li key={s.id}>
                        <Link
                          to={s.slug ? `/structures/${s.slug}` : `/structures/view?id=${s.id}`}
                          className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-green-300 hover:shadow-md transition-all group"
                        >
                          <h3 className="font-semibold text-slate-900 group-hover:text-green-700 transition-colors">{s.title}</h3>
                          {s.ville && <p className="text-xs text-slate-500 mt-0.5">{s.ville}</p>}
                          {s.description && <p className="text-sm text-slate-700 mt-1 line-clamp-2">{s.description}</p>}
                          <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium mt-2">
                            Voir la structure <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actualités */}
              {actualites.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Newspaper className="h-5 w-5 text-amber-600" />
                    Actualités ({actualites.length})
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {actualites.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number }} */ a) => (
                      <li key={a.id}>
                        <Link
                          to={a.slug ? `/actualites/${a.slug}` : `/actualites/view?id=${a.id}`}
                          className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all group"
                        >
                          <h3 className="font-semibold text-slate-900 group-hover:text-amber-700 transition-colors">{a.title}</h3>
                          {a.description && <p className="text-sm text-slate-700 mt-1 line-clamp-2">{a.description}</p>}
                          <span className="inline-flex items-center gap-1 text-amber-600 text-sm font-medium mt-2">
                            Lire la suite <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

