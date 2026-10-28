import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { SEARCH_CATEGORY_OPTIONS } from '@/lib/searchClient';

const LIMIT_OPTIONS = [5, 10, 20];

/**
 * @param {{
 *  query: string,
 *  category: string,
 *  limit: number,
 *  onQueryChange: (value: string) => void,
 *  onCategoryChange: (value: string) => void,
 *  onLimitChange: (value: number) => void,
 *  onSubmit: (event: any) => void,
 *  isLoading?: boolean,
 * }} props
 */
export default function AidesSearchForm(props) {
  const {
    query,
    category,
    limit,
    onQueryChange,
    onCategoryChange,
    onLimitChange,
    onSubmit,
    isLoading = false,
  } = props;
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_120px_auto]">
        <div>
          <label htmlFor="aides-search-query" className="mb-1 block text-sm font-medium text-slate-700">
            Recherche
          </label>
          <Input
            id="aides-search-query"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Ex: loyer étudiant Strasbourg"
            className="h-11"
            autoComplete="off"
            aria-describedby="aides-search-help"
          />
        </div>

        <div>
          <label htmlFor="aides-search-category" className="mb-1 block text-sm font-medium text-slate-700">
            Catégorie
          </label>
          <select
            id="aides-search-category"
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={category}
            onChange={(event) => onCategoryChange(event.target.value)}
          >
            <option value="">Toutes les catégories</option>
            {SEARCH_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="aides-search-limit" className="mb-1 block text-sm font-medium text-slate-700">
            Limite
          </label>
          <select
            id="aides-search-limit"
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={String(limit)}
            onChange={(event) => onLimitChange(Number(event.target.value))}
          >
            {LIMIT_OPTIONS.map((limitValue) => (
              <option key={limitValue} value={String(limitValue)}>
                {limitValue}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <Button
            type="submit"
            className="h-11 w-full bg-slate-900 text-white hover:bg-slate-800 lg:w-auto"
            disabled={isLoading}
          >
            <Search className="mr-2 h-4 w-4" />
            Rechercher
          </Button>
        </div>
      </div>

      <p id="aides-search-help" className="mt-3 text-sm text-slate-700">
        Recherchez par mots-clés, puis affinez avec la catégorie.
      </p>
    </form>
  );
}
