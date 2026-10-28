// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { OUTCOME_LABELS, REASON_LABELS, REFERRAL_STATUS_LABELS, RESPONSE_LABELS, label } from '@/lib/caseLabels';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '');

/**
 * PKG-4 / E06 R09 R10 R11 — Orientations (/pro/orientations, /pro/orientations/:id): the organization's inbox of received referrals and the referrals it sent. The server
 * decides which actions are possible (transition rules); this screen offers the ones that fit the current state and side, and shows the server's refusal otherwise.
 */
export default function ProReferrals() {
  const { id } = useParams();
  return id ? <ReferralDetail id={id} /> : <ReferralBoxes />;
}

function ReferralBoxes() {
  const [box, setBox] = useState('inbox');
  const [state, setState] = useState({ loading: true, error: '', referrals: [] });
  useEffect(() => {
    let live = true; setState((x) => ({ ...x, loading: true }));
    proRdvRequest('/api/pro/referrals', { query: { box } }).then((out) => live && setState({ loading: false, error: '', referrals: out.referrals || [] }))
      .catch((e) => live && setState({ loading: false, error: msgOf(e, 'Impossible de charger les orientations.'), referrals: [] }));
    return () => { live = false; };
  }, [box]);
  return (
    <div className="space-y-4" data-testid="pro-referrals">
      <SEO title="Orientations" noindex />
      <h1 className="text-xl font-bold text-slate-900">Orientations</h1>
      <div className="flex gap-2" role="tablist">
        <Button type="button" role="tab" aria-selected={box === 'inbox'} variant={box === 'inbox' ? 'default' : 'outline'} data-testid="pro-ref-tab-inbox" onClick={() => setBox('inbox')}>Reçues</Button>
        <Button type="button" role="tab" aria-selected={box === 'outbox'} variant={box === 'outbox' ? 'default' : 'outline'} data-testid="pro-ref-tab-outbox" onClick={() => setBox('outbox')}>Envoyées</Button>
      </div>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {state.loading ? <p role="status">Chargement…</p> : state.referrals.length ? (
        <ul className="space-y-2">{state.referrals.map((r) => (
          <li key={r.id} data-testid="pro-ref-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <span>{box === 'inbox' ? `De ${r.fromName}` : `Vers ${r.toName}`} — {label(REASON_LABELS, r.reasonCode)} — <strong data-testid="pro-ref-status">{label(REFERRAL_STATUS_LABELS, r.status)}</strong>{r.overdue ? ' — en retard' : ''}</span>
            <Button asChild size="sm" variant="outline"><Link to={`/pro/orientations/${encodeURIComponent(r.id)}`} data-testid="pro-ref-open">Ouvrir</Link></Button>
          </li>
        ))}</ul>
      ) : <p className="text-sm text-slate-700" data-testid="pro-ref-empty">{box === 'inbox' ? 'Aucune orientation reçue.' : 'Aucune orientation envoyée.'}</p>}
    </div>
  );
}

