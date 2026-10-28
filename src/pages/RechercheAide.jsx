// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Search, MapPin, Filter, ChevronRight, ChevronDown,
  Phone, Calendar, Globe, ArrowRight,
  FileCheck, Home, Briefcase, Car, Users, Accessibility,
  Brain, ShieldAlert, Wallet, Siren, HeartHandshake, Monitor,
  Building2, Video, Clock, Sparkles, X,
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import AnimatedCard from '@/components/ui/AnimatedCard';
import { useFalc } from '@/contexts/FalcContext';

// ── Icon map ────────────────────────────────────────────────────
const ICON_MAP = {
  FileCheck, Home, Briefcase, Car, Users, Accessibility,
  Brain, ShieldAlert, Wallet, Siren, HeartHandshake, Monitor,
  Building2, Phone, Video, Clock, Search,
};

function getIcon(name, fallback = Search) {
  return ICON_MAP[name] || fallback;
}

// ── Need Selector Grid ─────────────────────────────────────────
// @ts-ignore
function NeedSelector({ needs, selected, onToggle }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {needs.map((need) => {
        const Icon = getIcon(need.icon);
        const isSelected = selected.includes(need.slug);
        return (
          <button
            key={need.slug}
            type="button"
            onClick={() => onToggle(need.slug)}
            className={`
              group relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200
              hover:shadow-md hover:-translate-y-0.5 cursor-pointer
              ${isSelected
                ? 'border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-200'
                : 'border-slate-200 bg-white hover:border-blue-300'
              }
            `}
            aria-pressed={isSelected}
            id={`need-${need.slug}`}
          >
            <div className={`
              w-10 h-10 rounded-full flex items-center justify-center transition-colors
              ${isSelected ? 'bg-blue-500 text-white' : `${need.color || 'bg-slate-100 text-slate-600'}`}
            `}>
              <Icon className="h-5 w-5" />
            </div>
            <span className={`text-sm font-medium text-center leading-tight ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
              {need.label}
            </span>
            {isSelected && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Result Card ─────────────────────────────────────────────────
// @ts-ignore
function ProSearchCard({ structure, index }) {
  const { isFalcEnabled } = useFalc();
  const targetUrl = structure.slug ? `/structures/${structure.slug}` : `/structures/view?id=${structure.id}`;
  const rdvUrl = structure.slug ? `/rdv/${structure.slug}` : null;
  const hasRdv = structure.rdv?.isPublished;
  const professionals = structure.professionals || [];

  return (
    <AnimatedCard index={index}>
      <Card className="group hover:shadow-lg transition-all duration-300 border-slate-200 hover:border-blue-300 bg-white" data-testid="pro-search-card">
        <CardContent className="p-5">
          <div className="flex flex-col gap-3">
            {/* Type + badges */}
            <div className="flex flex-wrap gap-2 items-start justify-between">
              <div className="flex flex-wrap gap-1.5">
                {structure.needs?.slice(0, 3).map(n => (
                  <Badge key={n.slug} className={n.color || 'bg-slate-100 text-slate-700'} variant="secondary">
                    {n.label}
                  </Badge>
                ))}
                {structure.needs?.length > 3 && (
                  <Badge variant="outline" className="text-slate-500">+{structure.needs.length - 3}</Badge>
                )}
              </div>
              {hasRdv && (
                <Badge className="bg-green-100 text-green-700 border-green-300">
                  <Calendar className="h-3 w-3 mr-1" />
                  RDV en ligne
                </Badge>
              )}
            </div>

            {/* Name */}
            <Link to={targetUrl} className="group-hover:text-blue-700 transition-colors">
              <h3 className="font-semibold text-lg text-slate-900">
                {structure.nom}
              </h3>
            </Link>

            {/* Description */}
            {(structure.description_courte || (isFalcEnabled && structure.summary_falc)) && (
              <p className="text-slate-600 text-sm line-clamp-3">
                {isFalcEnabled && structure.summary_falc ? structure.summary_falc : structure.description_courte}
              </p>
            )}

            {/* Professionals */}
            {professionals.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {professionals.slice(0, 3).map(pro => (
                  <div key={pro.id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border">
                    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                      {(pro.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="text-xs">
                      <div className="font-medium text-slate-700">{pro.displayName}</div>
                      {pro.jobTitle && <div className="text-slate-500">{pro.jobTitle}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Location + contact */}
            <div className="space-y-1.5 text-sm text-slate-600">
              {structure.adresse && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <span>{structure.adresse}, {structure.code_postal} {structure.ville}</span>
                </div>
              )}
              {structure.telephone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  <a href={`tel:${structure.telephone}`} className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>
                    {structure.telephone}
                  </a>
                </div>
              )}
            </div>

            {/* Modalities */}
            {structure.modalities?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {structure.modalities.map(m => {
                  const MIcon = getIcon(m.icon, Building2);
                  return (
                    <Badge key={m.slug} variant="outline" className="text-slate-600 border-slate-300">
                      <MIcon className="h-3 w-3 mr-1" />
                      {m.label}
                    </Badge>
                  );
                })}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-slate-100">
              <Link to={targetUrl}>
                <Button variant="outline" size="sm">
                  Voir la fiche
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
              {hasRdv && rdvUrl && (
                <Link to={rdvUrl}>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Calendar className="h-4 w-4 mr-1" />
                    Prendre RDV
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}

// ── Static fallback data (renders immediately, API updates later) ──
const STATIC_NEEDS = [
  { slug: 'acces_droits', label: 'Accès aux droits', icon: 'FileCheck', color: 'bg-emerald-100 text-emerald-800' },
  { slug: 'logement', label: 'Logement', icon: 'Home', color: 'bg-orange-100 text-orange-800' },
  { slug: 'emploi', label: 'Emploi / Insertion', icon: 'Briefcase', color: 'bg-blue-100 text-blue-800' },
  { slug: 'mobilite', label: 'Mobilité', icon: 'Car', color: 'bg-cyan-100 text-cyan-800' },
  { slug: 'famille', label: 'Famille / Parentalité', icon: 'Users', color: 'bg-pink-100 text-pink-800' },
  { slug: 'handicap', label: 'Handicap', icon: 'Accessibility', color: 'bg-purple-100 text-purple-800' },
  { slug: 'sante_mentale', label: 'Santé mentale / Addictions', icon: 'Brain', color: 'bg-violet-100 text-violet-800' },
  { slug: 'violences', label: 'Violences', icon: 'ShieldAlert', color: 'bg-red-100 text-red-800' },
  { slug: 'budget', label: 'Budget / Surendettement', icon: 'Wallet', color: 'bg-yellow-100 text-yellow-800' },
  { slug: 'urgence', label: 'Urgence sociale', icon: 'Siren', color: 'bg-red-200 text-red-900' },
  { slug: 'isolement', label: 'Isolement / Lien social', icon: 'HeartHandshake', color: 'bg-amber-100 text-amber-800' },
  { slug: 'numerique', label: 'Numérique', icon: 'Monitor', color: 'bg-indigo-100 text-indigo-800' },
];

// ── API helper (POST /api/search-pro) ──────────────────────────
async function searchProApi(body) {
  const res = await fetch('/api/search-pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Main Page ───────────────────────────────────────────────────
export default function RechercheAide() {
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [step, setStep] = useState('needs'); // 'needs' | 'results'
  const [selectedNeeds, setSelectedNeeds] = useState(() => {
    const n = searchParams.get('needs');
    return n ? n.split(',').filter(Boolean) : [];
  });
  const [territory, setTerritory] = useState(searchParams.get('territoire') || '');
  const [freeText, setFreeText] = useState(searchParams.get('q') || '');

  // API data — use static fallback immediately, API can enrich later
  const [facets, setFacets] = useState({ needs: STATIC_NEEDS, audiences: [], modalities: [] });
  const [results, setResults] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Fetch facets on mount (updates static data with live counts)
  useEffect(() => {
    async function fetchFacets() {
      try {
        const res = await searchProApi({ needs: [], page: 1, limit: 1 });
        // R7: an empty taxonomy (none seeded) must not erase the built-in needs — the page then had no need to choose and could never search
        if (res.facets) setFacets((prev) => ({ ...res.facets, needs: res.facets.needs?.length ? res.facets.needs : prev.needs }));
      } catch {
        // Static fallback already loaded — UI works without API
      }
    }
    fetchFacets();
  }, []);

  // Toggle need
  const toggleNeed = useCallback((/** @type {string} */ slug) => {
    setSelectedNeeds(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    );
  }, []);

  // Search
  const doSearch = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setStep('results');
    setSearchError('');
    try {
      const res = await searchProApi({
        needs: selectedNeeds,
        territory: territory.trim(),
        q: freeText.trim(),
        page: pageNum,
        limit: 12,
      });
      setResults(res);
      setPage(pageNum);

      // Update URL
      const params = new URLSearchParams();
      if (selectedNeeds.length) params.set('needs', selectedNeeds.join(','));
      if (territory.trim()) params.set('territoire', territory.trim());
      if (freeText.trim()) params.set('q', freeText.trim());
      setSearchParams(params, { replace: true });
    } catch (err) {
      // R7: a failed search is not « Aucun résultat » (the error was only written to the console)
      setResults(null);
      setSearchError('La recherche n’a pas pu aboutir. Ce n’est pas une absence de structure : réessayez dans un instant.');
    } finally {
      setLoading(false);
    }
  }, [selectedNeeds, territory, freeText, setSearchParams]);

  // R7: a shared link /trouver-aide?needs=… shows its results (it only preselected the needs)
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (!autoRan && searchParams.get('needs')) { setAutoRan(true); doSearch(1); }
  }, [autoRan, searchParams, doSearch]);

  const clearFilters = () => {
    setSelectedNeeds([]);
    setTerritory('');
    setFreeText('');
    setResults(null);
    setStep('needs');
    setSearchParams({}, { replace: true });
  };

  const totalResults = results?.pagination?.total || 0;
  const structures = results?.structures || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50">
      <Helmet>
        <title>Trouver de l'aide — Accès Direct Aide</title>
        <meta name="description" content="Trouvez un professionnel du social ou médico-social près de chez vous. Exprimez votre besoin et accédez à un accompagnement adapté." />
      </Helmet>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-5xl mx-auto px-4 py-12 sm:py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-full mb-4">
            <Sparkles className="h-4 w-4 text-yellow-300" />
            <span className="text-sm font-medium text-blue-100">Nouveau parcours simplifié</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
            Trouvez de l'aide<br />près de chez vous
          </h1>
          <p className="text-lg sm:text-xl text-blue-100 max-w-2xl mx-auto">
            Exprimez votre besoin en quelques clics. Nous vous mettons en relation avec les structures et professionnels qui peuvent vous accompagner.
          </p>
        </div>
      </section>

      {/* ── Content ──────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-8 text-sm">
          <button
            onClick={() => setStep('needs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all ${
              step === 'needs'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border hover:border-blue-300'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">1</span>
            Mon besoin
          </button>
          <ChevronRight className="h-4 w-4 text-slate-400" />
          <button
            onClick={() => selectedNeeds.length > 0 && doSearch()}
            disabled={selectedNeeds.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all ${
              step === 'results'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border hover:border-blue-300 disabled:opacity-50'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">2</span>
            Résultats
          </button>
        </div>

        {/* ── Step 1: Need Selection ──────────────────────────── */}
        {step === 'needs' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                J'ai besoin d'aide pour…
              </h2>
              <p className="text-slate-600">
                Sélectionnez un ou plusieurs besoins. Nous trouverons les structures adaptées.
              </p>
            </div>

            {facets?.needs ? (
              <NeedSelector
                needs={facets.needs}
                selected={selectedNeeds}
                onToggle={toggleNeed}
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            )}

            {/* Territory + free text */}
            <div className="bg-white rounded-2xl border p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700 font-medium">
                <MapPin className="h-5 w-5 text-blue-500" />
                <span>Où habitez-vous ?</span>
                <span className="text-slate-400 text-sm font-normal">(optionnel)</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="text"
                  placeholder="Ville ou n° de département (ex: 75, Lyon)"
                  value={territory}
                  onChange={e => setTerritory(e.target.value)}
                  className="flex-1"
                  id="territory-input"
                />
                <Input
                  type="text"
                  placeholder="Mot-clé (optionnel)"
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  className="flex-1"
                  id="freetext-input"
                />
              </div>
            </div>

            {/* CTA */}
            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={() => doSearch()}
                disabled={selectedNeeds.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg rounded-xl shadow-lg hover:shadow-xl transition-all"
                id="search-button"
              >
                <Search className="h-5 w-5 mr-2" />
                Rechercher ({selectedNeeds.length} besoin{selectedNeeds.length > 1 ? 's' : ''} sélectionné{selectedNeeds.length > 1 ? 's' : ''})
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Results ─────────────────────────────────── */}
        {step === 'results' && (
          <div className="space-y-6">
            {/* Active filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              {selectedNeeds.map(slug => {
                const need = facets?.needs?.find(n => n.slug === slug);
                return (
                  <Badge key={slug} className="bg-blue-100 text-blue-700 cursor-pointer hover:bg-blue-200" onClick={() => toggleNeed(slug)}>
                    {need?.label || slug}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                );
              })}
              {territory && (
                <Badge variant="outline" className="text-slate-600">
                  <MapPin className="h-3 w-3 mr-1" />
                  {territory}
                </Badge>
              )}
              <button onClick={clearFilters} className="text-sm text-slate-500 hover:text-red-600 ml-2 transition-colors">
                Tout effacer
              </button>
            </div>

            {/* Results count */}
            <div className="flex items-center justify-between">
              <p className="text-slate-600">
                {loading ? 'Recherche en cours…' : searchError ? null : (
                  totalResults === 0
                    ? 'Aucun résultat trouvé'
                    : <><strong>{totalResults}</strong> structure{totalResults > 1 ? 's' : ''} trouvée{totalResults > 1 ? 's' : ''}</>
                )}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setStep('needs')}>
                ← Modifier ma recherche
              </Button>
            </div>

            {/* Loading */}
            {loading && (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            )}

            {/* Results list */}
            {!loading && structures.length > 0 && (
              <div className="space-y-4">
                {structures.map((
// @ts-ignore
                s, i) => (
                  <ProSearchCard key={s.id} structure={s} index={i} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && !searchError && results?.needsMatchedBy === 'declared_categories' ? (
              <p className="text-sm text-slate-600" data-testid="search-pro-needs-approx">
                Le besoin choisi est recherché dans les catégories et les services que les structures déclarent elles-mêmes (sources officielles).
              </p>
            ) : null}
            {!loading && searchError ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="search-pro-error">
                {searchError}{' '}
                <button type="button" className="underline font-medium" onClick={() => doSearch(page)} data-testid="search-pro-retry">Réessayer</button>
              </div>
            ) : null}
            {!loading && !searchError && totalResults === 0 && (
              <div className="text-center py-16">
                <div className="w-20 h-20 mx-auto bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <Search className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-xl font-semibold text-slate-700 mb-2">
                  Aucune structure trouvée
                </h3>
                <p className="text-slate-500 max-w-md mx-auto mb-6">
                  Essayez de modifier vos critères de recherche ou élargissez la zone géographique.
                </p>
                <Button variant="outline" onClick={() => setStep('needs')}>
                  Modifier ma recherche
                </Button>
              </div>
            )}

            {/* Pagination */}
            {!loading && results?.pagination?.totalPages > 1 && (
              <div className="flex justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => doSearch(page - 1)}
                >
                  Précédent
                </Button>
                <span className="flex items-center px-4 text-sm text-slate-600">
                  Page {page} / {results.pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={!results.pagination.hasNext}
                  onClick={() => doSearch(page + 1)}
                >
                  Suivant
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
