// @ts-nocheck
/**
 * Actualités v2 — one story card: image with its recorded rights or an original ADA illustration, place and category, title, the publisher's own
 * summary (lane A) or ADA's text, publisher and date, how many other reports tell the same story, and a private « save » button.
 */
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Layers } from 'lucide-react';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import { htmlToPlainText } from '@/lib/htmlText';
import NewsIllustration from './NewsIllustration';
import { RecordProvenance, CardActionStrip } from '@/components/cards/RecordCardParts';
import { formatProvenanceDate } from '@/lib/provenance';
import { geoLabel, laneLabel, topicLabel } from './newsLabels';

/** @param {{ item: any, featured?: boolean, saved?: boolean, onToggleSave?: (item: any) => void, falc?: boolean }} props */
export default function NewsCardV2({ item, featured = false, saved = false, onToggleSave, falc = false }) {
  const { t } = useT('news');
  const tr = useContentTranslation('actualite', item);
  const title = tr.value('titre') || item.titre;
  const summary = (falc && tr.value('summary_falc')) || tr.value('resume') || item.resume || '';
  const excerpt = htmlToPlainText(summary, { maxLength: featured ? 320 : 200 });
  const href = item.slug ? `/actualites/${item.slug}` : `/actualites/view?id=${item.id}`;
  const topic = (item.topics || []).find((x) => x !== 'une') || 'societe';
  const flag = item.geo?.scope === 'monde' ? '🌍' : item.geo?.scope === 'alsace' ? '📍' : '🇫🇷';
  const readLabel = t('news:card.read_label', "Lire l'actualité {{title}}", { title });
  const others = (item.coverage || []).length;
  // shared card parts (R29): the automatic verification date of a licensed item and its source; the action strip
  const verifiedAt = formatProvenanceDate(item.lane === 'A' && item.auto_publish ? item.published_at : item.lane === 'ADA' ? item.ada?.reviewedAt : null);
  const sourceLabel = item.publisher;
  return (
    <article className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-blue-600 ${featured ? 'md:flex-row' : ''} ${item.est_important ? 'ring-1 ring-amber-300' : ''}`}
      data-testid="actualite-card" data-lane={item.lane} data-geo={item.geo?.scope}>
      <Link to={href} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none" aria-label={readLabel}><span className="sr-only">{readLabel}</span></Link>
      <div className={`relative overflow-hidden bg-slate-100 ${featured ? 'md:w-1/2 aspect-[16/9] md:aspect-auto' : 'aspect-[16/9]'}`}>
        {item.image ? (
          <img src={item.image.url} alt={item.image.alt || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <NewsIllustration topic={topic} className="h-full w-full" />
        )}
        {item.image?.aiGenerated && (
          <span className="absolute bottom-2 start-2 rounded bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-white">{t('news:image.ai_label', 'Illustration générée par IA')}</span>
        )}
      </div>
      <div className={`flex flex-1 flex-col p-5 ${featured ? 'md:p-7' : ''}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"><span aria-hidden="true">{flag} </span>{geoLabel(item.geo?.scope || 'france', t)}</span>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">{topicLabel(topic, t)}</span>
          {item.est_important && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">{t('news:badge.important', 'Important')}</span>}
        </div>
        <h2 className={`font-bold leading-snug text-slate-900 group-hover:text-blue-800 ${featured ? 'text-2xl md:text-3xl' : 'text-lg'}`} data-testid="actualite-title" {...tr.attrs('titre')}>{title}</h2>
        {excerpt && <p className={`mt-2 text-slate-700 ${featured ? 'line-clamp-5 text-base' : 'line-clamp-3 text-sm'}`} {...tr.attrs(falc && tr.value('summary_falc') ? 'summary_falc' : 'resume')}>{excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{item.publisher}</span>
          <time dateTime={new Date(item.date_publication).toISOString()}>{formatDate(item.date_publication, { day: 'numeric', month: 'long', year: 'numeric' })}</time>
          <span className="text-slate-500">· {laneLabel(item, t)}</span>
          {others > 0 && <span className="inline-flex items-center gap-1 text-slate-700"><Layers className="h-3.5 w-3.5" aria-hidden="true" />{t('news:card.coverage', '+{{count}} source(s)', { count: others })}</span>}
        </div>
        <div className="mt-2"><RecordProvenance verifiedAt={verifiedAt} sourceHost={sourceLabel} sourceUrl={item.lane === 'ADA' ? null : item.sourceUrl || null} /></div>
      </div>
      <CardActionStrip label={t('news:card.action', 'Lire l’actualité')} />
      {onToggleSave && (
        <button type="button" onClick={() => onToggleSave(item)} aria-pressed={saved}
          className="absolute end-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label={saved ? t('news:save.remove', 'Retirer « {{title}} » des articles enregistrés', { title }) : t('news:save.add', 'Enregistrer « {{title}} » sur cet appareil', { title })}>
          {saved ? <BookmarkCheck className="h-5 w-5 text-blue-700" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />}
        </button>
      )}
    </article>
  );
}
