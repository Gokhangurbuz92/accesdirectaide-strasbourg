// @ts-nocheck
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/ui/EmptyState';
import { useT } from '@/i18n';

/**
 * PKG-11 audit — one honest « could not load » state with a working retry (the démarches pattern, DTA-B50). Before, the guides, dispositifs and glossary pages
 * swallowed a failed request and then said « Aucun … trouvé » / « introuvable »: an outage looked like an empty catalogue.
 */
/**
 * R32: `what` comes from the page, already in the interface language (« ce guide », « this guide »…): it is placed in the translated sentence.
 * @param {{ what: string, onRetry: () => void, testId?: string, headingLevel?: 1 | 2 | 3 }} props
 */
export default function LoadError({ what, onRetry, testId, headingLevel }) {
  const { t } = useT('shared');
  return (
    <EmptyState
      title={t('shared:loadError.title', 'Impossible de charger {{what}}', { what })}
      description={t('shared:loadError.text', 'Vérifiez votre connexion puis réessayez.')}
      icon={<RotateCcw className="h-6 w-6" />}
      actions={<Button type="button" variant="outline" onClick={onRetry} className="min-h-11"><RotateCcw className="me-2 h-4 w-4" />{t('shared:loadError.retry', 'Réessayer')}</Button>}
      role="alert"
      data-testid={testId}
      headingLevel={headingLevel}
    />
  );
}
