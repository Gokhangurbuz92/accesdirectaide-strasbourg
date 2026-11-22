// @ts-nocheck
/**
 * X01 (expansion) — the moderation of the community stories (api/_handlers/admin/stories.js): the pending ones (approve or reject), the reported published
 * ones (take down or dismiss the reports) and the published ones (take down). Reading and acting need a named administrator with MFA; every read and every
 * decision is audited. The server re-checks the story at approval (content, pseudonym, entitlement wording) and lists what blocks it here. Rejection and
 * takedown erase the title and the text, with a reason from a closed list the person sees. The moderator sees the pseudonym only — never the account, its
 * e-mail or who reported (counts per reason). The moderator never edits a story. Closed by default (503).
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import StatementFields from '@/components/moderation/StatementFields';
import { EMPTY_STATEMENT, statementBody, statementReady } from '@/lib/moderation';
import { formatDateTime, useT } from '@/i18n';
import { REASONS, reasonLabel, textAttrs } from '@/lib/communityStories';

const QUEUES = ['pending', 'reported', 'published'];

/** @param {{ item: any, queue: string, onAct: (body: Record<string, unknown>) => Promise<void>, busy: boolean }} props */
function Item({ item, queue, onAct, busy }) {
  const { t } = useT('stories');
  const [reason, setReason] = useState('');
  // G14 / DSA art. 17: the statement of reasons is written before any restriction or decision on reports (the server refuses it without facts)
  const [st, setSt] = useState(EMPTY_STATEMENT);
  const ok = statementReady(st);
  const sel = `story-reason-${item.id}`;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900" {...textAttrs(item.lang)}>{item.title}</h3>
      <div className="whitespace-pre-line text-slate-900" {...textAttrs(item.lang)}>{item.body}</div>
      <p className="text-sm text-slate-700">{t('stories:admin.pseudonym', 'Pseudonyme')} : <span {...textAttrs(item.lang)}>{item.pseudonym}</span> — {item.lang} — {formatDateTime(item.submittedAt)}</p>
      {item.problems?.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900" data-testid="story-admin-problems">
          <p className="font-semibold">{t('stories:admin.problems', 'À corriger avant publication (l’histoire ne peut pas être modifiée : refusez-la avec un motif)')}</p>
          <ul className="list-disc ps-5">{item.problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
        </div>
      )}
      {item.reports?.total > 0 && (
        <p className="text-sm text-slate-800" data-testid="story-admin-reports">
          {t('stories:admin.reports', '{{n}} signalement(s) :', { n: item.reports.total })} {Object.entries(item.reports.reasons).map(([r, n]) => `${reasonLabel(r, t)} (${n})`).join(', ')}
        </p>
      )}
      <StatementFields value={st} onChange={setSt} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={sel} className="block text-sm font-semibold text-slate-900">{t('stories:admin.reason', 'Motif (refus ou retrait)')}</label>
          <select id={sel} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('stories:report.choose', 'Choisir un motif')}</option>
            {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
          </select>
        </div>
        {queue === 'pending' ? (
          <>
            <Button size="sm" disabled={busy || item.problems?.length > 0} onClick={() => onAct({ action: 'approve', id: item.id })}>{t('stories:admin.approve', 'Publier')}</Button>
            <Button size="sm" variant="destructive" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'reject', id: item.id, reason, ...statementBody(st) })}>{t('stories:admin.reject', 'Refuser (le texte est effacé)')}</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="destructive" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'takedown', id: item.id, reason, ...statementBody(st) })}>{t('stories:admin.takedown', 'Retirer (le texte est effacé)')}</Button>
            {item.reports?.total > 0 && <Button size="sm" variant="outline" disabled={busy || !ok} onClick={() => onAct({ action: 'dismiss_reports', id: item.id, ...statementBody(st) })}>{t('stories:admin.dismiss', 'Classer les signalements')}</Button>}
          </>
        )}
      </div>
    </li>
  );
}

export default function StoriesAdmin() {
  const { t } = useT('stories');
  const [queue, setQueue] = useState('pending');
  const [items, setItems] = useState(null);
  const [closed, setClosed] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.admin.listStories(queue).then((r) => { setClosed(false); setItems(r?.items || []); })
      .catch((e) => { if (e?.status === 503) setClosed(true); else { setItems([]); setMsg(e?.payload?.error || e?.message || t('stories:admin.failed', 'Action refusée.')); } });
  }, [queue, t]);
  useEffect(() => { load(); }, [load]);
  const act = async (body) => {
    setBusy(true); setMsg('');
    try { await apiClient.admin.storyAction(body); setMsg(t('stories:admin.done', 'Décision enregistrée.')); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('stories:admin.failed', 'Action refusée.')); }
    finally { setBusy(false); }
  };
  const title = t('stories:admin.title', 'Modération des histoires');
  const queueLabel = (q) => ({ pending: t('stories:admin.queue.pending', 'À relire'), reported: t('stories:admin.queue.reported', 'Signalées'), published: t('stories:admin.queue.published', 'Publiées') }[q]);
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/admin/histoires" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('stories:admin.intro', 'Chaque histoire est relue avant publication. Refusez ou retirez toute histoire qui donne un détail de santé ou de handicap, une information sur une autre personne (en particulier un enfant), un propos injurieux, une publicité, ou qui promet à quelqu’un une aide ou une décision. Vous ne voyez jamais le compte de l’auteur ni qui a signalé.')}</p>
      </div>
      {closed ? (
        <p role="status" data-testid="stories-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('stories:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('stories:admin.queues', 'Files de modération')}>
            {QUEUES.map((q) => <Button key={q} size="sm" variant={q === queue ? 'default' : 'outline'} aria-pressed={q === queue} onClick={() => setQueue(q)}>{queueLabel(q)}</Button>)}
          </div>
          <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
          <section aria-labelledby="stories-queue">
            <h2 id="stories-queue" className="text-lg font-semibold text-slate-900">{queueLabel(queue)}</h2>
            {items === null ? <p role="status">{t('stories:loading', 'Chargement…')}</p>
              : items.length === 0 ? <p className="text-sm text-slate-700" data-testid="story-admin-empty">{t('stories:admin.empty', 'Aucune histoire dans cette file.')}</p>
                : <ul className="mt-2 space-y-4" data-testid="story-admin-queue">{items.map((x) => <Item key={x.id} item={x} queue={queue} onAct={act} busy={busy} />)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
