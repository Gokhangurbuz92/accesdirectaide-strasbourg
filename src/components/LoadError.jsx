// @ts-nocheck
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/ui/EmptyState';

/**
 * PKG-11 audit — one honest « could not load » state with a working retry (the démarches pattern, DTA-B50). Before, the guides, dispositifs and glossary pages
 * swallowed a failed request and then said « Aucun … trouvé » / « introuvable »: an outage looked like an empty catalogue.
 */
/** @param {{ what: string, onRetry: () => void, testId?: string, headingLevel?: 1 | 2 | 3 }} props */
export default function LoadError({ what, onRetry, testId, headingLevel }) {
  return (
    <EmptyState
      title={`Impossible de charger ${what}`}
      description="Vérifiez votre connexion puis réessayez."
      icon={<RotateCcw className="h-6 w-6" />}
      actions={<Button type="button" variant="outline" onClick={onRetry} className="min-h-11"><RotateCcw className="mr-2 h-4 w-4" />Réessayer</Button>}
      role="alert"
      data-testid={testId}
      headingLevel={headingLevel}
    />
  );
}
