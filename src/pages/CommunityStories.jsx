// @ts-nocheck
/**
 * X01 (expansion) — /histoires: the published community stories, newest first (GET /api/stories). Each one shows ONLY its title, the PSEUDONYM its author
 * chose, the text in its own language (lang / dir of that language) and the publication date. No image, no link. A signed-in person can report a story (one
 * reason from a closed list); without a session the page says an account is needed. Nothing here is a sample: an empty list says so. No comments or replies.
 * Closed by default: the API answers 503 CAPABILITY_NOT_OPEN and the page says the function is not open yet.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { REASONS, reasonLabel, textAttrs } from '@/lib/communityStories';

/** the report form of one story @param {{ id: string }} props */
function Report({ id }) {
  const { t } = useT('stories');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState({ text: '', error: false });
  const selectId = `story-report-${id}`;
  const send = async () => {
    try { await citizenApi.storyAction({ action: 'report', id, reason }); setMsg({ text: t('stories:report.done', 'Merci. L’histoire sera relue par la modération.'), error: false }); setOpen(false); }
    catch (e) {
      setMsg({ text: e.status === 401 ? t('stories:report.login', 'Pour signaler une histoire, connectez-vous à votre compte : un compte est nécessaire pour éviter les signalements abusifs.') : e.message, error: true });
    }
  };
  return (
    <div className="mt-2 text-sm">
      {!open && <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setMsg({ text: '', error: false }); }}>{t('stories:report.open', 'Signaler cette histoire')}</Button>}
      {open && (
        <div className="flex flex-wrap items-end gap-2" data-testid="story-report-form">
          <div>
            <label htmlFor={selectId} className="block font-semibold text-slate-900">{t('stories:report.reason', 'Motif du signalement')}</label>
            <select id={selectId} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('stories:report.choose', 'Choisir un motif')}</option>
              {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" disabled={!reason} onClick={send}>{t('stories:report.send', 'Envoyer le signalement')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('stories:report.cancel', 'Annuler')}</Button>
        </div>
      )}
      <div aria-live="polite" role="status">{msg.text && <p className={`mt-1 ${msg.error ? 'text-red-900' : 'text-emerald-900'}`}>{msg.text}</p>}</div>
    </div>
  );
}

export default function CommunityStories() {
  const { t } = useT('stories');
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/stories').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (res.ok) setState({ loading: false, items: body.items || [], error: null });
      else setState({ loading: false, items: [], error: res.status === 503 ? 'closed' : 'failed' });
    }).catch(() => { if (alive) setState({ loading: false, items: [], error: 'failed' }); });
    return () => { alive = false; };
  }, [attempt]);

  const title = t('stories:list.title', 'Histoires de la communauté');
  const intro = t('stories:list.intro', 'Des personnes racontent, sous un pseudonyme, leur parcours et ce qui les a aidées. Chaque histoire est publiée avec l’accord de son auteur, après relecture. Son auteur peut la retirer à tout moment.');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="stories-page">
      <SEO title={title} description={intro} path="/histoires" />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="text-slate-700">{intro}</p>
        <p className="text-sm text-slate-700">{t('stories:list.notice', 'Une histoire raconte une expérience personnelle : chaque situation est différente, et seul l’organisme concerné décide de la vôtre.')}</p>
        <p className="text-sm"><Link className="font-medium text-blue-800 underline" to="/compte/histoires">{t('stories:list.share', 'Raconter mon histoire')}</Link></p>
      </header>
      {state.loading && <p role="status">{t('stories:loading', 'Chargement…')}</p>}
      {state.error === 'closed' && <p role="status" data-testid="stories-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('stories:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error === 'failed' && (
        <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{t('stories:failed', 'Les histoires n’ont pas pu être chargées.')}</p>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('stories:retry', 'Réessayer')}</Button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && <p data-testid="stories-empty" className="text-slate-700">{t('stories:list.empty', 'Aucune histoire publiée pour le moment.')}</p>}
      {state.items.length > 0 && (
        <ul className="space-y-4" data-testid="stories-list">
          {state.items.map((x) => (
            <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <article aria-labelledby={`story-title-${x.id}`}>
                <h2 id={`story-title-${x.id}`} className="text-lg font-semibold text-slate-900" {...textAttrs(x.lang)}>{x.title}</h2>
                <p className="text-sm text-slate-700">
                  {t('stories:list.by', 'Par')} <span {...textAttrs(x.lang)}>{x.pseudonym}</span>, <time dateTime={x.publishedAt}>{formatDate(x.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                </p>
                <div className="mt-2 whitespace-pre-line leading-relaxed text-slate-900" {...textAttrs(x.lang)}>{x.body}</div>
              </article>
              <Report id={x.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
