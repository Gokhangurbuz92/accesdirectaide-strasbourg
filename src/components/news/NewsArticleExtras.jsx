// @ts-nocheck
/**
 * Actualités v2 — what an article page adds around the text: reading tools (comfortable reading, progress, print, share, save, report an error),
 * the image with its credit (or the original illustration; an AI picture is always labelled), ADA's sources and corrections, the other reports of
 * the same story and related articles. Everything here is plain text and links (no HTML from a feed is ever rendered).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, BookOpen, Flag, Printer, Share2 } from 'lucide-react';
import { formatDate, useT } from '@/i18n';
import { publicContactEmail, mailtoWithSubject } from '@/lib/contactEmail';
import useNewsBookmarks from '@/hooks/useNewsBookmarks';
import NewsIllustration from './NewsIllustration';
import { geoLabel, laneLabel, topicLabel } from './newsLabels';

const LONG = { day: 'numeric', month: 'long', year: 'numeric' };
/** a thin progress bar of the reading position (decorative: the position is not information) */
export function ReadingProgress({ targetId }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById(targetId); if (!el) return;
      const r = el.getBoundingClientRect(); const total = r.height - window.innerHeight;
      setPct(total > 0 ? Math.min(100, Math.max(0, (-r.top / total) * 100)) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [targetId]);
  return <div className="fixed inset-x-0 top-0 z-50 h-1 bg-transparent print:hidden" aria-hidden="true"><div className="h-full bg-blue-700 transition-[width]" style={{ width: `${pct}%` }} /></div>;
}

/** @param {{ item: any, news: any, readerOn: boolean, onReader: () => void }} props */
export function NewsArticleTools({ item, news, readerOn, onReader }) {
  const { t } = useT('news');
  const { isSaved, toggle } = useNewsBookmarks();
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const title = item.titre;
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title, url }); return; } await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* cancelled */ }
  };
  const email = publicContactEmail();
  const btn = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';
  return (
    <div className="mb-6 flex flex-wrap gap-2 print:hidden" role="toolbar" aria-label={t('news:tools.label', 'Outils de lecture')} data-testid="news-tools">
      <button type="button" className={btn} aria-pressed={readerOn} onClick={onReader}><BookOpen className="h-4 w-4" aria-hidden="true" />{t('news:tools.reader', 'Lecture confortable')}</button>
      <button type="button" className={btn} onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" />{t('news:tools.print', 'Imprimer')}</button>
      <button type="button" className={btn} onClick={share}><Share2 className="h-4 w-4" aria-hidden="true" />{copied ? t('news:tools.copied', 'Lien copié') : t('news:tools.share', 'Partager')}</button>
      <button type="button" className={btn} aria-pressed={isSaved(item.id)} onClick={() => toggle({ id: item.id, slug: item.slug, titre: title, date: item.date_publication, publisher: news?.publisher })}>
        {isSaved(item.id) ? <BookmarkCheck className="h-4 w-4 text-blue-700" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
        {isSaved(item.id) ? t('news:tools.saved', 'Enregistré sur cet appareil') : t('news:tools.save', 'Enregistrer')}
      </button>
      {email && <a className={btn} href={mailtoWithSubject(email, `[Actualités] Signalement : ${item.slug || item.id}`)}><Flag className="h-4 w-4" aria-hidden="true" />{t('news:tools.report', 'Signaler une erreur')}</a>}
    </div>
  );
}

