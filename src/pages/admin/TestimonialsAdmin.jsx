// @ts-nocheck
/**
 * X02 (expansion) — the moderation of the testimonials (api/_handlers/admin/testimonials.js): the pending ones (approve or reject), the reported published
 * ones (take down or dismiss the reports) and the published ones (take down). Reading and acting need a named administrator with MFA; every read and every
 * decision is audited. The server re-checks the text at approval and lists what blocks it here. Rejection and takedown erase the text, with a reason from a
 * closed list the person sees. The moderator never sees the account, its e-mail or who reported — only counts per reason. Closed by default (503).
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import StatementFields from '@/components/moderation/StatementFields';
import { EMPTY_STATEMENT, statementBody, statementReady } from '@/lib/moderation';
import { formatDateTime, useT } from '@/i18n';
import { REASONS, reasonLabel, textAttrs } from '@/lib/testimonials';

const QUEUES = ['pending', 'reported', 'published'];

/** @param {{ item: any, queue: string, onAct: (body: Record<string, unknown>) => Promise<void>, busy: boolean }} props */
function Item({ item, queue, onAct, busy }) {
  const { t } = useT('testimonials');
  const [reason, setReason] = useState('');
  // G14 / DSA art. 17: the statement of reasons is written before any restriction or decision on reports (the server refuses it without facts)
  const [st, setSt] = useState(EMPTY_STATEMENT);
  const ok = statementReady(st);
  const sel = `reason-${item.id}`;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <blockquote className="whitespace-pre-line text-slate-900" {...textAttrs(item.lang)}>{item.body}</blockquote>
      <p className="text-sm text-slate-700"><span {...textAttrs(item.lang)}>{item.displayName}</span> — {item.lang} — {formatDateTime(item.submittedAt)}</p>
      {item.problems?.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900" data-testid="admin-problems">
          <p className="font-semibold">{t('testimonials:admin.problems', 'À corriger avant publication (le texte ne peut pas être modifié : refusez-le avec un motif)')}</p>
          <ul className="list-disc ps-5">{item.problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
        </div>
      )}
      {item.reports?.total > 0 && (
        <p className="text-sm text-slate-800" data-testid="admin-reports">
          {t('testimonials:admin.reports', '{{n}} signalement(s) :', { n: item.reports.total })} {Object.entries(item.reports.reasons).map(([r, n]) => `${reasonLabel(r, t)} (${n})`).join(', ')}
        </p>
      )}
      <StatementFields value={st} onChange={setSt} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={sel} className="block text-sm font-semibold text-slate-900">{t('testimonials:admin.reason', 'Motif (refus ou retrait)')}</label>
          <select id={sel} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('testimonials:report.choose', 'Choisir un motif')}</option>
            {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
          </select>
        </div>
        {queue === 'pending' ? (
          <>
            <Button size="sm" disabled={busy || item.problems?.length > 0} onClick={() => onAct({ action: 'approve', id: item.id })}>{t('testimonials:admin.approve', 'Publier')}</Button>
            <Button size="sm" variant="destructive" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'reject', id: item.id, reason, ...statementBody(st) })}>{t('testimonials:admin.reject', 'Refuser (le texte est effacé)')}</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="destructive" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'takedown', id: item.id, reason, ...statementBody(st) })}>{t('testimonials:admin.takedown', 'Retirer (le texte est effacé)')}</Button>
            {item.reports?.total > 0 && <Button size="sm" variant="outline" disabled={busy || !ok} onClick={() => onAct({ action: 'dismiss_reports', id: item.id, ...statementBody(st) })}>{t('testimonials:admin.dismiss', 'Classer les signalements')}</Button>}
          </>
        )}
      </div>
    </li>
  );
}

export default function TestimonialsAdmin() {
  const { t } = useT('testimonials');
  const [queue, setQueue] = useState('pending');
  const [items, setItems] = useState(null);
  const [closed, setClosed] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.admin.listTestimonials(queue).then((r) => { setClosed(false); setItems(r?.items || []); })
      .catch((e) => { if (e?.status === 503) setClosed(true); else { setItems([]); setMsg(e?.payload?.error || e?.message || t('testimonials:admin.failed', 'Action refusée.')); } });
  }, [queue, t]);
  useEffect(() => { load(); }, [load]);
  const act = async (body) => {
    setBusy(true); setMsg('');
    try { await apiClient.admin.testimonialAction(body); setMsg(t('testimonials:admin.done', 'Décision enregistrée.')); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('testimonials:admin.failed', 'Action refusée.')); }
    finally { setBusy(false); }
  };
  const title = t('testimonials:admin.title', 'Modération des témoignages');
  const queueLabel = (q) => ({ pending: t('testimonials:admin.queue.pending', 'À relire'), reported: t('testimonials:admin.queue.reported', 'Signalés'), published: t('testimonials:admin.queue.published', 'Publiés') }[q]);
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/admin/temoignages" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('testimonials:admin.intro', 'Chaque témoignage est relu avant publication. Refusez ou retirez tout texte qui donne un détail de santé ou de handicap, une information sur une autre personne, ou un propos injurieux. Vous ne voyez jamais le compte de l’auteur ni qui a signalé.')}</p>
      </div>
      {closed ? (
        <p role="status" data-testid="testimonials-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('testimonials:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('testimonials:admin.queues', 'Files de modération')}>
            {QUEUES.map((q) => <Button key={q} size="sm" variant={q === queue ? 'default' : 'outline'} aria-pressed={q === queue} onClick={() => setQueue(q)}>{queueLabel(q)}</Button>)}
          </div>
          <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
          <section aria-labelledby="testimonials-queue">
            <h2 id="testimonials-queue" className="text-lg font-semibold text-slate-900">{queueLabel(queue)}</h2>
            {items === null ? <p role="status">{t('testimonials:loading', 'Chargement…')}</p>
              : items.length === 0 ? <p className="text-sm text-slate-700" data-testid="admin-empty">{t('testimonials:admin.empty', 'Aucun témoignage dans cette file.')}</p>
                : <ul className="mt-2 space-y-4" data-testid="admin-queue">{items.map((x) => <Item key={x.id} item={x} queue={queue} onAct={act} busy={busy} />)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
