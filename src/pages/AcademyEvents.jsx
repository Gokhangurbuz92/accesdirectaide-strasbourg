// @ts-nocheck
/**
 * X04 (expansion) — /academie (published academy pages) and /evenements (published events that have not ended, soonest first). Public, read-only: no
 * field, no account. Each event shows its date, its place, its accessibility information and the places left (or « complet », « annulé »). Closed by
 * default: the API answers 503 CAPABILITY_NOT_OPEN and the page says the function is not open yet. French text of an item is marked lang="fr" on a page
 * in another language unless the editor gave a checked translation.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { formatDate, formatTime, useLanguage, useT } from '@/i18n';
import { frAttrs } from '@/lib/recordLang';
import { accessibilityLabel, itemText } from '@/lib/academyEvents';

/** @param {{ kind: 'LESSON' | 'EVENT' }} props */
export default function AcademyEvents({ kind = 'EVENT' }) {
  const { t } = useT('events');
  const { code } = useLanguage();
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const isEvent = kind === 'EVENT';
  const base = isEvent ? '/evenements' : '/academie';

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/events?kind=${kind}`).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (res.ok) setState({ loading: false, items: body.items || [], error: null });
      else setState({ loading: false, items: [], error: res.status === 503 ? 'closed' : 'failed' });
    }).catch(() => { if (alive) setState({ loading: false, items: [], error: 'failed' }); });
    return () => { alive = false; };
  }, [kind, attempt]);

  const title = isEvent ? t('events:list.title_events', 'Événements') : t('events:list.title_academy', 'Académie');
  const intro = isEvent
    ? t('events:list.intro_events', 'Ateliers et rencontres ouverts au public, avec les informations d’accessibilité de chaque lieu. L’inscription se fait avec un compte personnel (personnes majeures).')
    : t('events:list.intro_academy', 'Des pages pour comprendre les démarches pas à pas. Elles expliquent ; seul l’organisme concerné décide de vos droits.');

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8" data-testid={`academy-list-${kind.toLowerCase()}`}>
      <SEO title={title} description={intro} path={base} />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="max-w-3xl text-slate-700">{intro}</p>
        <p className="text-sm">
          {isEvent
            ? <Link className="font-medium text-blue-800 underline" to="/academie">{t('events:list.to_academy', 'Voir les pages de l’académie')}</Link>
            : <Link className="font-medium text-blue-800 underline" to="/evenements">{t('events:list.to_events', 'Voir les événements')}</Link>}
        </p>
      </header>

      {state.loading && <p role="status">{t('events:list.loading', 'Chargement…')}</p>}
      {state.error === 'closed' && (
        <p role="status" data-testid="academy-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">
          {t('events:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}
        </p>
      )}
      {state.error === 'failed' && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{t('events:list.failed', 'La liste n’a pas pu être chargée.')}</p>
          <button type="button" className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" onClick={() => setAttempt((n) => n + 1)}>
            {t('events:list.retry', 'Réessayer')}
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && (
        <p data-testid="academy-empty" className="text-slate-700">{isEvent ? t('events:list.none_events', 'Aucun événement à venir pour le moment.') : t('events:list.none_academy', 'Aucune page publiée pour le moment.')}</p>
      )}

      {state.items.length > 0 && (
        <ul className="space-y-4" data-testid="academy-items">
          {state.items.map((item) => {
            const tx = itemText(item, code);
            const full = isEvent && item.status === 'published' && item.remaining === 0;
            return (
              <li key={item.slug} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">
                  <Link className="text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" to={`${base}/${item.slug}`} {...frAttrs(code, { translated: tx.title.translated })}>{tx.title.text}</Link>
                </h2>
                {isEvent && (
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    <time dateTime={item.startsAt}>{formatDate(item.startsAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, {formatTime(item.startsAt)}–{formatTime(item.endsAt)}</time>
                    {' — '}<span {...frAttrs(code)}>{item.venueName}, {item.venueCommune}</span>
                  </p>
                )}
                <p className="mt-2 text-slate-700" {...frAttrs(code, { translated: tx.summary.translated })}>{tx.summary.text}</p>
                {isEvent && (
                  <>
                    <p className="mt-2 text-sm" data-testid="academy-places">
                      {item.status === 'cancelled'
                        ? <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-950">{t('events:status.cancelled', 'Annulé')}</span>
                        : full ? <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-950">{t('events:status.full', 'Complet')}</span>
                          : <span className="text-slate-800">{t('events:places_left', 'Places restantes : {{n}} sur {{capacity}}', { n: item.remaining, capacity: item.capacity })}</span>}
                    </p>
                    {item.accessibilityFeatures?.length > 0 && (
                      <div className="mt-2">
                        <h3 className="text-sm font-semibold text-slate-900">{t('events:a11y.title', 'Accessibilité')}</h3>
                        <ul className="mt-1 list-disc ps-5 text-sm text-slate-800">
                          {item.accessibilityFeatures.map((f) => <li key={f}>{accessibilityLabel(f, t)}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
