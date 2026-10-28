// @ts-nocheck
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getSearchCategoryLabel } from '@/lib/searchClient';

export default function SearchResultCard({ result }) {
  const targetUrl = result.slug ? `/aides/${result.slug}` : `/aide/view?id=${encodeURIComponent(result.id)}`;
  const hasScore = typeof result.score === 'number';

  return (
    <article
      className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
      data-testid="search-result-card"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-100">
          {getSearchCategoryLabel(result.category)}
        </Badge>
        {hasScore && (
          <span className="text-xs font-medium text-slate-500">
            Score {result.score.toFixed(3)}
          </span>
        )}
      </div>

      <h2 className="text-lg font-semibold text-slate-900">
        <Link
          to={targetUrl}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {result.title}
        </Link>
      </h2>

      <p className="mt-2 line-clamp-3 text-sm text-slate-600">
        {result.description || 'Aucun résumé disponible pour cette aide.'}
      </p>

      <div className="mt-4">
        <Link
          to={targetUrl}
          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Voir le détail
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
