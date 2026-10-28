// @ts-nocheck
import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MapPin, Filter, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const CATEGORIES = [
  { value: 'logement', label: 'Logement' },
  { value: 'sante', label: 'Santé' },
  { value: 'handicap', label: 'Handicap' },
  { value: 'emploi', label: 'Emploi / Formation' },
  { value: 'famille', label: 'Famille' },
  { value: 'budget', label: 'Budget / Dettes' },
  { value: 'mobilite', label: 'Mobilité' },
  { value: 'justice', label: 'Justice / Droits' },
  { value: 'numerique', label: 'Numérique' },
  { value: 'etrangers', label: 'Nouveaux arrivants' },
  { value: 'isolement', label: 'Isolement' },
  { value: 'lgbtqia', label: 'LGBTQIA+' },
  { value: 'vieillissement', label: 'Autonomie / Âge' },
];

const SITUATIONS = [
  { value: 'perte_emploi', label: 'Perte d\'emploi' },
  { value: 'separation', label: 'Séparation' },
  { value: 'violence', label: 'Violence' },
  { value: 'arrivee_france', label: 'Arrivée en France' },
  { value: 'maladie', label: 'Maladie' },
  { value: 'naissance', label: 'Naissance' },
  { value: 'deces', label: 'Décès proche' },
  { value: 'expulsion', label: 'Risque expulsion' },
  { value: 'surendettement', label: 'Dettes' },
  { value: 'handicap_nouveau', label: 'Handicap récent' },
];

const DEPARTEMENTS = [
  { value: '67', label: 'Bas-Rhin (67)' },
  { value: '68', label: 'Haut-Rhin (68)' },
  { value: 'national', label: 'France entière' },
];

export default function SearchBar({ onSearch, showFilters = true, compact = false, initialValue = '' }) {
  const [query, setQuery] = useState(initialValue);
  const [filters, setFilters] = useState({
    departement: '',
    categorie: '',
    situation: '',
    urgent: false
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSearch = (/** @type {{ preventDefault: () => void; }} */ e) => {
    e?.preventDefault();
    onSearch?.({ query, ...filters });
  };

  const clearFilters = () => {
    setFilters({
      departement: '',
      categorie: '',
      situation: '',
      urgent: false
    });
  };

  const activeFiltersCount = Object.values(filters).filter(v => v && v !== '').length;

  return (
    <form onSubmit={handleSearch} className="w-full">
      <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-4'}`}>
        {/* Barre de recherche principale */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <label htmlFor="search-input" className="sr-only">Rechercher une aide</label>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              id="search-input"
              type="text"
              placeholder="Rechercher une aide, une démarche, une structure..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`pl-12 ${compact ? 'h-11' : 'h-14 text-lg'} bg-white border-slate-200 focus:border-blue-500 focus:ring-blue-500`}
            />
          </div>
          <Button
            type="submit"
            className={`${compact ? 'h-11 px-4' : 'h-14 px-8'} bg-blue-600 hover:bg-blue-700 text-white font-medium`}
          >
            <Search className="h-5 w-5 sm:mr-2" />
            <span className="hidden sm:inline">Rechercher</span>
          </Button>
        </div>

        {/* Filtres rapides */}
        {showFilters && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select
                value={filters.departement}
                onValueChange={(value) => setFilters(prev => ({ ...prev, departement: value }))}
              >
                <SelectTrigger className="w-full sm:w-auto sm:min-w-[160px] bg-white">
                  <MapPin className="h-4 w-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Département" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTEMENTS.map(dept => (
                    <SelectItem key={dept.value} value={dept.value}>
                      {dept.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.categorie}
                onValueChange={(value) => setFilters(prev => ({ ...prev, categorie: value }))}
              >
                <SelectTrigger className="w-full sm:w-auto sm:min-w-[160px] bg-white">
                  <SelectValue placeholder="Catégorie" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant={filters.urgent ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters(prev => ({ ...prev, urgent: !prev.urgent }))}
                className={filters.urgent ? "bg-red-600 hover:bg-red-700" : ""}
              >
                🚨 Urgence
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-slate-600"
              >
                <Filter className="h-4 w-4 mr-1" />
                Plus de filtres
                {activeFiltersCount > 0 && (
                  <Badge className="ml-2 bg-blue-100 text-blue-700">
                    {activeFiltersCount}
                  </Badge>
                )}
              </Button>

              {activeFiltersCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-slate-500"
                >
                  <X className="h-4 w-4 mr-1" />
                  Effacer
                </Button>
              )}
            </div>

            {/* Filtres avancés */}
            {showAdvanced && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <h4 className="font-medium text-slate-700 mb-3">
                  Filtrer par situation de vie
                </h4>
                <div className="flex flex-wrap gap-2">
                  {SITUATIONS.map(sit => (
                    <Button
                      key={sit.value}
                      type="button"
                      variant={filters.situation === sit.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilters(prev => ({
                        ...prev,
                        situation: prev.situation === sit.value ? '' : sit.value
                      }))}
                      className="text-sm"
                    >
                      {sit.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}
