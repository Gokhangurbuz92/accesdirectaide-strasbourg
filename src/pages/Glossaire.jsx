// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, BookOpen, ExternalLink } from 'lucide-react';
import LoadError from '@/components/LoadError';

const CATEGORIES = [
  { value: '', label: 'Toutes les catégories' },
  { value: 'EMPLOI', label: 'Emploi' },
  { value: 'LOGEMENT', label: 'Logement' },
  { value: 'SANTE', label: 'Santé' },
  { value: 'FAMILLE', label: 'Famille' },
  { value: 'HANDICAP', label: 'Handicap' },
  { value: 'ENERGIE', label: 'Énergie' },
  { value: 'ACCESSIBILITE', label: 'Accessibilité' },
  { value: 'ACCOMPAGNEMENT', label: 'Accompagnement' },
];

const CATEGORY_COLORS = {
  EMPLOI: 'bg-blue-100 text-blue-800',
  LOGEMENT: 'bg-emerald-100 text-emerald-800',
  SANTE: 'bg-red-100 text-red-800',
  FAMILLE: 'bg-purple-100 text-purple-800',
  HANDICAP: 'bg-amber-100 text-amber-800',
  ENERGIE: 'bg-orange-100 text-orange-800',
  ACCESSIBILITE: 'bg-indigo-100 text-indigo-800',
  ACCOMPAGNEMENT: 'bg-teal-100 text-teal-800',
};

/**
 * Glossaire — public glossary of social aid terminology.
 * Fetches from GET /api/glossaire with q and categorie filters.
 */
export default function Glossaire() {
  const [search, setSearch] = useState('');
  const [categorie, setCategorie] = useState('');

  const params = new URLSearchParams();
  if (search.trim()) params.set('q', search.trim());
  if (categorie) params.set('categorie', categorie);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['glossaire', search.trim(), categorie],
    queryFn: () =>
      fetch(`/api/glossaire?${params.toString()}`).then((r) => { if (!r.ok) throw new Error(`glossaire ${r.status}`); return r.json(); }),
    keepPreviousData: true,
  });

  const termes = data?.items || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title="Glossaire des aides sociales | AccesDirectAide"
        description="Comprendre les sigles et termes des aides sociales françaises : RSA, APL, AAH, CAF, MDPH... Expliqués simplement."
        path="/glossaire"
      />

      {/* Hero */}
      <div
        className="relative overflow-hidden py-10 sm:py-14"
        style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 30%, #1e3a8a 60%, #3730a3 85%, #4F46E5 100%)' }}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden="true" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="h-8 w-8 text-blue-300" />
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Glossaire
            </h1>
          </div>
          <p className="text-blue-100/80 text-sm sm:text-base">
            Les termes et acronymes des aides sociales, expliqués simplement.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un terme (ex: RSA, APL, CAF...)"
              aria-label="Rechercher dans le glossaire"
              className="pl-10 h-11 bg-white"
            />
          </div>
          <select
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filtrer par catégorie"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <p className="text-sm text-slate-700" role="status">
          {isLoading ? 'Chargement...' : isError ? '' : `${termes.length} terme${termes.length > 1 ? 's' : ''} trouvé${termes.length > 1 ? 's' : ''}`}
        </p>

        {/* Results */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-xl border bg-white p-5">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-1 h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <LoadError what="le glossaire" onRetry={() => refetch()} testId="glossaire-error" />
        ) : termes.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <BookOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-700">Aucun terme trouvé.</p>
              {(search || categorie) && (
                <p className="text-sm text-slate-700 mt-1">Essayez un autre mot-clé ou catégorie.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {termes.map((t) => (
              <Card key={t.terme} id={t.terme} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-slate-900">
                          {t.terme}
                        </h2>
                        <Badge className={`border-0 text-xs ${CATEGORY_COLORS[t.categorie] || 'bg-slate-100 text-slate-800'}`}>
                          {t.categorie}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-slate-700 text-sm leading-relaxed">
                        {t.definition}
                      </p>
                    </div>
                    {t.lien && (
                      <Link
                        to={t.lien}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium whitespace-nowrap shrink-0"
                      >
                        Voir <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Help text */}
        <p className="text-center text-sm text-slate-700 pt-4">
          Vous ne trouvez pas un terme ?{' '}
          <Link to="/contact" className="text-blue-800 hover:text-blue-900 underline">
            Contactez-nous
          </Link>
        </p>
      </div>
    </div>
  );
}
