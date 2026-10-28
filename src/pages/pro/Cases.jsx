// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { CASE_EVENT_LABELS, CASE_STATUS_LABELS, OUTCOME_LABELS, REASON_LABELS, REFERRAL_STATUS_LABELS, label } from '@/lib/caseLabels';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '');

/**
 * PKG-4 / R03 R06 R07 R08 R09 R11 — Dossiers suivis (/pro/dossiers, /pro/dossiers/:id). Every rule (grant, membership, assignment, visibility) is enforced by
 * /api/pro/cases and /api/pro/referrals; this screen only shows what the server returns and says why an action is refused.
 */
export default function ProCases() {
  const { id } = useParams();
  return id ? <CaseDetail id={id} /> : <CaseQueue />;
}

function CaseQueue() {
  const [scope, setScope] = useState('mine');
  const [state, setState] = useState({ loading: true, error: '', cases: [], counts: {} });
  const load = useCallback(async (s) => {
    setState((x) => ({ ...x, loading: true }));
    try { const out = await proRdvRequest('/api/pro/cases', { query: { scope: s } }); setState({ loading: false, error: '', cases: out.cases || [], counts: out.counts || {} }); }
    catch (e) { setState({ loading: false, error: msgOf(e, 'Impossible de charger les dossiers.'), cases: [], counts: {} }); }
  }, []);
  useEffect(() => { load(scope); }, [scope, load]);
  const tabs = [['mine', `Mes dossiers (${state.counts.mine ?? '…'})`], ['unassigned', `À attribuer (${state.counts.unassigned ?? '…'})`], ['all', 'Tous']];
  return (
    <div className="space-y-4" data-testid="pro-cases">
      <SEO title="Dossiers suivis" noindex />
      <h1 className="text-xl font-bold text-slate-900">Dossiers suivis</h1>
      <p className="text-sm text-slate-700">Un dossier n’apparaît ici que si la personne l’a partagé avec votre structure. Un dossier attribué n’est ouvert que par la personne qui en a la charge et les responsables.</p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, t]) => <Button key={k} type="button" role="tab" aria-selected={scope === k} variant={scope === k ? 'default' : 'outline'} data-testid={`pro-cases-tab-${k}`} onClick={() => setScope(k)}>{t}</Button>)}
      </div>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {state.loading ? <p role="status">Chargement…</p> : state.cases.length ? (
        <ul className="space-y-2">
          {state.cases.map((c) => (
            <li key={c.id} data-testid="pro-case-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <span><strong>Dossier {c.dossierId.slice(0, 8)}</strong> — <span data-testid="pro-case-status">{label(CASE_STATUS_LABELS, c.status)}</span> — {c.assigneeEmail ? `suivi par ${c.assigneeEmail}` : 'non attribué'}{c.openReferrals ? ` — ${c.openReferrals} orientation(s) en cours` : ''}</span>
              <Button asChild size="sm" variant="outline"><Link to={`/pro/dossiers/${encodeURIComponent(c.id)}`} data-testid="pro-case-open">Ouvrir</Link></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-700" data-testid="pro-cases-empty">{scope === 'unassigned' ? 'Aucun dossier à attribuer.' : scope === 'mine' ? 'Aucun dossier ne vous est attribué.' : 'Aucun dossier partagé avec votre structure.'}</p>}
    </div>
  );
}

function CaseDetail({ id }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ visibility: 'INTERNAL', body: '', mentions: [] });
  const [closing, setClosing] = useState({ outcome: '', citizenSummary: '' });
  const [referral, setReferral] = useState({ q: '', receivers: [], toStructureId: '', reasonCode: '', message: '' });
  const [referrals, setReferrals] = useState([]);
  const [referralsProblem, setReferralsProblem] = useState(false);   // R18: a failed load of the sent referrals is said (it read as « none sent »)
  const [me, setMe] = useState({});
  useEffect(() => { proRdvRequest('/api/pro/me').then((out) => setMe(out?.user || {})).catch(() => setMe({})); }, []);
  const load = useCallback(async () => {
    try {
      const out = await proRdvRequest('/api/pro/cases', { query: { id } }); setData(out); setError('');
      const sent = await proRdvRequest('/api/pro/referrals', { query: { box: 'outbox' } }).then((x) => { setReferralsProblem(false); return x; }).catch(() => { setReferralsProblem(true); return { referrals: [] }; });
      setReferrals((sent.referrals || []).filter((r) => r.dossierId === out.case.dossierId));
    } catch (e) { setError(e?.status === 404 ? 'Ce dossier n’existe pas ou ne vous est pas ouvert (dossier attribué à un collègue ou partage retiré).' : msgOf(e, 'Impossible de charger le dossier.')); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const run = async (body, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/cases', { method: 'POST', body: { id, ...body } }); setMessage(ok); await load(); return true; }
    catch (e) { setProblem(msgOf(e, 'Action impossible.')); if (e?.status === 404) await load(); return false; }
    finally { setBusy(false); }
  };
  const searchReceivers = async () => {
    try { const out = await proRdvRequest('/api/pro/referrals', { query: { receivers: referral.q } }); setReferral((r) => ({ ...r, receivers: out.receivers || [] })); }
    catch (e) { setProblem(msgOf(e, 'Recherche impossible.')); }
  };
  const propose = async (e) => {
    e.preventDefault(); setBusy(true); setMessage(''); setProblem('');
    try {
      await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action: 'propose', caseId: id, toStructureId: referral.toStructureId, reasonCode: referral.reasonCode, message: referral.message, idempotencyKey: crypto.randomUUID() } });
      setMessage('Orientation proposée. Rien n’est transmis avant l’accord de la personne (elle est prévenue).'); setReferral({ q: '', receivers: [], toStructureId: '', reasonCode: '', message: '' }); await load();
    } catch (err) { setProblem(msgOf(err, 'Orientation impossible.')); } finally { setBusy(false); }
  };
  if (error) return <div className="space-y-3" data-testid="pro-case-detail"><h1 className="text-xl font-bold text-slate-900">Dossier suivi</h1><p role="alert" data-testid="pro-case-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{error}</p><Button variant="outline" onClick={() => navigate('/pro/dossiers')}>Retour aux dossiers</Button></div>;
  if (!data) return <p role="status">Chargement…</p>;
  const c = data.case; const closed = c.status === 'CLOSED';
  const mine = c.assignee && c.assignee.id === me.id;
  return (
    <div className="space-y-4" data-testid="pro-case-detail">
      <SEO title="Dossier suivi" noindex />
      <p><Link className="text-blue-800 underline" to="/pro/dossiers">← Dossiers suivis</Link></p>
      <h1 className="text-xl font-bold text-slate-900">Dossier {c.dossierId.slice(0, 8)} — <span data-testid="pro-case-detail-status">{label(CASE_STATUS_LABELS, c.status)}</span></h1>
      <div aria-live="polite" role="status" data-testid="pro-case-status-msg">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="pro-case-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <Card><CardHeader><CardTitle className="text-lg">Suivi</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p>Suivi par : <strong data-testid="pro-case-assignee">{c.assignee ? c.assignee.email : 'personne (à attribuer)'}</strong></p>
        <div className="flex flex-wrap items-end gap-2">
          {!c.assignee && !closed ? <Button type="button" size="sm" disabled={busy} data-testid="pro-case-take" onClick={() => run({ action: 'assign', userId: me.id }, 'Le dossier vous est attribué.')}>Me l’attribuer</Button> : null}
          {(data.canAssignOthers || mine) && !closed ? (
            <label className="text-sm">Attribuer à{' '}
              <select data-testid="pro-case-assign" className="rounded-md border border-slate-300 p-1" disabled={busy} value="" onChange={(e) => e.target.value && run({ action: 'assign', userId: e.target.value === '__none' ? null : e.target.value }, 'Attribution modifiée.')}>
                <option value="">Choisir…</option>
                {data.members.filter((m) => !c.assignee || m.id !== c.assignee.id).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                {data.canAssignOthers && c.assignee ? <option value="__none">Remettre dans la file</option> : null}
              </select>
            </label>
          ) : null}
          {!closed ? (
            <label className="text-sm">Statut{' '}
              <select data-testid="pro-case-status-select" className="rounded-md border border-slate-300 p-1" disabled={busy} value={c.status} onChange={(e) => run({ action: 'status', status: e.target.value }, 'Statut mis à jour.')}>
                {Object.entries(CASE_STATUS_LABELS).filter(([k]) => k !== 'CLOSED').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          ) : null}
          <Button asChild size="sm" variant="outline"><Link to={`/pro/dossier/${encodeURIComponent(c.dossierId)}`} data-testid="pro-case-dossier">Voir le dossier partagé</Link></Button>
        </div>
        {closed ? (
          <div className="space-y-1" data-testid="pro-case-closed">
            <p>Résultat : <strong>{label(OUTCOME_LABELS, c.outcome)}</strong>{c.outcomeCitizenSummary ? ` — message à la personne : « ${c.outcomeCitizenSummary} »` : ''}</p>
            <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="pro-case-reopen" onClick={() => run({ action: 'reopen' }, 'Dossier rouvert.')}>Rouvrir</Button>
          </div>
        ) : null}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-lg">Notes</CardTitle></CardHeader><CardContent className="space-y-3">
        {!closed ? (
          <form className="space-y-2" data-testid="pro-case-note-form" onSubmit={async (e) => { e.preventDefault(); if (await run({ action: 'note', ...note }, note.visibility === 'CITIZEN' ? 'Note visible par la personne ajoutée.' : 'Note interne ajoutée.')) setNote({ visibility: 'INTERNAL', body: '', mentions: [] }); }}>
            <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="sr-only">Visibilité</legend>
              <label className="flex items-center gap-1"><input type="radio" name="vis" data-testid="pro-note-internal" checked={note.visibility === 'INTERNAL'} onChange={() => setNote({ ...note, visibility: 'INTERNAL' })} />Interne à l’équipe (jamais montrée à la personne ni à une autre structure)</label>
              <label className="flex items-center gap-1"><input type="radio" name="vis" data-testid="pro-note-citizen" checked={note.visibility === 'CITIZEN'} onChange={() => setNote({ ...note, visibility: 'CITIZEN', mentions: [] })} />Visible par la personne</label>
            </fieldset>
            <label className="block text-sm">Note<textarea data-testid="pro-note-body" required minLength={2} maxLength={4000} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} /></label>
            {note.visibility === 'INTERNAL' && data.members.length > 1 ? (
              <fieldset className="text-sm"><legend>Mentionner (notification sans le contenu)</legend>
                {data.members.filter((m) => m.id !== me.id).map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={note.mentions.includes(m.id)} onChange={(e) => setNote({ ...note, mentions: e.target.checked ? [...note.mentions, m.id] : note.mentions.filter((x) => x !== m.id) })} />{m.email}</label>)}
              </fieldset>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} data-testid="pro-note-add">Ajouter la note</Button>
          </form>
        ) : null}
        {data.notes.length ? <ul className="space-y-2" data-testid="pro-case-notes">{data.notes.map((n) => (
          <li key={n.id} data-testid="pro-case-note" className={`rounded-md border p-2 text-sm ${n.visibility === 'CITIZEN' ? 'border-blue-200 bg-blue-50' : 'border-slate-200'}`}>
            <span className="text-xs font-semibold">{n.visibility === 'CITIZEN' ? 'Visible par la personne' : 'Interne'} · {when(n.at)}</span><p className="whitespace-pre-wrap">{n.body}</p></li>
        ))}</ul> : <p className="text-sm text-slate-700">Aucune note.</p>}
      </CardContent></Card>

      {!closed ? (
        <Card><CardHeader><CardTitle className="text-lg">Orienter vers une autre structure</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <p>La structure destinataire ne reçoit l’accès que si la personne l’accepte. Elle ne voit jamais vos notes internes.</p>
          <form className="space-y-2" data-testid="pro-referral-form" onSubmit={propose}>
            <div className="flex flex-wrap items-end gap-2">
              <label>Structure (vérifiées uniquement)<input data-testid="pro-referral-search" className="ml-1 rounded-md border border-slate-300 p-1" value={referral.q} onChange={(e) => setReferral({ ...referral, q: e.target.value })} /></label>
              <Button type="button" size="sm" variant="outline" onClick={searchReceivers} data-testid="pro-referral-search-btn">Rechercher</Button>
            </div>
            {referral.receivers.length ? (
              <select aria-label="Structure destinataire" data-testid="pro-referral-target" required className="w-full rounded-md border border-slate-300 p-2" value={referral.toStructureId} onChange={(e) => setReferral({ ...referral, toStructureId: e.target.value })}>
                <option value="">Choisir la structure…</option>{referral.receivers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>)}
              </select>
            ) : null}
            <select aria-label="Motif de l’orientation" data-testid="pro-referral-reason" required className="w-full rounded-md border border-slate-300 p-2" value={referral.reasonCode} onChange={(e) => setReferral({ ...referral, reasonCode: e.target.value })}>
              <option value="">Motif…</option>{Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="block">Message à la structure (la personne pourra le lire)<textarea data-testid="pro-referral-message" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={referral.message} onChange={(e) => setReferral({ ...referral, message: e.target.value })} /></label>
            <Button type="submit" size="sm" disabled={busy || !referral.toStructureId || !referral.reasonCode} data-testid="pro-referral-propose">Proposer l’orientation</Button>
          </form>
          {referralsProblem ? <p role="alert" className="text-sm text-red-800">Les orientations envoyées n’ont pas pu être chargées.</p> : null}
          {referrals.length ? <ul className="space-y-1" data-testid="pro-case-referrals">{referrals.map((r) => <li key={r.id}><Link className="text-blue-800 underline" to={`/pro/orientations/${encodeURIComponent(r.id)}`}>{r.toName}</Link> — {label(REFERRAL_STATUS_LABELS, r.status)}</li>)}</ul> : null}
        </CardContent></Card>
      ) : null}

      {!closed ? (
        <Card><CardHeader><CardTitle className="text-lg">Clôturer</CardTitle></CardHeader><CardContent>
          <form className="space-y-2 text-sm" data-testid="pro-case-close-form" onSubmit={(e) => { e.preventDefault(); run({ action: 'close', ...closing }, 'Dossier clôturé.'); }}>
            <select aria-label="Résultat de l’accompagnement" data-testid="pro-case-outcome" required className="w-full rounded-md border border-slate-300 p-2" value={closing.outcome} onChange={(e) => setClosing({ ...closing, outcome: e.target.value })}>
              <option value="">Résultat de l’accompagnement…</option>{Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="block">Message à la personne (facultatif)<textarea data-testid="pro-case-summary" maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={closing.citizenSummary} onChange={(e) => setClosing({ ...closing, citizenSummary: e.target.value })} /></label>
            <Button type="submit" size="sm" disabled={busy || !closing.outcome} data-testid="pro-case-close">Clôturer le dossier</Button>
          </form>
        </CardContent></Card>
      ) : null}

      <Card><CardHeader><CardTitle className="text-lg">Historique</CardTitle></CardHeader><CardContent>
        <ol className="space-y-1 text-sm" data-testid="pro-case-history">{data.events.map((e, i) => <li key={i}>{when(e.at)} — {label(CASE_EVENT_LABELS, e.kind)}{e.toValue ? ` → ${label(CASE_STATUS_LABELS, e.toValue) || e.toValue}` : ''}</li>)}</ol>
      </CardContent></Card>
    </div>
  );
}
