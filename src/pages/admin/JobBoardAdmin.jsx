// @ts-nocheck
/**
 * X05 (expansion) — the moderation of the job board (api/_handlers/admin/employment.js): the listings waiting for review (approve or reject with a reason) and
 * the published ones (take down with a reason). Reading and acting need a named administrator with MFA; every read and every decision is audited. The server
 * re-checks each listing at approval (fields, end date, entitlement wording, the employer still active and verified) and lists what blocks it here. The
 * moderator sees the employer (directory name, verification state) — never the professional who wrote the listing — and never edits a listing.
 * Closed by default (503).
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { formatDate, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { REASONS, accommodationLabel, contractLabel, problemLabel, reasonLabel } from '@/lib/jobBoard';

const QUEUES = ['pending', 'published'];

/** @param {{ item: any, queue: string, onAct: (body: Record<string, unknown>) => Promise<void>, busy: boolean }} props */
function Item({ item, queue, onAct, busy }) {
  const { t } = useT('employment');
  const fr = useFrAttrs();
  const [reason, setReason] = useState('');
  const sel = `job-reason-${item.id}`;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900" {...fr}>{item.title}</h3>
      <p className="text-sm text-slate-800"><span {...fr}>{item.employerName}</span> — {item.employerVerified ? t('employment:admin.verified', 'structure vérifiée') : <strong>{t('employment:admin.not_verified', 'structure NON vérifiée ou inactive')}</strong>}</p>
      <p className="text-sm text-slate-800">{contractLabel(item.contractType, t)} — <span {...fr}>{item.city}</span> ({item.postalCode}) — {t('employment:list.until', 'Offre visible jusqu’au')} {formatDate(item.expiresOn)}</p>
      <ul className="list-disc ps-5 text-sm text-slate-800">{(item.accommodations || []).map((a) => <li key={a}>{accommodationLabel(a, t)}</li>)}</ul>
      <div className="whitespace-pre-line text-slate-900" {...fr}>{item.description}</div>
      <p className="text-sm text-slate-800">{t('employment:admin.channel', 'Moyen de candidature')} : <code>{item.applyTarget}</code></p>
      {item.problems?.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900" data-testid="job-admin-problems">
          <p className="font-semibold">{t('employment:admin.problems', 'Bloque la publication (l’offre ne peut pas être modifiée ici : refusez-la avec un motif)')}</p>
          <ul className="list-disc ps-5">{item.problems.map((p) => <li key={p}>{problemLabel(p, t) || <code>{p}</code>}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={sel} className="block text-sm font-semibold text-slate-900">{t('employment:admin.reason', 'Motif (refus ou retrait)')}</label>
          <select id={sel} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('employment:admin.choose', 'Choisir un motif')}</option>
            {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
          </select>
        </div>
        {queue === 'pending' ? (
          <>
            <Button size="sm" disabled={busy || item.problems?.length > 0} onClick={() => onAct({ action: 'approve', id: item.id })}>{t('employment:admin.approve', 'Publier')}</Button>
            <Button size="sm" variant="destructive" disabled={busy || !reason} onClick={() => onAct({ action: 'reject', id: item.id, reason })}>{t('employment:admin.reject', 'Refuser (l’employeur peut corriger)')}</Button>
          </>
        ) : (
          <Button size="sm" variant="destructive" disabled={busy || !reason} onClick={() => onAct({ action: 'takedown', id: item.id, reason })}>{t('employment:admin.takedown', 'Retirer du site')}</Button>
        )}
      </div>
    </li>
  );
}

export default function JobBoardAdmin() {
  const { t } = useT('employment');
  const [queue, setQueue] = useState('pending');
  const [items, setItems] = useState(null);
  const [closed, setClosed] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.admin.listJobListings(queue).then((r) => { setClosed(false); setItems(r?.items || []); })
      .catch((e) => { if (e?.status === 503) setClosed(true); else { setItems([]); setMsg(e?.payload?.error || e?.message || t('employment:admin.failed', 'Action refusée.')); } });
  }, [queue, t]);
  useEffect(() => { load(); }, [load]);
  const act = async (body) => {
    setBusy(true); setMsg('');
    try { await apiClient.admin.jobListingAction(body); setMsg(t('employment:admin.done', 'Décision enregistrée.')); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('employment:admin.failed', 'Action refusée.')); }
    finally { setBusy(false); }
  };
  const title = t('employment:admin.title', 'Relecture des offres d’emploi');
  const queueLabel = (q) => ({ pending: t('employment:admin.queue.pending', 'À relire'), published: t('employment:admin.queue.published', 'Publiées') }[q]);
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/admin/offres-emploi" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('employment:admin.intro', 'Chaque offre est relue avant publication. Refusez ou retirez toute offre qui contient un critère de sélection interdit (âge, sexe, origine, santé, handicap, situation de famille… — Code du travail, article L1132-1), qui demande aux candidats des informations sur leur santé ou un handicap, qui promet une aide ou un droit, ou dont le moyen de candidature ne mène pas à l’employeur. Vous ne voyez jamais qui a écrit l’offre.')}</p>
      </div>
      {closed ? (
        <p role="status" data-testid="jobs-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('employment:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('employment:admin.queues', 'Files de relecture')}>
            {QUEUES.map((q) => <Button key={q} size="sm" variant={q === queue ? 'default' : 'outline'} aria-pressed={q === queue} onClick={() => setQueue(q)}>{queueLabel(q)}</Button>)}
          </div>
          <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
          <section aria-labelledby="jobs-queue">
            <h2 id="jobs-queue" className="text-lg font-semibold text-slate-900">{queueLabel(queue)}</h2>
            {items === null ? <p role="status">{t('employment:loading', 'Chargement…')}</p>
              : items.length === 0 ? <p className="text-sm text-slate-700" data-testid="job-admin-empty">{t('employment:admin.empty', 'Aucune offre dans cette file.')}</p>
                : <ul className="mt-2 space-y-4" data-testid="job-admin-queue">{items.map((x) => <Item key={x.id} item={x} queue={queue} onAct={act} busy={busy} />)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
