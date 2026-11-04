// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { label } from '@/lib/caseLabels';
import { useCaseLabels } from '@/lib/caseLabelsI18n';
import { useT } from '@/i18n';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { chooseMessage, fieldA11y, minLengthMessage, requiredMessage } from '@/lib/fieldErrors';

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
  const { t } = useT('pro');
  const { caseStatus: CASE_STATUS_LABELS } = useCaseLabels();
  const [scope, setScope] = useState('mine');
  const [state, setState] = useState({ loading: true, error: '', cases: [], counts: {} });
  const load = useCallback(async (s) => {
    setState((x) => ({ ...x, loading: true }));
    try { const out = await proRdvRequest('/api/pro/cases', { query: { scope: s } }); setState({ loading: false, error: '', cases: out.cases || [], counts: out.counts || {} }); }
    catch (e) { setState({ loading: false, error: msgOf(e, t('pro:cases.load_failed', 'Impossible de charger les dossiers.')), cases: [], counts: {} }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(scope); }, [scope, load]);
  const tabs = [['mine', t('pro:cases.tab_mine', 'Mes dossiers ({{n}})', { n: state.counts.mine ?? '…' })], ['unassigned', t('pro:cases.tab_unassigned', 'À attribuer ({{n}})', { n: state.counts.unassigned ?? '…' })], ['all', t('pro:cases.tab_all', 'Tous')]];
  return (
    <div className="space-y-4" data-testid="pro-cases">
      <SEO title={t('pro:cases.title', 'Dossiers suivis')} noindex />
      <h1 className="text-xl font-bold text-slate-900">{t('pro:cases.title', 'Dossiers suivis')}</h1>
      <p className="text-sm text-slate-700">{t('pro:cases.intro', 'Un dossier n’apparaît ici que si la personne l’a partagé avec votre structure. Un dossier attribué n’est ouvert que par la personne qui en a la charge et les responsables.')}</p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, lbl]) => <Button key={k} type="button" role="tab" aria-selected={scope === k} variant={scope === k ? 'default' : 'outline'} data-testid={`pro-cases-tab-${k}`} onClick={() => setScope(k)}>{lbl}</Button>)}
      </div>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {state.loading ? <p role="status">{t('pro:cases.loading', 'Chargement…')}</p> : state.cases.length ? (
        <ul className="space-y-2">
          {state.cases.map((c) => (
            <li key={c.id} data-testid="pro-case-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <span><strong>{t('pro:cases.item_title', 'Dossier {{id}}', { id: c.dossierId.slice(0, 8) })}</strong> — <span data-testid="pro-case-status">{label(CASE_STATUS_LABELS, c.status)}</span> — {c.assigneeEmail ? t('pro:cases.followed_by', 'suivi par {{email}}', { email: c.assigneeEmail }) : t('pro:cases.not_assigned', 'non attribué')}{c.openReferrals ? ` — ${t('pro:cases.open_referrals', { count: c.openReferrals, defaultValue_one: '{{count}} orientation(s) en cours', defaultValue_other: '{{count}} orientation(s) en cours' })}` : ''}</span>
              <Button asChild size="sm" variant="outline"><Link to={`/pro/dossiers/${encodeURIComponent(c.id)}`} data-testid="pro-case-open">{t('pro:cases.open', 'Ouvrir')}</Link></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-700" data-testid="pro-cases-empty">{scope === 'unassigned' ? t('pro:cases.empty_unassigned', 'Aucun dossier à attribuer.') : scope === 'mine' ? t('pro:cases.empty_mine', 'Aucun dossier ne vous est attribué.') : t('pro:cases.empty_all', 'Aucun dossier partagé avec votre structure.')}</p>}
    </div>
  );
}

function CaseDetail({ id }) {
  const { t } = useT('pro');
  const { caseStatus: CASE_STATUS_LABELS, outcome: OUTCOME_LABELS, reason: REASON_LABELS, referralStatus: REFERRAL_STATUS_LABELS, caseEvent: CASE_EVENT_LABELS } = useCaseLabels();
  const navigate = useNavigate();
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ visibility: 'INTERNAL', body: '', mentions: [] });
  const [closing, setClosing] = useState({ outcome: '', citizenSummary: '' });
  const [referral, setReferral] = useState({ q: '', receivers: [], toStructureId: '', reasonCode: '', message: '' });
  const [referrals, setReferrals] = useState([]);
  const [referralsProblem, setReferralsProblem] = useState(false);   // R18: a failed load of the sent referrals is said (it read as « none sent »)
  const [me, setMe] = useState({});
  // R43 (A5): each form has its own error summary (focused on a refused submit) and per-field messages; nothing is sent while a field is in error
  const noteErr = useFormErrors(); const referralErr = useFormErrors(); const closeErr = useFormErrors();
  useEffect(() => { proRdvRequest('/api/pro/me').then((out) => setMe(out?.user || {})).catch(() => setMe({})); }, []);
  const load = useCallback(async () => {
    try {
      const out = await proRdvRequest('/api/pro/cases', { query: { id } }); setData(out); setError('');
      const sent = await proRdvRequest('/api/pro/referrals', { query: { box: 'outbox' } }).then((x) => { setReferralsProblem(false); return x; }).catch(() => { setReferralsProblem(true); return { referrals: [] }; });
      setReferrals((sent.referrals || []).filter((r) => r.dossierId === out.case.dossierId));
    } catch (e) { setError(e?.status === 404 ? t('pro:cases.not_found', 'Ce dossier n’existe pas ou ne vous est pas ouvert (dossier attribué à un collègue ou partage retiré).') : msgOf(e, t('pro:cases.load_one_failed', 'Impossible de charger le dossier.'))); }
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const run = async (body, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/cases', { method: 'POST', body: { id, ...body } }); setMessage(ok); await load(); return true; }
    catch (e) { setProblem(msgOf(e, t('pro:cases.action_failed', 'Action impossible.'))); if (e?.status === 404) await load(); return false; }
    finally { setBusy(false); }
  };
  const searchReceivers = async () => {
    try { const out = await proRdvRequest('/api/pro/referrals', { query: { receivers: referral.q } }); setReferral((r) => ({ ...r, receivers: out.receivers || [] })); }
    catch (e) { setProblem(msgOf(e, t('pro:cases.search_failed', 'Recherche impossible.'))); }
  };
  const propose = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!referral.toStructureId) errs[referral.receivers.length ? 'case-referral-target' : 'case-referral-search'] = referral.receivers.length ? chooseMessage(t, t('pro:cases.target', 'Structure destinataire')) : t('pro:cases.target_search_first', 'Structure destinataire : recherchez une structure vérifiée, puis choisissez-la dans la liste.');
    if (!referral.reasonCode) errs['case-referral-reason'] = chooseMessage(t, t('pro:cases.reason', 'Motif de l’orientation'));
    if (!referralErr.check(errs)) return;
    setBusy(true); setMessage(''); setProblem('');
    try {
      await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action: 'propose', caseId: id, toStructureId: referral.toStructureId, reasonCode: referral.reasonCode, message: referral.message, idempotencyKey: crypto.randomUUID() } });
      setMessage(t('pro:cases.referral_proposed', 'Orientation proposée. Rien n’est transmis avant l’accord de la personne (elle est prévenue).')); setReferral({ q: '', receivers: [], toStructureId: '', reasonCode: '', message: '' }); await load();
    } catch (err) { setProblem(msgOf(err, t('pro:cases.referral_failed', 'Orientation impossible.'))); } finally { setBusy(false); }
  };
  if (error) return <div className="space-y-3" data-testid="pro-case-detail"><h1 className="text-xl font-bold text-slate-900">{t('pro:cases.detail_title', 'Dossier suivi')}</h1><p role="alert" data-testid="pro-case-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{error}</p><Button variant="outline" onClick={() => navigate('/pro/dossiers')}>{t('pro:cases.back_to_list', 'Retour aux dossiers')}</Button></div>;
  if (!data) return <p role="status">{t('pro:cases.loading', 'Chargement…')}</p>;
  const c = data.case; const closed = c.status === 'CLOSED';
  const mine = c.assignee && c.assignee.id === me.id;
  return (
    <div className="space-y-4" data-testid="pro-case-detail">
      <SEO title={t('pro:cases.detail_title', 'Dossier suivi')} noindex />
      <p><Link className="text-blue-800 underline" to="/pro/dossiers">← {t('pro:cases.title', 'Dossiers suivis')}</Link></p>
      <h1 className="text-xl font-bold text-slate-900">{t('pro:cases.item_title', 'Dossier {{id}}', { id: c.dossierId.slice(0, 8) })} — <span data-testid="pro-case-detail-status">{label(CASE_STATUS_LABELS, c.status)}</span></h1>
      <div aria-live="polite" role="status" data-testid="pro-case-status-msg">{busy ? <span className="sr-only">{t('common:form.status.saving', 'Enregistrement en cours…')}</span> : null}{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="pro-case-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <Card><CardHeader><CardTitle className="text-lg">{t('pro:cases.card_followup', 'Suivi')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p>{t('pro:cases.followed_by_label', 'Suivi par :')} <strong data-testid="pro-case-assignee">{c.assignee ? c.assignee.email : t('pro:cases.nobody_assigned', 'personne (à attribuer)')}</strong></p>
        <div className="flex flex-wrap items-end gap-2">
          {!c.assignee && !closed ? <Button type="button" size="sm" disabled={busy} data-testid="pro-case-take" onClick={() => run({ action: 'assign', userId: me.id }, t('pro:cases.assigned_to_me', 'Le dossier vous est attribué.'))}>{t('pro:cases.take', 'Me l’attribuer')}</Button> : null}
          {(data.canAssignOthers || mine) && !closed ? (
            <label className="text-sm">{t('pro:cases.assign_to', 'Attribuer à')}{' '}
              <select data-testid="pro-case-assign" className="rounded-md border border-slate-300 p-1" disabled={busy} value="" onChange={(e) => e.target.value && run({ action: 'assign', userId: e.target.value === '__none' ? null : e.target.value }, t('pro:cases.assignment_changed', 'Attribution modifiée.'))}>
                <option value="">{t('pro:cases.choose', 'Choisir…')}</option>
                {data.members.filter((m) => !c.assignee || m.id !== c.assignee.id).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                {data.canAssignOthers && c.assignee ? <option value="__none">{t('pro:cases.unassign', 'Remettre dans la file')}</option> : null}
              </select>
            </label>
          ) : null}
          {!closed ? (
            <label className="text-sm">{t('pro:cases.status', 'Statut')}{' '}
              <select data-testid="pro-case-status-select" className="rounded-md border border-slate-300 p-1" disabled={busy} value={c.status} onChange={(e) => run({ action: 'status', status: e.target.value }, t('pro:cases.status_updated', 'Statut mis à jour.'))}>
                {Object.entries(CASE_STATUS_LABELS).filter(([k]) => k !== 'CLOSED').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          ) : null}
          <Button asChild size="sm" variant="outline"><Link to={`/pro/dossier/${encodeURIComponent(c.dossierId)}`} data-testid="pro-case-dossier">{t('pro:cases.view_shared', 'Voir le dossier partagé')}</Link></Button>
        </div>
        {closed ? (
          <div className="space-y-1" data-testid="pro-case-closed">
            <p>{t('pro:cases.outcome_label', 'Résultat :')} <strong>{label(OUTCOME_LABELS, c.outcome)}</strong>{c.outcomeCitizenSummary ? ` — ${t('pro:cases.message_to_person', 'message à la personne : « {{summary}} »', { summary: c.outcomeCitizenSummary })}` : ''}</p>
            <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="pro-case-reopen" onClick={() => run({ action: 'reopen' }, t('pro:cases.reopened', 'Dossier rouvert.'))}>{t('pro:cases.reopen', 'Rouvrir')}</Button>
          </div>
        ) : null}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-lg">{t('pro:cases.card_notes', 'Notes')}</CardTitle></CardHeader><CardContent className="space-y-3">
        {!closed ? (
          <form className="space-y-2" data-testid="pro-case-note-form" noValidate aria-busy={busy || undefined} onSubmit={async (e) => { e.preventDefault(); if (!noteErr.check(note.body.trim().length >= 2 ? {} : { 'case-note-body': note.body.trim() ? minLengthMessage(t, t('pro:cases.note', 'Note'), 2) : requiredMessage(t, t('pro:cases.note', 'Note')) })) return; if (await run({ action: 'note', ...note }, note.visibility === 'CITIZEN' ? t('pro:cases.note_citizen_added', 'Note visible par la personne ajoutée.') : t('pro:cases.note_internal_added', 'Note interne ajoutée.'))) setNote({ visibility: 'INTERNAL', body: '', mentions: [] }); }}>
            <ErrorSummary ref={noteErr.summaryRef} errors={noteErr.errors} order={['case-note-body']} testid="pro-case-note-errors" />
            <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="sr-only">{t('pro:cases.visibility', 'Visibilité')}</legend>
              <label className="flex items-center gap-1"><input type="radio" name="vis" data-testid="pro-note-internal" checked={note.visibility === 'INTERNAL'} onChange={() => setNote({ ...note, visibility: 'INTERNAL' })} />{t('pro:cases.vis_internal', 'Interne à l’équipe (jamais montrée à la personne ni à une autre structure)')}</label>
              <label className="flex items-center gap-1"><input type="radio" name="vis" data-testid="pro-note-citizen" checked={note.visibility === 'CITIZEN'} onChange={() => setNote({ ...note, visibility: 'CITIZEN', mentions: [] })} />{t('pro:cases.vis_citizen', 'Visible par la personne')}</label>
            </fieldset>
            <div className="space-y-1"><label htmlFor="case-note-body" className="block text-sm">{t('pro:cases.note', 'Note')}</label><textarea id="case-note-body" data-testid="pro-note-body" aria-required="true" maxLength={4000} className="w-full rounded-md border border-slate-300 p-2" value={note.body} {...fieldA11y('case-note-body', noteErr.errors)} onChange={(e) => { setNote({ ...note, body: e.target.value }); noteErr.clear('case-note-body'); }} /><FieldError field="case-note-body" errors={noteErr.errors} /></div>
            {note.visibility === 'INTERNAL' && data.members.length > 1 ? (
              <fieldset className="text-sm"><legend>{t('pro:cases.mention', 'Mentionner (notification sans le contenu)')}</legend>
                {data.members.filter((m) => m.id !== me.id).map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={note.mentions.includes(m.id)} onChange={(e) => setNote({ ...note, mentions: e.target.checked ? [...note.mentions, m.id] : note.mentions.filter((x) => x !== m.id) })} />{m.email}</label>)}
              </fieldset>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} data-testid="pro-note-add">{t('pro:cases.add_note', 'Ajouter la note')}</Button>
          </form>
        ) : null}
        {data.notes.length ? <ul className="space-y-2" data-testid="pro-case-notes">{data.notes.map((n) => (
          <li key={n.id} data-testid="pro-case-note" className={`rounded-md border p-2 text-sm ${n.visibility === 'CITIZEN' ? 'border-blue-200 bg-blue-50' : 'border-slate-200'}`}>
            <span className="text-xs font-semibold">{n.visibility === 'CITIZEN' ? t('pro:cases.vis_citizen', 'Visible par la personne') : t('pro:cases.internal', 'Interne')} · {when(n.at)}</span><p className="whitespace-pre-wrap">{n.body}</p></li>
        ))}</ul> : <p className="text-sm text-slate-700">{t('pro:cases.no_note', 'Aucune note.')}</p>}
      </CardContent></Card>

      {!closed ? (
        <Card><CardHeader><CardTitle className="text-lg">{t('pro:cases.card_refer', 'Orienter vers une autre structure')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <p>{t('pro:cases.refer_intro', 'La structure destinataire ne reçoit l’accès que si la personne l’accepte. Elle ne voit jamais vos notes internes.')}</p>
          <form className="space-y-2" data-testid="pro-referral-form" noValidate aria-busy={busy || undefined} onSubmit={propose}>
            <ErrorSummary ref={referralErr.summaryRef} errors={referralErr.errors} order={['case-referral-search', 'case-referral-target', 'case-referral-reason']} testid="pro-referral-errors" />
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor="case-referral-search">{t('pro:cases.structure_search', 'Structure (vérifiées uniquement)')}</label><input id="case-referral-search" data-testid="pro-referral-search" className="rounded-md border border-slate-300 p-1" value={referral.q} {...fieldA11y('case-referral-search', referralErr.errors)} onChange={(e) => { setReferral({ ...referral, q: e.target.value }); referralErr.clear('case-referral-search'); }} />
              <Button type="button" size="sm" variant="outline" onClick={searchReceivers} data-testid="pro-referral-search-btn">{t('pro:cases.search', 'Rechercher')}</Button>
            </div>
            <FieldError field="case-referral-search" errors={referralErr.errors} />
            {referral.receivers.length ? (
              <select id="case-referral-target" aria-label={t('pro:cases.target', 'Structure destinataire')} data-testid="pro-referral-target" aria-required="true" className="w-full rounded-md border border-slate-300 p-2" value={referral.toStructureId} {...fieldA11y('case-referral-target', referralErr.errors)} onChange={(e) => { setReferral({ ...referral, toStructureId: e.target.value }); referralErr.clear('case-referral-target'); referralErr.clear('case-referral-search'); }}>
                <option value="">{t('pro:cases.choose_structure', 'Choisir la structure…')}</option>{referral.receivers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>)}
              </select>
            ) : null}
            <FieldError field="case-referral-target" errors={referralErr.errors} />
            <select id="case-referral-reason" aria-label={t('pro:cases.reason', 'Motif de l’orientation')} data-testid="pro-referral-reason" aria-required="true" className="w-full rounded-md border border-slate-300 p-2" value={referral.reasonCode} {...fieldA11y('case-referral-reason', referralErr.errors)} onChange={(e) => { setReferral({ ...referral, reasonCode: e.target.value }); referralErr.clear('case-referral-reason'); }}>
              <option value="">{t('pro:cases.reason_placeholder', 'Motif…')}</option>{Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <FieldError field="case-referral-reason" errors={referralErr.errors} />
            <label className="block">{t('pro:cases.message_to_structure', 'Message à la structure (la personne pourra le lire)')}<textarea data-testid="pro-referral-message" maxLength={1500} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={referral.message} onChange={(e) => setReferral({ ...referral, message: e.target.value })} /></label>
            <Button type="submit" size="sm" disabled={busy} data-testid="pro-referral-propose">{t('pro:cases.propose', 'Proposer l’orientation')}</Button>
          </form>
          {referralsProblem ? <p role="alert" className="text-sm text-red-800">{t('pro:cases.referrals_failed', 'Les orientations envoyées n’ont pas pu être chargées.')}</p> : null}
          {referrals.length ? <ul className="space-y-1" data-testid="pro-case-referrals">{referrals.map((r) => <li key={r.id}><Link className="text-blue-800 underline" to={`/pro/orientations/${encodeURIComponent(r.id)}`}>{r.toName}</Link> — {label(REFERRAL_STATUS_LABELS, r.status)}</li>)}</ul> : null}
        </CardContent></Card>
      ) : null}

      {!closed ? (
        <Card><CardHeader><CardTitle className="text-lg">{t('pro:cases.card_close', 'Clôturer')}</CardTitle></CardHeader><CardContent>
          <form className="space-y-2 text-sm" data-testid="pro-case-close-form" noValidate aria-busy={busy || undefined} onSubmit={(e) => { e.preventDefault(); if (!closeErr.check(closing.outcome ? {} : { 'case-close-outcome': chooseMessage(t, t('pro:cases.outcome', 'Résultat de l’accompagnement')) })) return; run({ action: 'close', ...closing }, t('pro:cases.closed', 'Dossier clôturé.')); }}>
            <ErrorSummary ref={closeErr.summaryRef} errors={closeErr.errors} order={['case-close-outcome']} testid="pro-case-close-errors" />
            <select id="case-close-outcome" aria-label={t('pro:cases.outcome', 'Résultat de l’accompagnement')} data-testid="pro-case-outcome" aria-required="true" className="w-full rounded-md border border-slate-300 p-2" value={closing.outcome} {...fieldA11y('case-close-outcome', closeErr.errors)} onChange={(e) => { setClosing({ ...closing, outcome: e.target.value }); closeErr.clear('case-close-outcome'); }}>
              <option value="">{t('pro:cases.outcome_placeholder', 'Résultat de l’accompagnement…')}</option>{Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <FieldError field="case-close-outcome" errors={closeErr.errors} />
            <label className="block">{t('pro:cases.summary', 'Message à la personne (facultatif)')}<textarea data-testid="pro-case-summary" maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={closing.citizenSummary} onChange={(e) => setClosing({ ...closing, citizenSummary: e.target.value })} /></label>
            <Button type="submit" size="sm" disabled={busy} data-testid="pro-case-close">{t('pro:cases.close', 'Clôturer le dossier')}</Button>
          </form>
        </CardContent></Card>
      ) : null}

      <Card><CardHeader><CardTitle className="text-lg">{t('pro:cases.card_history', 'Historique')}</CardTitle></CardHeader><CardContent>
        <ol className="space-y-1 text-sm" data-testid="pro-case-history">{data.events.map((e, i) => <li key={i}>{when(e.at)} — {label(CASE_EVENT_LABELS, e.kind)}{e.toValue ? ` → ${label(CASE_STATUS_LABELS, e.toValue) || e.toValue}` : ''}</li>)}</ol>
      </CardContent></Card>
    </div>
  );
}
