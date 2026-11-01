import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { SEARCH_CATEGORY_OPTIONS } from '@/lib/searchClient';
import { useT } from '@/i18n';

const LIMIT_OPTIONS = [5, 10, 20];

/** R32: a search category in the interface language (the option values sent to the API do not change) */
function categoryLabel(t, value) {
  switch (value) {
    case 'papiers-citoyennete': return t('search:category.papiers-citoyennete', 'Papiers - Citoyenneté');
    case 'famille': return t('search:category.famille', 'Famille');
    case 'social-sante': return t('search:category.social-sante', 'Social - Santé');
    case 'personnes-agees': return t('search:category.personnes-agees', 'Personnes âgées');
    case 'handicap': return t('search:category.handicap', 'Handicap');
    case 'travail-formation': return t('search:category.travail-formation', 'Travail - Formation');
    case 'logement': return t('search:category.logement', 'Logement');
    case 'transports': return t('search:category.transports', 'Transports');
    case 'argent': return t('search:category.argent', 'Argent - Impôts');
    case 'justice': return t('search:category.justice', 'Justice');
    case 'etranger': return t('search:category.etranger', 'Étranger');
    case 'loisirs': return t('search:category.loisirs', 'Loisirs - Sport - Culture');
    case 'lgbtqi-plus': return t('search:category.lgbtqi-plus', 'LGBTQI+');
    default: return null;
  }
}

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
  const { t } = useT('search');
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_120px_auto]">
        <div>
          <label htmlFor="aides-search-query" className="mb-1 block text-sm font-medium text-slate-700">
            {t('search:form.query', 'Recherche')}
          </label>
          <Input
            id="aides-search-query"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('search:form.placeholder', 'Ex: loyer étudiant Strasbourg')}
            className="h-11"
            autoComplete="off"
            aria-describedby="aides-search-help"
          />
        </div>

        <div>
          <label htmlFor="aides-search-category" className="mb-1 block text-sm font-medium text-slate-700">
            {t('search:form.category', 'Catégorie')}
          </label>
          <select
            id="aides-search-category"
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={category}
            onChange={(event) => onCategoryChange(event.target.value)}
          >
            <option value="">{t('search:form.categories-all', 'Toutes les catégories')}</option>
            {SEARCH_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {categoryLabel(t, option.value) ?? option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="aides-search-limit" className="mb-1 block text-sm font-medium text-slate-700">
            {t('search:form.limit', 'Limite')}
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
            <Search className="me-2 h-4 w-4" />
            {t('search:form.submit', 'Rechercher')}
          </Button>
        </div>
      </div>

      <p id="aides-search-help" className="mt-3 text-sm text-slate-700">
        {t('search:form.help', 'Recherchez par mots-clés, puis affinez avec la catégorie.')}
      </p>
    </form>
  );
}
