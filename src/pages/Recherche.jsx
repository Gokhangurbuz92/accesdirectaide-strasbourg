// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, RotateCcw, FileText, Building2, Newspaper, ArrowRight, BookOpen } from 'lucide-react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import AidesSearchForm from '@/components/search/AidesSearchForm';
import SearchResultsList from '@/components/search/SearchResultsList';
import { isAbortError, normalizeSearchCategory, searchAides } from '@/lib/searchClient';
import useCitizenHistory from '@/hooks/useCitizenHistory';
import { useLanguage, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

const DEFAULT_LIMIT = 10;
// R32: `key` names the translated wording of each example; the example searches in the interface language
const EXAMPLE_SEARCHES = [
  { key: 'rent', query: 'loyer étudiant Strasbourg', category: 'LOGEMENT' },
  { key: 'transport', query: 'aide transport travail', category: 'MOBILITE' },
  { key: 'health', query: 'complémentaire santé solidaire', category: 'SANTE' },
];

/**
 * R32: the search library's own French error messages, in the interface language. Any other text (the server's own words) is shown as it is.
 * @returns {string | null}
 */
function knownErrorText(t, message) {
  switch (message) {
    case '':
    case 'La recherche est temporairement indisponible.': return t('search:error.unavailable', 'La recherche est temporairement indisponible.');
    case 'La recherche a été refusée par sécurité. Rechargez la page puis réessayez.': return t('search:error.refused', 'La recherche a été refusée par sécurité. Rechargez la page puis réessayez.');
    case 'Le service de recherche est temporairement indisponible.': return t('search:error.service-down', 'Le service de recherche est temporairement indisponible.');
    case 'La requête de recherche est invalide.': return t('search:error.invalid', 'La requête de recherche est invalide.');
    case 'La recherche a échoué.': return t('search:error.failed', 'La recherche a échoué.');
    default: return null;
  }
}

/** R32: one démarche result; its title and summary go through the content translation (French, marked lang="fr", until a verified translation exists) */
function DemarcheResult({ d }) {
  const { t } = useT('search');
  const tr = useContentTranslation('demarche', d);
  const description = tr.value('description');
  return (
    <li>
      <Link
        to={d.slug ? `/demarches/${d.slug}` : `/demarches/view?id=${d.id}`}
        className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group"
      >
        <h3 className="font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors" {...tr.attrs('title')}>{tr.value('title')}</h3>
        {description && <p className="text-sm text-slate-700 mt-1 line-clamp-2" {...tr.attrs('description')}>{description}</p>}
        <span className="inline-flex items-center gap-1 text-indigo-600 text-sm font-medium mt-2">
          {t('search:link.demarche', 'Voir la démarche')} <ArrowRight className="rtl-flip h-3 w-3" />
        </span>
      </Link>
    </li>
  );
}

/** R32: one place (structure) result: its name and town are never translated, only marked French */
function StructureResult({ s }) {
  const { t } = useT('search');
  const tr = useContentTranslation('structure', s);
  const description = tr.value('description');
  return (
    <li>
      <Link
        to={s.slug ? `/structures/${s.slug}` : `/structures/view?id=${s.id}`}
        className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-green-300 hover:shadow-md transition-all group"
      >
        <h3 className="font-semibold text-slate-900 group-hover:text-green-700 transition-colors" {...tr.attrs('title')}>{s.title}</h3>
        {s.ville && <p className="text-xs text-slate-500 mt-0.5" {...tr.attrs('ville')}>{s.ville}</p>}
        {description && <p className="text-sm text-slate-700 mt-1 line-clamp-2" {...tr.attrs('description')}>{description}</p>}
        <span className="inline-flex items-center gap-1 text-green-700 text-sm font-medium mt-2">
          {t('search:link.structure', 'Voir la structure')} <ArrowRight className="rtl-flip h-3 w-3" />
        </span>
      </Link>
    </li>
  );
}

/** R33: one official guide (Service-Public sheet), title through the content translation */
function GuideResult({ g }) {
  const { t } = useT('search');
  const tr = useContentTranslation('guide', g);
  return (
    <li>
      <Link to={`/guides/${g.slug}`} className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all group">
        <h3 className="font-semibold text-slate-900 group-hover:text-blue-800 transition-colors" {...tr.attrs('title')}>{tr.value('title')}</h3>
        {g.description && <p className="text-sm text-slate-700 mt-1 line-clamp-2" lang="fr">{g.description}</p>}
        <span className="inline-flex items-center gap-1 text-blue-800 text-sm font-medium mt-2">
          {t('search:link.guide', 'Lire la fiche officielle')} <ArrowRight className="rtl-flip h-3 w-3" />
        </span>
      </Link>
    </li>
  );
}

/** R32: one news result (title and summary through the content translation) */
function ActualiteResult({ a }) {
  const { t } = useT('search');
  const tr = useContentTranslation('actualite', a);
  const description = tr.value('description');
  return (
    <li>
      <Link
        to={a.slug ? `/actualites/${a.slug}` : `/actualites/view?id=${a.id}`}
        className="block p-4 bg-white rounded-xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all group"
      >
        <h3 className="font-semibold text-slate-900 group-hover:text-amber-700 transition-colors" {...tr.attrs('title')}>{tr.value('title')}</h3>
        {description && <p className="text-sm text-slate-700 mt-1 line-clamp-2" {...tr.attrs('description')}>{description}</p>}
        <span className="inline-flex items-center gap-1 text-amber-800 text-sm font-medium mt-2">
          {t('search:link.actualite', 'Lire la suite')} <ArrowRight className="rtl-flip h-3 w-3" />
        </span>
      </Link>
    </li>
  );
}

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
  const { t } = useT('search');
  const { isSource } = useLanguage();
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
  const [guides, setGuides] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalAll: 0, message: null });
  // R32: what went wrong, put into words at render (the interface language may change): « too-short », or the search library's message
  const [searchError, setSearchError] = useState(/** @type {null | { code?: string, message?: string }} */ (null));

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
      setSearchError(null);
      return;
    }

    if (queryFromUrl.length < 2) {
      setStatus('error');
      setResults([]);
      setDemarches([]);
      setStructures([]);
      setActualites([]);
      setMeta({ total: 0, totalAll: 0, message: null });
      setSearchError({ code: 'too-short' });
      return;
    }

    let isMounted = true;
    setStatus('loading');
    setSearchError(null);

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
        setGuides(response.guides || []);
        setMeta(response.meta);
        const hasAny = response.results.length > 0 || (response.demarches?.length > 0) || (response.structures?.length > 0) || (response.actualites?.length > 0) || (response.guides?.length > 0);
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
        setSearchError({ message: error.message || '' });
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

  const knownError = searchError?.code === 'too-short'
    ? t('search:error.too-short', 'Veuillez saisir au moins 2 caractères pour lancer la recherche.')
    : searchError ? knownErrorText(t, searchError.message) : null;
  const errorMessage = searchError ? (knownError ?? searchError.message) : '';
  // the server's own words are French: marked as such when the interface is in another language
  const errorDescription = searchError && knownError === null && !isSource ? <span lang="fr" dir="ltr">{errorMessage}</span> : errorMessage;
  const total = meta.totalAll || meta.total;

  const liveMessage = useMemo(() => {
    if (status === 'loading') return t('search:live.loading', 'Recherche en cours...');
    if (status === 'success') return t('search:live.found', { count: total, defaultValue_one: '{{count}} résultat trouvé.', defaultValue_other: '{{count}} résultats trouvés.' });
    if (status === 'empty') return t('search:live.empty', 'Aucun résultat trouvé.');
    if (status === 'error') return t('search:live.error', 'Erreur de recherche: {{message}}', { message: errorMessage });
    return t('search:live.ready', 'Recherche prête.');
  }, [status, total, errorMessage, t]);

  // R32: the example searches in the interface language (a later cross-language lexicon makes them searchable in every language)
  const exampleQueries = {
    rent: t('search:example.rent', 'loyer étudiant Strasbourg'),
    transport: t('search:example.transport', 'aide transport travail'),
    health: t('search:example.health', 'complémentaire santé solidaire'),
  };
  const exampleQuery = (example) => exampleQueries[example.key] ?? example.query;

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
    const query = exampleQuery(example);
    setQueryInput(query);
    setCategoryInput(example.category);
    applySearch(query, example.category, limitInput);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <SEO
        title={t('search:seo.title', 'Recherche - Aides')}
        description={t('search:seo.description', 'Recherchez rapidement des aides sociales par mots-clés et catégorie.')}
        path="/recherche"
      />

      <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 lg:pt-12">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">{t('search:page.title', 'Recherche intelligente')}</h1>
          <p className="mt-2 max-w-3xl text-slate-700">
            {t('search:page.intro', 'Saisissez votre besoin pour trouver rapidement des aides pertinentes.')}
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
                <p className="font-semibold text-slate-900">{t('search:idle.title', 'Exemples de recherche')}</p>
              </div>
              <p className="text-sm text-slate-700">
                {t('search:idle.text', 'Lancez une requête avec une expression naturelle, puis affinez avec la catégorie.')}
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
                    {exampleQuery(example)}
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
              title={t('search:error.title', 'Impossible de charger les résultats')}
              description={errorDescription}
              icon={<RotateCcw className="h-6 w-6" />}
              actions={
                <Button type="button" variant="outline" onClick={handleRetry}>
                  <RotateCcw className="me-2 h-4 w-4" />
                  {t('search:retry', 'Réessayer')}
                </Button>
              }
              role="alert"
              data-testid="search-error-state"
            />
          )}

          {status === 'empty' && (
            <EmptyState
              title={t('search:empty.title', 'Aucun résultat')}
              description={t('search:empty.text', 'Essayez de modifier vos filtres ou de réinitialiser votre recherche.')}
              icon={<Search className="h-6 w-6" />}
              actions={
                <Button type="button" variant="outline" onClick={handleRetry}>
                  {t('search:empty.rerun', 'Relancer la recherche')}
                </Button>
              }
              data-testid="search-empty-state"
            />
          )}

          {status === 'success' && (
            <>
              <p className="mb-4 text-sm text-slate-700" data-testid="search-success-state">
                {t('search:success.count', { count: total, defaultValue_one: '{{count}} résultat affiché.', defaultValue_other: '{{count}} résultats affichés.' })}
              </p>
              {/* R14: a section that could not be searched is said (it used to look like « no result ») — the server's words, in French */}
              {meta.message && <p role="status" data-testid="search-partial" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" {...(isSource ? {} : { lang: 'fr', dir: 'ltr' })}>{meta.message}</p>}

              {/* Aides */}
              {results.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Search className="h-5 w-5 text-blue-600" />
                    {t('search:section.aides', 'Aides ({{n}})', { n: results.length })}
                  </h2>
                  <SearchResultsList results={results} />
                </div>
              )}

              {/* Démarches */}
              {demarches.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-indigo-600" />
                    {t('search:section.demarches', 'Démarches ({{n}})', { n: demarches.length })}
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {demarches.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number }} */ d) => (
                      <DemarcheResult key={d.id} d={d} />
                    ))}
                  </ul>
                </div>
              )}

              {/* Structures */}
              {structures.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-green-600" />
                    {t('search:section.structures', 'Structures ({{n}})', { n: structures.length })}
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {structures.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number, ville: string | number }} */ s) => (
                      <StructureResult key={s.id} s={s} />
                    ))}
                  </ul>
                </div>
              )}

              {/* R33: guides */}
              {guides.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-blue-700" aria-hidden="true" />
                    {t('search:section.guides', 'Fiches pratiques officielles ({{n}})', { n: guides.length })}
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {guides.map((/** @type {{ description: string, id: string, slug: string, title: string }} */ g) => (
                      <GuideResult key={g.id} g={g} />
                    ))}
                  </ul>
                </div>
              )}

              {/* Actualités */}
              {actualites.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Newspaper className="h-5 w-5 text-amber-600" />
                    {t('search:section.actualites', 'Actualités ({{n}})', { n: actualites.length })}
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {actualites.map((/** @type {{ description: string | number, id: string | number, slug: string | number, title: string | number }} */ a) => (
                      <ActualiteResult key={a.id} a={a} />
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
