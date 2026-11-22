// @ts-nocheck
/**
 * X02 (expansion) — /temoignages: the published testimonials, newest first (GET /api/testimonials). Each one shows ONLY the first name or pseudonym the
 * person chose, the text in its own language (lang / dir of that language) and the publication date. No photo. A signed-in person can report a testimonial
 * (one reason from a closed list); without a session the page says an account is needed. Nothing here is a sample: an empty list says so. Closed by
 * default: the API answers 503 CAPABILITY_NOT_OPEN and the page says the function is not open yet.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { REASONS, reasonLabel, textAttrs } from '@/lib/testimonials';
import ReportContentLink from '@/components/moderation/ReportContentLink';

/** the report form of one testimonial @param {{ id: string }} props */
function Report({ id }) {
  const { t } = useT('testimonials');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState({ text: '', error: false });
  const selectId = `report-${id}`;
  const send = async () => {
    try { await citizenApi.testimonialAction({ action: 'report', id, reason }); setMsg({ text: t('testimonials:report.done', 'Merci. Le témoignage sera relu par la modération.'), error: false }); setOpen(false); }
    catch (e) {
      setMsg({ text: e.status === 401 ? t('testimonials:report.login', 'Pour signaler un témoignage, connectez-vous à votre compte : un compte est nécessaire pour éviter les signalements abusifs.') : e.message, error: true });
    }
  };
  return (
    <div className="mt-2 text-sm">
      {!open && <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setMsg({ text: '', error: false }); }}>{t('testimonials:report.open', 'Signaler ce témoignage')}</Button>}
      {open && (
        <div className="flex flex-wrap items-end gap-2" data-testid="report-form">
          <div>
            <label htmlFor={selectId} className="block font-semibold text-slate-900">{t('testimonials:report.reason', 'Motif du signalement')}</label>
            <select id={selectId} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('testimonials:report.choose', 'Choisir un motif')}</option>
              {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" disabled={!reason} onClick={send}>{t('testimonials:report.send', 'Envoyer le signalement')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('testimonials:report.cancel', 'Annuler')}</Button>
        </div>
      )}
      <div aria-live="polite" role="status">{msg.text && <p className={`mt-1 ${msg.error ? 'text-red-900' : 'text-emerald-900'}`}>{msg.text}</p>}</div>
    </div>
  );
}

export default function Testimonials() {
  const { t } = useT('testimonials');
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/testimonials').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (res.ok) setState({ loading: false, items: body.items || [], error: null });
      else setState({ loading: false, items: [], error: res.status === 503 ? 'closed' : 'failed' });
    }).catch(() => { if (alive) setState({ loading: false, items: [], error: 'failed' }); });
    return () => { alive = false; };
  }, [attempt]);

  const title = t('testimonials:list.title', 'Témoignages');
  const intro = t('testimonials:list.intro', 'Des personnes racontent leur expérience du service. Chaque témoignage est publié avec l’accord de son auteur, après relecture, sous le prénom ou le pseudonyme qu’il a choisi. Son auteur peut le retirer à tout moment.');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="testimonials-page">
      <SEO title={title} description={intro} path="/temoignages" />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="text-slate-700">{intro}</p>
        <p className="text-sm text-slate-700">{t('testimonials:list.notice', 'Un témoignage raconte une expérience personnelle : chaque situation est différente, et seul l’organisme concerné décide de la vôtre.')}</p>
        <p className="text-sm"><Link className="font-medium text-blue-800 underline" to="/compte/temoignages">{t('testimonials:list.share', 'Partager mon témoignage')}</Link></p>
      </header>
      {state.loading && <p role="status">{t('testimonials:loading', 'Chargement…')}</p>}
      {state.error === 'closed' && <p role="status" data-testid="testimonials-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('testimonials:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error === 'failed' && (
        <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{t('testimonials:failed', 'Les témoignages n’ont pas pu être chargés.')}</p>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('testimonials:retry', 'Réessayer')}</Button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && <p data-testid="testimonials-empty" className="text-slate-700">{t('testimonials:list.empty', 'Aucun témoignage publié pour le moment.')}</p>}
      {state.items.length > 0 && (
        <ul className="space-y-4" data-testid="testimonials-list">
          {state.items.map((x) => (
            <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <figure>
                <blockquote className="whitespace-pre-line leading-relaxed text-slate-900" {...textAttrs(x.lang)}>{x.body}</blockquote>
                <figcaption className="mt-2 text-sm text-slate-700"><span {...textAttrs(x.lang)}>{x.displayName}</span>, <time dateTime={x.publishedAt}>{formatDate(x.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })}</time></figcaption>
              </figure>
              <Report id={x.id} />
            </li>
          ))}
        </ul>
      )}
      <ReportContentLink />
    </div>
  );
}