/** labels + image (or illustration) of the article @param {{ news: any }} props */
export function NewsArticleHeader({ news }) {
  const { t } = useT('news');
  if (!news) return null;
  const topic = (news.topics || []).find((x) => x !== 'une') || 'societe';
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 text-xs font-medium" data-testid="news-labels">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800">{geoLabel(news.geo?.scope || 'france', t)}</span>
        {(news.topics || []).filter((x) => x !== 'une').map((x) => <span key={x} className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-900">{topicLabel(x, t)}</span>)}
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-900">{laneLabel(news, t)}</span>
      </div>
      <figure className="mb-6 overflow-hidden rounded-xl bg-slate-100">
        {news.image ? (
          <>
            <img src={news.image.url} alt={news.image.alt || ''} className="max-h-[420px] w-full object-cover" referrerPolicy="no-referrer" />
            <figcaption className="px-3 py-2 text-xs text-slate-600" data-testid="news-image-credit">
              {news.image.aiGenerated && <strong className="me-1">{t('news:image.ai_label', 'Illustration générée par IA')} —</strong>}
              {news.image.credit}{news.image.licence ? ` · ${news.image.licence}` : ''}
              {news.image.licenceUrl && <> · <a className="underline" href={news.image.licenceUrl} target="_blank" rel="noopener noreferrer">{t('news:image.licence', 'licence')}</a></>}
            </figcaption>
          </>
        ) : (
          <>
            <NewsIllustration topic={topic} className="aspect-[16/7] w-full" />
            <figcaption className="px-3 py-2 text-xs text-slate-600">{t('news:image.illustration_caption', 'Illustration de la rubrique — dessin original, ne représente pas l’événement.')}</figcaption>
          </>
        )}
      </figure>
    </>
  );
}

/** ADA's own article: who approved it, its sources, its corrections @param {{ news: any }} props */
export function NewsAdaBlock({ news }) {
  const { t } = useT('news');
  if (!news?.ada) return null;
  const { sources = [], corrections = [], reviewedAt } = news.ada;
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5" aria-labelledby="ada-sources" data-testid="news-ada-block">
      <h2 id="ada-sources" className="text-base font-bold text-slate-900">{t('news:ada.sources', 'Sources de cet article')}</h2>
      {reviewedAt && <p className="mt-1 text-sm text-slate-700">{t('news:ada.reviewed', 'Rédigé par AccesDirectAide et approuvé par la rédaction le {{date}}.', { date: formatDate(reviewedAt, LONG) })}</p>}
      <ul className="mt-3 list-disc space-y-1 ps-5 text-sm">
        {sources.map((s) => <li key={s.url}><a className="text-blue-800 underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.publisher}</a>{s.note ? ` — ${s.note}` : ''}</li>)}
      </ul>
      {corrections.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-bold text-slate-900">{t('news:ada.corrections', 'Corrections et mises à jour')}</h3>
          <ol className="mt-2 space-y-1 text-sm text-slate-800" data-testid="news-corrections">
            {corrections.map((c, i) => <li key={`${c.at}-${i}`}><time dateTime={c.at}>{formatDate(c.at, LONG)}</time> — {c.kind === 'update' ? t('news:ada.update', 'Mise à jour') : t('news:ada.correction', 'Correction')} : {c.note}</li>)}
          </ol>
        </>
      )}
    </section>
  );
}

/** the other reports of the same story (links only: their words belong to their publishers) and related articles @param {{ news: any }} props */
export function NewsCoverageAndRelated({ news }) {
  const { t } = useT('news');
  if (!news) return null;
  const coverage = news.coverage || []; const related = news.related || [];
  return (
    <>
      {coverage.length > 0 && (
        <section className="mt-8" aria-labelledby="news-coverage" data-testid="news-coverage">
          <h2 id="news-coverage" className="text-base font-bold text-slate-900">{t('news:coverage.title', 'Sources et couverture')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('news:coverage.text', 'Le même sujet chez d’autres éditeurs (lecture sur leur site) :')}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {coverage.map((c) => <li key={c.url}><a className="text-blue-800 underline" href={c.url} target="_blank" rel="noopener noreferrer">{c.publisher}</a> <span className="text-slate-600">· {formatDate(c.date, LONG)} · {t('news:coverage.external', 'site externe')}</span></li>)}
          </ul>
        </section>
      )}
      {related.length > 0 && (
        <section className="mt-8 print:hidden" aria-labelledby="news-related" data-testid="news-related">
          <h2 id="news-related" className="text-base font-bold text-slate-900">{t('news:related.title', 'À lire aussi')}</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.id}><Link className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-400" to={r.slug ? `/actualites/${r.slug}` : `/actualites/view?id=${r.id}`}>
                <span className="block text-sm font-semibold text-slate-900" lang="fr">{r.titre}</span>
                <span className="text-xs text-slate-600">{r.publisher} · {formatDate(r.date_publication, LONG)}</span>
              </Link></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
