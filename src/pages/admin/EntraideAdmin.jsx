// @ts-nocheck
/**
 * X03 (expansion) — the moderation of Entraide (api/_handlers/admin/entraide.js). ⚠ A dedicated AIPD is mandatory before any opening (closed by default:
 * 503). Reading and acting need a named administrator with MFA; every read and decision is audited. The moderator works on PSEUDONYMS: reported members
 * (report counts per reason, their open offers) and suspended ones — never the account, its e-mail, who reported, the request notes or the shared e-mails.
 * Suspend (closed reason: offers closed, requests ended, shared e-mails deleted), reinstate, dismiss the reports, close one offer.
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import StatementFields from '@/components/moderation/StatementFields';
import { EMPTY_STATEMENT, statementBody, statementReady } from '@/lib/moderation';
import { useT } from '@/i18n';
import { REASONS, areaLabel, categoryLabel, reasonLabel } from '@/lib/entraide';

const QUEUES = ['reported', 'suspended'];

/** @param {{ item: any, onAct: (body: Record<string, unknown>) => Promise<void>, busy: boolean }} props */
function Item({ item, onAct, busy }) {
  const { t } = useT('entraide');
  const [reason, setReason] = useState('');
  // G14 / DSA art. 17: the statement of reasons is written before any restriction or decision on reports (the server refuses it without facts)
  const [st, setSt] = useState(EMPTY_STATEMENT);
  const ok = statementReady(st);
  const sel = `entraide-reason-${item.pseudonym}`;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900">{item.pseudonym}</h3>
      <p className="text-sm text-slate-700">{t('entraide:admin.since', 'Membre depuis {{m}}', { m: item.memberSince })}{item.suspensionReason ? ` — ${t('entraide:admin.suspended_for', 'suspendu : {{r}}', { r: reasonLabel(item.suspensionReason, t) })}` : ''}</p>
      {item.reports?.total > 0 && (
        <p className="text-sm text-slate-800" data-testid="entraide-admin-reports">
          {t('entraide:admin.reports', '{{n}} signalement(s) :', { n: item.reports.total })} {Object.entries(item.reports.reasons).map(([r, n]) => `${reasonLabel(r, t)} (${n})`).join(', ')}
        </p>
      )}
      {item.offers?.length > 0 && (
        <ul className="list-disc space-y-1 ps-5 text-sm text-slate-900">
          {item.offers.map((o) => (
            <li key={o.id}>
              {categoryLabel(o.category, t)} — {areaLabel(o.area, t)}{o.note ? ` — « ${o.note} »` : ''}
              <Button size="sm" variant="outline" className="ms-2" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'close_offer', offerId: o.id, reason, ...statementBody(st) })}>{t('entraide:admin.close_offer', 'Fermer cette offre')}</Button>
            </li>
          ))}
        </ul>
      )}
      <StatementFields value={st} onChange={setSt} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={sel} className="block text-sm font-semibold text-slate-900">{t('entraide:admin.reason', 'Motif (suspension ou fermeture)')}</label>
          <select id={sel} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('entraide:report.choose', 'Choisir un motif')}</option>
            {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
          </select>
        </div>
        {item.status === 'active' ? (
          <>
            <Button size="sm" variant="destructive" disabled={busy || !reason || !ok} onClick={() => onAct({ action: 'suspend', pseudonym: item.pseudonym, reason, ...statementBody(st) })}>{t('entraide:admin.suspend', 'Suspendre ce pseudonyme')}</Button>
            {item.reports?.total > 0 && <Button size="sm" variant="outline" disabled={busy || !ok} onClick={() => onAct({ action: 'dismiss_reports', pseudonym: item.pseudonym, ...statementBody(st) })}>{t('entraide:admin.dismiss', 'Classer les signalements')}</Button>}
          </>
        ) : <Button size="sm" variant="outline" disabled={busy || !ok} onClick={() => onAct({ action: 'reinstate', pseudonym: item.pseudonym, ...statementBody(st) })}>{t('entraide:admin.reinstate', 'Lever la suspension')}</Button>}
      </div>
    </li>
  );
}

export default function EntraideAdmin() {
  const { t } = useT('entraide');
  const [queue, setQueue] = useState('reported');
  const [items, setItems] = useState(null);
  const [closed, setClosed] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.admin.listEntraide(queue).then((r) => { setClosed(false); setItems(r?.items || []); })
      .catch((e) => { if (e?.status === 503) setClosed(true); else { setItems([]); setMsg(e?.payload?.error || e?.message || t('entraide:failed', 'Action refusée.')); } });
  }, [queue, t]);
  useEffect(() => { load(); }, [load]);
  const act = async (body) => {
    setBusy(true); setMsg('');
    try { await apiClient.admin.entraideAction(body); setMsg(t('entraide:admin.done', 'Décision enregistrée.')); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('entraide:failed', 'Action refusée.')); }
    finally { setBusy(false); }
  };
  const title = t('entraide:admin.title', 'Modération de l’entraide');
  const queueLabel = (q) => ({ reported: t('entraide:admin.queue.reported', 'Pseudonymes signalés'), suspended: t('entraide:admin.queue.suspended', 'Pseudonymes suspendus') }[q]);
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/admin/entraide" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('entraide:admin.intro', 'Suspendez un pseudonyme en cas de demande d’argent, de harcèlement, de comportement inquiétant ou de demande d’informations sensibles. Vous ne voyez jamais le compte, l’adresse e-mail, les notes des demandes ni qui a signalé.')}</p>
      </div>
      {closed ? (
        <p role="status" data-testid="entraide-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('entraide:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera seulement après la validation de son analyse d’impact sur la protection des données.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('entraide:admin.queues', 'Files de modération')}>
            {QUEUES.map((q) => <Button key={q} size="sm" variant={q === queue ? 'default' : 'outline'} aria-pressed={q === queue} onClick={() => setQueue(q)}>{queueLabel(q)}</Button>)}
          </div>
          <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
          <section aria-labelledby="entraide-queue">
            <h2 id="entraide-queue" className="text-lg font-semibold text-slate-900">{queueLabel(queue)}</h2>
            {items === null ? <p role="status">{t('entraide:loading', 'Chargement…')}</p>
              : items.length === 0 ? <p className="text-sm text-slate-700" data-testid="entraide-admin-empty">{t('entraide:admin.empty', 'Personne dans cette file.')}</p>
                : <ul className="mt-2 space-y-4" data-testid="entraide-admin-queue">{items.map((x) => <Item key={x.pseudonym} item={x} onAct={act} busy={busy} />)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
