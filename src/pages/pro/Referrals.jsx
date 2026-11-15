// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { label } from '@/lib/caseLabels';
import { useCaseLabels } from '@/lib/caseLabelsI18n';
import { useT, formatDateTime } from '@/i18n';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const when = (d) => (d ? formatDateTime(d) : '');

/**
 * PKG-4 / E06 R09 R10 R11 — Orientations (/pro/orientations, /pro/orientations/:id): the organization's inbox of received referrals and the referrals it sent. The server
 * decides which actions are possible (transition rules); this screen offers the ones that fit the current state and side, and shows the server's refusal otherwise.
 * M2: a receiver that declines may suggest another organization (only its name is recorded; nothing is sent to it); the sender sees the suggestion and may
 * propose it to the person (its own decision); the next step and a « needs a follow-up » flag are shown; the texts of the exchange are listed in order.
 */

/** the next step of a referral in the professionals' words (the code comes from the server; an unknown code shows nothing) */
function useNextStepLabels() {
  const { t } = useT('pro');
  return (code) => ({
    CITIZEN_DECIDE: t('pro:referrals.next.citizen_decide', 'la personne doit donner ou refuser son accord'),
    RECEIVER_ANSWER: t('pro:referrals.next.receiver_answer', 'la structure destinataire doit répondre'),
    SENDER_REPLY: t('pro:referrals.next.sender_reply', 'la structure d’origine doit apporter les précisions demandées'),
    RECEIVER_FIRST_STEP: t('pro:referrals.next.receiver_first_step', 'la structure destinataire doit enregistrer une première étape (suivi commencé, rendez-vous ou résultat)'),
    APPOINTMENT: t('pro:referrals.next.appointment', 'un rendez-vous est prévu'),
    RECEIVER_RESULT: t('pro:referrals.next.receiver_result', 'la structure destinataire indiquera le résultat de l’accompagnement'),
    SENDER_PROPOSE_SUGGESTED: t('pro:referrals.next.sender_propose_suggested', 'la structure d’origine peut proposer à la personne la structure suggérée'),
    SENDER_NEXT: t('pro:referrals.next.sender_next', 'la structure d’origine voit avec la personne quelle suite proposer'),
  }[code] || '');
}
export default function ProReferrals() {
  const { id } = useParams();
  return id ? <ReferralDetail id={id} /> : <ReferralBoxes />;
}

