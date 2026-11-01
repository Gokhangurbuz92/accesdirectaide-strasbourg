// @ts-nocheck
/**
 * ListSkeleton Component
 * 
 * Reusable loading skeleton for list pages.
 * Provides consistent loading experience across Aides, Demarches, Annuaire, Actualites.
 * R32: its words are in the interface language (namespace « news »: the news list is its only user today).
 */

import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';

/**
 * Card-based skeleton (for grid layouts)
 */
export function CardSkeleton({ count = 6, columns = 3 }) {
  const { t } = useT('news');
  const gridClass = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-2 lg:grid-cols-3',
    4: 'md:grid-cols-2 lg:grid-cols-4',
  }[columns] || 'md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`grid ${gridClass} gap-6`} role="status" aria-label={t('news:skeleton.label', 'Chargement en cours')}>
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl h-64 animate-pulse shadow-sm border border-slate-100"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">{t('news:skeleton.results', 'Chargement des résultats...')}</span>
    </div>
  );
}

/**
 * Centered spinner (for simple loading states)
 */
export function CenteredSpinner({ message }) {
  const { t } = useT('news');
  return (
    <div
      className="flex flex-col items-center justify-center py-20"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" aria-hidden="true" />
      <p className="text-slate-500">{message === undefined ? t('news:skeleton.loading', 'Chargement...') : message}</p>
    </div>
  );
}

/**
 * List skeleton (for list layouts)
 */
export function ListItemSkeleton({ count = 5 }) {
  const { t } = useT('news');
  return (
    <div className="space-y-4" role="status" aria-label={t('news:skeleton.label', 'Chargement en cours')}>
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl h-32 animate-pulse shadow-sm border border-slate-100"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">{t('news:skeleton.results', 'Chargement des résultats...')}</span>
    </div>
  );
}

/**
 * Default export: Smart skeleton that adapts to layout
 */
export default function ListSkeleton({ layout = 'grid', count = 6, columns = 3, message }) {
  if (layout === 'spinner') {
    return <CenteredSpinner message={message} />;
  }
  
  if (layout === 'list') {
    return <ListItemSkeleton count={count} />;
  }
  
  return <CardSkeleton count={count} columns={columns} />;
}