function ReferralDetail({ id }) {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ responseCode: '', message: '', outcome: '', citizenSummary: '', appointmentId: '' });
  const [appointments, setAppointments] = useState([]);
  const load = useCallback(async () => {
    try { setData(await proRdvRequest('/api/pro/referrals', { query: { id } })); setError(''); }
    catch (e) { setError(e?.status === 404 ? 'Orientation introuvable pour votre structure.' : msgOf(e, 'Impossible de charger l’orientation.')); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { proRdvRequest('/api/pro/appointments', { query: { pageSize: 50, from: new Date().toISOString() } }).then((o) => setAppointments(o.items || [])).catch(() => setAppointments([])); }, []);
  const act = async (action, extra, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action, id, ...extra } }); setMessage(ok); await load(); }
    catch (e) { setProblem(msgOf(e, 'Action impossible.')); } finally { setBusy(false); }
  };
  if (error) return <div className="space-y-3"><h1 className="text-xl font-bold text-slate-900">Orientation</h1><p role="alert" data-testid="pro-ref-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{error}</p></div>;
  if (!data) return <p role="status">Chargement…</p>;
  const r = data.referral; const recv = data.side === 'RECEIVER'; const s = r.status;
  return (
    <div className="space-y-4" data-testid="pro-ref-detail">
      <SEO title="Orientation" noindex />
      <p><Link className="text-blue-800 underline" to="/pro/orientations">← Orientations</Link></p>
      <h1 className="text-xl font-bold text-slate-900">{recv ? `Orientation reçue de ${r.from}` : `Orientation vers ${r.to}`}</h1>
      <p className="text-sm">Statut : <strong data-testid="pro-ref-detail-status">{label(REFERRAL_STATUS_LABELS, s)}</strong>{r.dueAt && ['SENT', 'ACKNOWLEDGED'].includes(s) ? ` — réponse attendue avant le ${when(r.dueAt)}` : ''}</p>
      <div aria-live="polite" role="status" data-testid="pro-ref-status-msg">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="pro-ref-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <Card><CardHeader><CardTitle className="text-lg">Demande</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p>Motif : {label(REASON_LABELS, r.reasonCode)}</p>
        {r.message ? <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2" data-testid="pro-ref-message">{r.message}</p> : null}
        {r.responseCode ? <p>Réponse : {label(RESPONSE_LABELS, r.responseCode)}{r.responseMessage ? ` — « ${r.responseMessage} »` : ''}</p> : null}
        {r.outcome ? <p data-testid="pro-ref-outcome">Résultat : <strong>{label(OUTCOME_LABELS, r.outcome)}</strong>{r.outcomeSummary ? ` — « ${r.outcomeSummary} »` : ''}</p> : null}
        {r.appointment ? <p>Rendez-vous : {when(r.appointment.startAt)} ({r.appointment.mode === 'VIDEO' ? 'À distance (visio)' : 'En présentiel'})</p> : null}
        {r.dossierId ? <Button asChild size="sm" variant="outline"><Link to={`/pro/dossier/${encodeURIComponent(r.dossierId)}`} data-testid="pro-ref-dossier">Voir le dossier partagé</Link></Button>
          : recv ? <p className="text-slate-700" data-testid="pro-ref-no-access">Le dossier ne vous est plus accessible (partage retiré ou orientation close).</p> : null}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-lg">Actions</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {recv && s === 'SENT' ? <Button type="button" size="sm" disabled={busy} data-testid="pro-ref-ack" onClick={() => act('acknowledge', {}, 'Réception confirmée.')}>Accuser réception</Button> : null}
        {recv && ['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(s) ? <Button type="button" size="sm" disabled={busy} data-testid="pro-ref-accept" onClick={() => act('accept', {}, 'Orientation acceptée : le dossier apparaît dans vos dossiers suivis.')}>Accepter</Button> : null}
        {recv && ['SENT', 'ACKNOWLEDGED'].includes(s) ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <select aria-label="Motif de la réponse" data-testid="pro-ref-response" className="w-full rounded-md border border-slate-300 p-2" value={form.responseCode} onChange={(e) => setForm({ ...form, responseCode: e.target.value })}>
              <option value="">Motif pour décliner…</option>{Object.entries(RESPONSE_LABELS).filter(([k]) => k !== 'NEEDS_MORE_INFORMATION').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="block">Message (facultatif pour décliner, obligatoire pour demander des précisions)<textarea data-testid="pro-ref-response-msg" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || !form.responseCode} data-testid="pro-ref-decline" onClick={() => act('decline', { responseCode: form.responseCode, message: form.message }, 'Orientation déclinée : votre accès au dossier est retiré.')}>Décliner</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy || form.message.trim().length < 5} data-testid="pro-ref-needs-info" onClick={() => act('needs_info', { message: form.message }, 'Demande de précisions envoyée.')}>Demander des précisions</Button>
            </div>
          </div>
        ) : null}
        {recv && ['ACCEPTED', 'IN_PROGRESS'].includes(s) ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <label className="block">Rendez-vous de votre structure
              <select data-testid="pro-ref-appointment" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.appointmentId} onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}>
                <option value="">Choisir…</option>{appointments.map((a) => <option key={a.id} value={a.id}>{when(a.startAt)} — {a.modeLabel || ''} — {a.serviceName || ''}</option>)}
              </select></label>
            <Button type="button" size="sm" variant="outline" disabled={busy || !form.appointmentId} data-testid="pro-ref-link-appt" onClick={() => act('link_appointment', { appointmentId: form.appointmentId }, 'Rendez-vous associé à l’orientation.')}>Associer le rendez-vous</Button>
            <select aria-label="Résultat de l’accompagnement" data-testid="pro-ref-outcome-select" className="w-full rounded-md border border-slate-300 p-2" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
              <option value="">Résultat de l’accompagnement…</option>{Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="block">Message à la personne (facultatif)<textarea data-testid="pro-ref-summary" maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.citizenSummary} onChange={(e) => setForm({ ...form, citizenSummary: e.target.value })} /></label>
            <Button type="button" size="sm" disabled={busy || !form.outcome} data-testid="pro-ref-complete" onClick={() => act('complete', { outcome: form.outcome, citizenSummary: form.citizenSummary }, 'Résultat enregistré : la personne et la structure d’origine le voient.')}>Indiquer le résultat</Button>
          </div>
        ) : null}
        {!recv && s === 'NEEDS_INFO' ? (
          <div className="space-y-2"><label className="block">Votre réponse<textarea data-testid="pro-ref-reply-msg" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <Button type="button" size="sm" disabled={busy || form.message.trim().length < 5} data-testid="pro-ref-reply" onClick={() => act('reply', { message: form.message }, 'Réponse envoyée.')}>Répondre</Button></div>
        ) : null}
        {!recv && ['PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(s) ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="pro-ref-cancel" onClick={() => act('cancel', {}, 'Orientation annulée.')}>Annuler l’orientation</Button> : null}
        {!recv && ['COMPLETED', 'DECLINED', 'EXPIRED'].includes(s) ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="pro-ref-close" onClick={() => act('close', {}, 'Orientation clôturée.')}>Clôturer</Button> : null}
        {['CLOSED', 'CANCELLED'].includes(s) ? <p className="text-slate-700">Cette orientation est terminée.</p> : null}
        {!recv && s === 'PENDING_CITIZEN' ? <p className="text-slate-700" data-testid="pro-ref-waiting-citizen">En attente de l’accord de la personne : rien n’a été transmis.</p> : null}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-lg">Historique</CardTitle></CardHeader><CardContent>
        <ol className="space-y-1 text-sm" data-testid="pro-ref-history">{data.events.map((e, i) => <li key={i}>{when(e.at)} — {e.actor === 'CITIZEN' ? 'la personne' : e.actor === 'SENDER' ? 'structure d’origine' : e.actor === 'RECEIVER' ? 'structure destinataire' : 'automatique'} : {label(REFERRAL_STATUS_LABELS, e.to)}</li>)}</ol>
      </CardContent></Card>
    </div>
  );
}