function ReferralBoxes() {
  const { t } = useT('pro');
  const { reason: REASON_LABELS, referralStatus: REFERRAL_STATUS_LABELS } = useCaseLabels();
  const [box, setBox] = useState('inbox');
  const [state, setState] = useState({ loading: true, error: '', referrals: [] });
  useEffect(() => {
    let live = true; setState((x) => ({ ...x, loading: true }));
    proRdvRequest('/api/pro/referrals', { query: { box } }).then((out) => live && setState({ loading: false, error: '', referrals: out.referrals || [] }))
      .catch((e) => live && setState({ loading: false, error: msgOf(e, t('pro:referrals.load_failed', 'Impossible de charger les orientations.')), referrals: [] }));
    return () => { live = false; };
  }, [box]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  return (
    <div className="space-y-4" data-testid="pro-referrals">
      <SEO title={t('pro:referrals.title', 'Orientations')} noindex />
      <h1 className="text-xl font-bold text-slate-900">{t('pro:referrals.title', 'Orientations')}</h1>
      <div className="flex gap-2" role="tablist">
        <Button type="button" role="tab" aria-selected={box === 'inbox'} variant={box === 'inbox' ? 'default' : 'outline'} data-testid="pro-ref-tab-inbox" onClick={() => setBox('inbox')}>{t('pro:referrals.tab_inbox', 'Reçues')}</Button>
        <Button type="button" role="tab" aria-selected={box === 'outbox'} variant={box === 'outbox' ? 'default' : 'outline'} data-testid="pro-ref-tab-outbox" onClick={() => setBox('outbox')}>{t('pro:referrals.tab_outbox', 'Envoyées')}</Button>
      </div>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {state.loading ? <p role="status">{t('pro:referrals.loading', 'Chargement…')}</p> : state.referrals.length ? (
        <ul className="space-y-2">{state.referrals.map((r) => (
          <li key={r.id} data-testid="pro-ref-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <span>{box === 'inbox' ? t('pro:referrals.from', 'De {{name}}', { name: r.fromName }) : t('pro:referrals.to', 'Vers {{name}}', { name: r.toName })}{r.reasonCode ? ` — ${label(REASON_LABELS, r.reasonCode)}` : ''} — <strong data-testid="pro-ref-status">{label(REFERRAL_STATUS_LABELS, r.status)}</strong>{r.overdue ? ` — ${t('pro:referrals.overdue', 'en retard')}` : ''}{r.stalled ? <span data-testid="pro-ref-stalled">{` — ${t('pro:referrals.stalled', 'acceptée, sans suite enregistrée')}`}</span> : null}{r.suggested ? <span data-testid="pro-ref-suggested">{` — ${t('pro:referrals.suggested_badge', 'autre structure suggérée')}`}</span> : null}{r.needsFollowUp ? <strong data-testid="pro-ref-follow-up">{` — ${t('pro:referrals.follow_up_badge', 'à relancer')}`}</strong> : null}</span>
            <Button asChild size="sm" variant="outline"><Link to={`/pro/orientations/${encodeURIComponent(r.id)}`} data-testid="pro-ref-open">{t('pro:referrals.open', 'Ouvrir')}</Link></Button>
          </li>
        ))}</ul>
      ) : <p className="text-sm text-slate-700" data-testid="pro-ref-empty">{box === 'inbox' ? t('pro:referrals.empty_inbox', 'Aucune orientation reçue.') : t('pro:referrals.empty_outbox', 'Aucune orientation envoyée.')}</p>}
    </div>
  );
}

function ReferralDetail({ id }) {
  const { t } = useT('pro');
  const { outcome: OUTCOME_LABELS, reason: REASON_LABELS, referralStatus: REFERRAL_STATUS_LABELS, response: RESPONSE_LABELS } = useCaseLabels();
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const nextStep = useNextStepLabels();
  const [form, setForm] = useState({ responseCode: '', message: '', outcome: '', citizenSummary: '', appointmentId: '', suggestQuery: '', suggestedStructureId: '' });
  const [suggestable, setSuggestable] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const load = useCallback(async () => {
    try { setData(await proRdvRequest('/api/pro/referrals', { query: { id } })); setError(''); }
    catch (e) { setError(e?.status === 404 ? t('pro:referrals.not_found', 'Orientation introuvable pour votre structure.') : msgOf(e, t('pro:referrals.load_one_failed', 'Impossible de charger l’orientation.'))); }
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  useEffect(() => { proRdvRequest('/api/pro/appointments', { query: { pageSize: 50, from: new Date().toISOString() } }).then((o) => setAppointments(o.items || [])).catch(() => setAppointments([])); }, []);
  const act = async (action, extra, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action, id, ...extra } }); setMessage(ok); await load(); }
    catch (e) { setProblem(msgOf(e, t('pro:referrals.action_failed', 'Action impossible.'))); } finally { setBusy(false); }
  };
  const searchSuggestable = async () => {
    try { const out = await proRdvRequest('/api/pro/referrals', { query: { suggestFor: id, receivers: form.suggestQuery } }); setSuggestable(out.receivers || []); setProblem(''); }
    catch (e) { setProblem(msgOf(e, t('pro:referrals.suggest_search_failed', 'Recherche impossible.'))); }
  };
  /** the sender proposes the suggested organization to the person: a NEW referral linked to this one — nothing is shared before the person agrees */
  const proposeSuggested = async (r) => {
    setBusy(true); setMessage(''); setProblem('');
    try {
      await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action: 'propose', caseId: r.caseId, toStructureId: r.suggested.id, reasonCode: r.reasonCode, previousReferralId: id, idempotencyKey: `redirect-${id}` } });
      setMessage(t('pro:referrals.suggested_proposed', 'Orientation proposée à la personne : rien n’est transmis avant son accord.')); await load();
    } catch (e) { setProblem(msgOf(e, t('pro:referrals.action_failed', 'Action impossible.'))); } finally { setBusy(false); }
  };
  if (error) return <div className="space-y-3"><h1 className="text-xl font-bold text-slate-900">{t('pro:referrals.detail_title', 'Orientation')}</h1><p role="alert" data-testid="pro-ref-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{error}</p></div>;
  if (!data) return <p role="status">{t('pro:referrals.loading', 'Chargement…')}</p>;
  const r = data.referral; const recv = data.side === 'RECEIVER'; const s = r.status;
  return (
    <div className="space-y-4" data-testid="pro-ref-detail">
      <SEO title={t('pro:referrals.detail_title', 'Orientation')} noindex />
      <p><Link className="text-blue-800 underline" to="/pro/orientations">← {t('pro:referrals.title', 'Orientations')}</Link></p>
      <h1 className="text-xl font-bold text-slate-900">{recv ? t('pro:referrals.received_from', 'Orientation reçue de {{name}}', { name: r.from }) : t('pro:referrals.sent_to', 'Orientation vers {{name}}', { name: r.to })}</h1>
      <p className="text-sm">{t('pro:referrals.status_label', 'Statut :')} <strong data-testid="pro-ref-detail-status">{label(REFERRAL_STATUS_LABELS, s)}</strong>{r.dueAt && ['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(s) ? ` — ${t('pro:referrals.due', 'réponse attendue avant le {{date}}', { date: when(r.dueAt) })}` : ''}</p>
      {r.nextAction && nextStep(r.nextAction.code) ? <p className="text-sm" data-testid="pro-ref-next">{t('pro:referrals.next_label', 'Prochaine étape :')} {nextStep(r.nextAction.code)}</p> : null}
      {r.needsFollowUp ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="pro-ref-needs-follow-up">{t('pro:referrals.needs_follow_up', 'Sans avancée depuis un moment : une relance par une personne est nécessaire.')}</p> : null}
      {r.previous ? <p className="text-sm">{t('pro:referrals.follows_previous', 'Cette orientation fait suite à une orientation qui n’a pas abouti.')} <Link className="text-blue-800 underline" data-testid="pro-ref-previous" to={`/pro/orientations/${encodeURIComponent(r.previous.id)}`}>{t('pro:referrals.see_previous', 'Voir l’orientation précédente')}</Link></p> : null}
      {r.next ? <p className="text-sm">{t('pro:referrals.has_next', 'Une nouvelle orientation fait suite à celle-ci.')} <Link className="text-blue-800 underline" data-testid="pro-ref-next-link" to={`/pro/orientations/${encodeURIComponent(r.next.id)}`}>{t('pro:referrals.see_next', 'Voir la suite')}</Link></p> : null}
      <div aria-live="polite" role="status" data-testid="pro-ref-status-msg">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="pro-ref-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <Card><CardHeader><CardTitle className="text-lg">{t('pro:referrals.card_request', 'Demande')}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        {r.reasonCode ? <p>{t('pro:referrals.reason_label', 'Motif :')} {label(REASON_LABELS, r.reasonCode)}</p> : null}
        {r.message ? <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2" data-testid="pro-ref-message">{r.message}</p> : null}
        {r.responseCode ? <p>{t('pro:referrals.response_label', 'Réponse :')} {label(RESPONSE_LABELS, r.responseCode)}{r.responseMessage ? ` — « ${r.responseMessage} »` : ''}</p> : null}
        {r.suggested ? <p data-testid="pro-ref-suggested-name">{t('pro:referrals.suggested_label', 'Structure suggérée :')} <strong>{r.suggested.name}</strong> — {t('pro:referrals.suggested_nothing_sent', 'rien ne lui a été transmis.')}</p> : null}
        {r.outcome ? <p data-testid="pro-ref-outcome">{t('pro:referrals.outcome_label', 'Résultat :')} <strong>{label(OUTCOME_LABELS, r.outcome)}</strong>{r.outcomeSummary ? ` — « ${r.outcomeSummary} »` : ''}</p> : null}
        {r.appointment ? <p>{t('pro:referrals.appointment_label', 'Rendez-vous :')} {when(r.appointment.startAt)} ({r.appointment.mode === 'VIDEO' ? t('pro:referrals.mode_video', 'À distance (visio)') : t('pro:referrals.mode_onsite', 'En présentiel')})</p> : null}
        {r.dossierId ? <Button asChild size="sm" variant="outline"><Link to={`/pro/dossier/${encodeURIComponent(r.dossierId)}`} data-testid="pro-ref-dossier">{t('pro:referrals.view_shared', 'Voir le dossier partagé')}</Link></Button>
          : recv ? <p className="text-slate-700" data-testid="pro-ref-no-access">{t('pro:referrals.no_access', 'Le dossier ne vous est plus accessible (partage retiré ou orientation close).')}</p> : null}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-lg">{t('pro:referrals.card_actions', 'Actions')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {recv && s === 'SENT' ? <Button type="button" size="sm" disabled={busy} data-testid="pro-ref-ack" onClick={() => act('acknowledge', {}, t('pro:referrals.acked', 'Réception confirmée.'))}>{t('pro:referrals.ack', 'Accuser réception')}</Button> : null}
        {recv && ['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(s) ? <Button type="button" size="sm" disabled={busy} data-testid="pro-ref-accept" onClick={() => act('accept', {}, t('pro:referrals.accepted', 'Orientation acceptée : le dossier apparaît dans vos dossiers suivis.'))}>{t('pro:referrals.accept', 'Accepter')}</Button> : null}
        {recv && ['SENT', 'ACKNOWLEDGED'].includes(s) ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <select aria-label={t('pro:referrals.response_reason', 'Motif de la réponse')} data-testid="pro-ref-response" className="w-full rounded-md border border-slate-300 p-2" value={form.responseCode} onChange={(e) => setForm({ ...form, responseCode: e.target.value })}>
              <option value="">{t('pro:referrals.decline_reason', 'Motif pour décliner…')}</option>{Object.entries(RESPONSE_LABELS).filter(([k]) => k !== 'NEEDS_MORE_INFORMATION').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {form.responseCode === 'REDIRECT_SUGGESTED' ? (
              <div className="space-y-2 rounded-md bg-slate-50 p-2" data-testid="pro-ref-suggest">
                <p>{t('pro:referrals.suggest_note', 'Seul le nom de la structure suggérée est enregistré. Rien ne lui est transmis : la structure d’origine décidera de la proposer à la personne, qui devra donner son accord.')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label htmlFor="ref-suggest-search">{t('pro:referrals.suggest_search', 'Structure à suggérer (vérifiées uniquement)')}</label>
                  <input id="ref-suggest-search" data-testid="pro-ref-suggest-search" className="rounded-md border border-slate-300 p-1" value={form.suggestQuery} onChange={(e) => setForm({ ...form, suggestQuery: e.target.value })} />
                  <Button type="button" size="sm" variant="outline" data-testid="pro-ref-suggest-search-btn" onClick={searchSuggestable}>{t('pro:referrals.suggest_search_btn', 'Rechercher')}</Button>
                </div>
                {suggestable.length ? (
                  <select aria-label={t('pro:referrals.suggest_choose', 'Structure suggérée')} data-testid="pro-ref-suggest-target" className="w-full rounded-md border border-slate-300 p-2" value={form.suggestedStructureId} onChange={(e) => setForm({ ...form, suggestedStructureId: e.target.value })}>
                    <option value="">{t('pro:referrals.suggest_placeholder', 'Choisir la structure à suggérer…')}</option>{suggestable.map((x) => <option key={x.id} value={x.id}>{x.name}{x.city ? ` (${x.city})` : ''}</option>)}
                  </select>
                ) : null}
              </div>
            ) : null}
            <label className="block">{t('pro:referrals.response_message', 'Message (facultatif pour décliner, obligatoire pour demander des précisions)')}<textarea data-testid="pro-ref-response-msg" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || !form.responseCode || (form.responseCode === 'REDIRECT_SUGGESTED' && !form.suggestedStructureId)} data-testid="pro-ref-decline" onClick={() => act('decline', { responseCode: form.responseCode, message: form.message, ...(form.responseCode === 'REDIRECT_SUGGESTED' ? { suggestedStructureId: form.suggestedStructureId } : {}) }, t('pro:referrals.declined', 'Orientation déclinée : votre accès au dossier est retiré.'))}>{t('pro:referrals.decline', 'Décliner')}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy || form.message.trim().length < 5} data-testid="pro-ref-needs-info" onClick={() => act('needs_info', { message: form.message }, t('pro:referrals.needs_info_sent', 'Demande de précisions envoyée.'))}>{t('pro:referrals.needs_info', 'Demander des précisions')}</Button>
            </div>
          </div>
        ) : null}
        {recv && s === 'ACCEPTED' ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="pro-ref-start" onClick={() => act('start', {}, t('pro:referrals.started', 'Suivi commencé : l’orientation est en cours.'))}>{t('pro:referrals.start', 'Suivi commencé')}</Button> : null}
        {recv && ['ACCEPTED', 'IN_PROGRESS'].includes(s) ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <label className="block">{t('pro:referrals.appointment_select', 'Rendez-vous de votre structure')}
              <select data-testid="pro-ref-appointment" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.appointmentId} onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}>
                <option value="">{t('pro:referrals.choose', 'Choisir…')}</option>{appointments.map((a) => <option key={a.id} value={a.id}>{when(a.startAt)} — {a.modeLabel || ''} — {a.serviceName || ''}</option>)}
              </select></label>
            <Button type="button" size="sm" variant="outline" disabled={busy || !form.appointmentId} data-testid="pro-ref-link-appt" onClick={() => act('link_appointment', { appointmentId: form.appointmentId }, t('pro:referrals.linked', 'Rendez-vous associé à l’orientation.'))}>{t('pro:referrals.link', 'Associer le rendez-vous')}</Button>
            <select aria-label={t('pro:referrals.outcome', 'Résultat de l’accompagnement')} data-testid="pro-ref-outcome-select" className="w-full rounded-md border border-slate-300 p-2" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
              <option value="">{t('pro:referrals.outcome_placeholder', 'Résultat de l’accompagnement…')}</option>{Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="block">{t('pro:referrals.summary', 'Message à la personne (facultatif)')}<textarea data-testid="pro-ref-summary" maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.citizenSummary} onChange={(e) => setForm({ ...form, citizenSummary: e.target.value })} /></label>
            <Button type="button" size="sm" disabled={busy || !form.outcome} data-testid="pro-ref-complete" onClick={() => act('complete', { outcome: form.outcome, citizenSummary: form.citizenSummary }, t('pro:referrals.completed', 'Résultat enregistré : la personne et la structure d’origine le voient.'))}>{t('pro:referrals.complete', 'Indiquer le résultat')}</Button>
          </div>
        ) : null}
        {!recv && s === 'NEEDS_INFO' ? (
          <div className="space-y-2"><p className="text-slate-700" data-testid="pro-ref-reply-hint">{t('pro:referrals.reply_hint', 'La personne pourra lire votre réponse : elle est ajoutée au message qu’elle a autorisé, sans le remplacer.')}</p><label className="block">{t('pro:referrals.your_reply', 'Votre réponse')}<textarea data-testid="pro-ref-reply-msg" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <Button type="button" size="sm" disabled={busy || form.message.trim().length < 5} data-testid="pro-ref-reply" onClick={() => act('reply', { message: form.message }, t('pro:referrals.replied', 'Réponse envoyée.'))}>{t('pro:referrals.reply', 'Répondre')}</Button></div>
        ) : null}
        {!recv && ['PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(s) ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="pro-ref-cancel" onClick={() => act('cancel', {}, t('pro:referrals.cancelled', 'Orientation annulée.'))}>{t('pro:referrals.cancel', 'Annuler l’orientation')}</Button> : null}
        {!recv && ['COMPLETED', 'DECLINED', 'EXPIRED'].includes(s) ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="pro-ref-close" onClick={() => act('close', {}, t('pro:referrals.closed', 'Orientation clôturée.'))}>{t('pro:referrals.close', 'Clôturer')}</Button> : null}
        {r.canProposeSuggested ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2" data-testid="pro-ref-propose-suggested-block">
            <p>{t('pro:referrals.propose_suggested_note', 'La décision vous appartient : vous pouvez aussi choisir une autre structure depuis le dossier. Rien n’est transmis sans l’accord de la personne.')}</p>
            <Button type="button" size="sm" disabled={busy} data-testid="pro-ref-propose-suggested" onClick={() => proposeSuggested(r)}>{t('pro:referrals.propose_suggested', 'Proposer {{name}} à la personne', { name: r.suggested.name })}</Button>
          </div>
        ) : null}
        {['CLOSED', 'CANCELLED'].includes(s) ? <p className="text-slate-700">{t('pro:referrals.finished', 'Cette orientation est terminée.')}</p> : null}
        {!recv && s === 'PENDING_CITIZEN' ? <p className="text-slate-700" data-testid="pro-ref-waiting-citizen">{t('pro:referrals.waiting_citizen', 'En attente de l’accord de la personne : rien n’a été transmis.')}</p> : null}
      </CardContent></Card>

      {r.messages?.length ? (
        <Card><CardHeader><CardTitle className="text-lg">{t('pro:referrals.card_messages', 'Échanges')}</CardTitle></CardHeader><CardContent>
          <ol className="space-y-2 text-sm" data-testid="pro-ref-messages">{r.messages.map((m, i) => <li key={i} className="rounded-md bg-slate-50 p-2"><span className="text-xs font-semibold">{when(m.at)} — {m.side === 'SENDER' ? t('pro:referrals.actor_sender', 'structure d’origine') : t('pro:referrals.actor_receiver', 'structure destinataire')}</span><p className="whitespace-pre-wrap">{m.body}</p></li>)}</ol>
        </CardContent></Card>
      ) : null}

      <Card><CardHeader><CardTitle className="text-lg">{t('pro:referrals.card_history', 'Historique')}</CardTitle></CardHeader><CardContent>
        <ol className="space-y-1 text-sm" data-testid="pro-ref-history">{data.events.map((e, i) => <li key={i}>{when(e.at)} — {e.actor === 'CITIZEN' ? t('pro:referrals.actor_citizen', 'la personne') : e.actor === 'SENDER' ? t('pro:referrals.actor_sender', 'structure d’origine') : e.actor === 'RECEIVER' ? t('pro:referrals.actor_receiver', 'structure destinataire') : t('pro:referrals.actor_auto', 'automatique')} : {label(REFERRAL_STATUS_LABELS, e.to)}</li>)}</ol>
      </CardContent></Card>
    </div>
  );
}
