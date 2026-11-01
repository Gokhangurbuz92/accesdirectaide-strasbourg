// @ts-nocheck
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getSearchCategoryLabel, normalizeSearchCategory } from '@/lib/searchClient';
import { useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

/** R32: a search category in the interface language (same keys as the search form) */
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

export default function SearchResultCard({ result }) {
  const { t } = useT('search');
  // R32: the title and summary of the aide go through the content translation (French, marked lang="fr", until a verified translation exists)
  const tr = useContentTranslation('aide', result);
  const targetUrl = result.slug ? `/aides/${result.slug}` : `/aide/view?id=${encodeURIComponent(result.id)}`;
  const hasScore = typeof result.score === 'number';
  const categoryCode = normalizeSearchCategory(result.category);
  const category = categoryCode ? (categoryLabel(t, categoryCode) ?? getSearchCategoryLabel(result.category)) : t('search:category.none', 'Non classée');
  const summary = tr.value('description');

  return (
    <article
      className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
      data-testid="search-result-card"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-100">
          {category}
        </Badge>
        {hasScore && (
          <span className="text-xs font-medium text-slate-500">
            {t('search:result.score', 'Score {{score}}', { score: result.score.toFixed(3) })}
          </span>
        )}
      </div>

      <h2 className="text-lg font-semibold text-slate-900" {...tr.attrs('title')}>
        <Link
          to={targetUrl}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {tr.value('title')}
        </Link>
      </h2>

      <p className="mt-2 line-clamp-3 text-sm text-slate-600" {...(summary ? tr.attrs('description') : {})}>
        {summary || t('search:result.no-summary', 'Aucun résumé disponible pour cette aide.')}
      </p>

      <div className="mt-4">
        <Link
          to={targetUrl}
          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {t('search:result.details', 'Voir le détail')}
          <ArrowRight className="rtl-flip h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
