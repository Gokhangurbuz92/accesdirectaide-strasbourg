import PropTypes from 'prop-types';
import { Languages } from 'lucide-react';
import { formatDate, setLanguage, useT } from '@/i18n';

/**
 * R32 — the notice above a verified record when the interface is not in French. It says plainly what the visitor is reading: a machine
 * translation checked automatically (never « reviewed » unless a person really reviewed it), or the French text because no translation may be
 * shown (none yet, outdated since the French changed, or stopped by the checks). It always names the French text and the official source as the
 * reference, and offers the French original. Renders nothing in French.
 */
export default function ContentTranslationNotice({ translation, className = '' }) {
  const { t } = useT('translation');
  if (!translation || translation.status === 'source') return null;
  const s = translation.status;
  const date = translation.meta?.review?.at || translation.meta?.translatedAt;
  const message = {
    loading: t('translation:status.loading', 'Recherche d’une traduction…'),
    auto_checked: t('translation:status.auto_checked', 'Traduction automatique, vérifiée par des contrôles automatiques. Elle n’a pas été relue par une personne : le texte français et la source officielle font foi.'),
    partial: t('translation:status.partial', 'Traduction automatique, vérifiée par des contrôles automatiques et non relue par une personne. Les passages qui n’ont pas passé les contrôles sont affichés en français. Le texte français et la source officielle font foi.'),
    human_reviewed: t('translation:status.human_reviewed', 'Traduction relue par une personne. Le texte français et la source officielle font foi.'),
    outdated: t('translation:status.outdated', 'Le texte français a été modifié depuis la traduction : la traduction est retirée jusqu’à ce qu’elle soit refaite et contrôlée. Le texte est affiché en français.'),
    withheld: t('translation:status.withheld', 'La traduction automatique de ce contenu n’a pas passé les contrôles : le texte est affiché en français.'),
    unavailable: t('translation:status.unavailable', 'Ce contenu n’est pas encore traduit dans votre langue : il est affiché en français.'),
  }[s] || t('translation:status.unavailable', 'Ce contenu n’est pas encore traduit dans votre langue : il est affiché en français.');
  const translated = ['auto_checked', 'partial', 'human_reviewed'].includes(s);
  return (
    <div role="note" className={`rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 ${className}`} data-testid="content-translation-notice" data-status={s} data-no-read="">
      <p className="flex items-start gap-2">
        <Languages className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {translated && date ? (
        <p className="mt-1 ps-6 text-xs text-sky-900">
          {translation.meta?.review?.at
            ? t('translation:meta.reviewed', 'Relue le {{date}}.', { date: formatDate(date) })
            : t('translation:meta.machine', 'Traduite le {{date}} par un moteur de traduction installé sur l’ordinateur de l’éditeur (aucun texte personnel n’est traduit).', { date: formatDate(date) })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2 ps-6">
        {translated ? (
          <button type="button" className="min-h-11 rounded-md border border-sky-300 bg-white px-3 py-1 font-medium text-sky-950 focus:outline-none focus:ring-2 focus:ring-brand-primary"
            aria-pressed={translation.showOriginal} onClick={() => translation.setShowOriginal(!translation.showOriginal)} data-testid="show-original">
            {translation.showOriginal ? t('translation:action.back', 'Revenir à la traduction') : t('translation:action.original', 'Voir le texte original en français')}
          </button>
        ) : null}
        <button type="button" lang="fr" className="min-h-11 rounded-md px-3 py-1 text-sky-950 underline focus:outline-none focus:ring-2 focus:ring-brand-primary" onClick={() => { void setLanguage('fr'); }}>
          Afficher tout le site en français
        </button>
      </div>
    </div>
  );
}

ContentTranslationNotice.propTypes = { translation: PropTypes.object, className: PropTypes.string };
