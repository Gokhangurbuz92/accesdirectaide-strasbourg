// @ts-nocheck
/**
 * G14 / DSA art. 17, 20 — « Décisions de modération » (/compte/moderation): the statements of reasons about the person's content (as author) and the
 * decisions on their reports (as notifier), with the internal complaint — six months, free, one per decision, reviewed by another person when possible.
 * Who reported is never shown. Closed by default: 503 → « not open yet ».
 */
import { useCallback, useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { actionLabel, contentTypeLabel } from '@/lib/moderation';

/** @param {{ d: any, onDone: () => void }} props */
function Decision({ d, onDone }) {
  const { t } = useT('moderation');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const appeal = async (e) => {
    e.preventDefault();
    if (body.trim().length < 10 || busy) return;
    setBusy(true); setMsg('');
    try { await citizenApi.moderationAppeal(d.id, body.trim()); setMsg(t('moderation:appeal.sent', 'Votre contestation est enregistrée. Une personne la réexaminera et vous répondra par e-mail.')); onDone(); }
    catch (err) { setMsg(err?.message || t('moderation:failed', 'Envoi refusé.')); } finally { setBusy(false); }
  };
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" data-testid="moderation-decision">
      <h3 className="font-semibold text-slate-900">
        {contentTypeLabel(d.contentType, t)} — {actionLabel(d.action, t)}
        <span className="ms-2 text-sm font-normal text-slate-700">{formatDate(d.decidedAt)}</span>
      </h3>
      <p className="text-sm text-slate-700">{d.role === 'author' ? t('moderation:mine.as_author', 'Décision concernant votre contenu') : t('moderation:mine.as_notifier', 'Décision prise sur votre signalement')}</p>
      {/* the statement is the French text sent by e-mail (canonical wording of the decision) */}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">{t('moderation:mine.statement', 'Lire l’exposé des motifs')}</summary>
        <p lang="fr" dir="ltr" className="mt-2 whitespace-pre-line text-sm text-slate-900">{d.statement}</p>
      </details>
      {d.appeal ? (
        <p className="text-sm text-slate-900" data-testid="moderation-appeal-state">
          {d.appeal.status === 'open' ? t('moderation:mine.appeal_open', 'Contestation en cours d’examen.') : t('moderation:mine.appeal_done', 'Contestation examinée : {{r}}', { r: d.appeal.response || '' })}
        </p>
      ) : d.canAppeal ? (
        open ? (
          <form onSubmit={appeal} noValidate className="space-y-2">
            <label htmlFor={`${id}-b`} className="block text-sm font-semibold text-slate-900">{t('moderation:appeal.body', 'Pourquoi la décision devrait-elle être revue ?')}</label>
            <textarea id={`${id}-b`} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" />
            <Button type="submit" size="sm" disabled={busy || body.trim().length < 10}>{t('moderation:appeal.submit', 'Envoyer la contestation')}</Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t('moderation:mine.contest', 'Contester (jusqu’au {{d}})', { d: formatDate(d.appealUntil) })}</Button>
        )
      ) : null}
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
    </li>
  );
}

export default function CompteModeration() {
  const { t } = useT('moderation');
  const [state, setState] = useState({ loading: true, closed: false, error: '', decisions: [] });
  const load = useCallback(async () => {
    try { const r = await citizenApi.myModeration(); setState({ loading: false, closed: false, error: '', decisions: r.decisions || [] }); }
    catch (err) { setState({ loading: false, closed: err.status === 503, error: err.status === 401 ? t('moderation:mine.login_required', 'Connectez-vous pour voir les décisions de modération qui vous concernent.') : err.status === 503 ? '' : err.message, decisions: [] }); }
  }, [t]);
  useEffect(() => { load(); }, [load]);
  const title = t('moderation:mine.title', 'Décisions de modération');
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/compte/moderation" noindex />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-700">{t('moderation:mine.intro', 'Ici, les décisions prises sur vos témoignages, histoires ou votre participation à l’entraide, et sur vos signalements. Chaque décision est prise par une personne ; vous pouvez la contester gratuitement pendant six mois. Vous pouvez aussi saisir le juge.')}</p>
      {state.loading && <p role="status">{t('moderation:loading', 'Chargement…')}</p>}
      {state.closed && <p role="status" data-testid="moderation-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('moderation:mine.closed', 'Cette fonction n’est pas encore ouverte : aucun contenu publié par les utilisateurs n’est en ligne.')}</p>}
      {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
      {!state.loading && !state.closed && !state.error && (state.decisions.length === 0
        ? <p className="text-sm text-slate-700" data-testid="moderation-empty">{t('moderation:mine.empty', 'Aucune décision de modération ne vous concerne.')}</p>
        : <ul className="space-y-4">{state.decisions.map((d) => <Decision key={d.id} d={d} onDone={load} />)}</ul>)}
    </div>
  );
}
