// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';

const VIEWS = [['parcours', 'PARCOURS_READ', 'Mon Parcours'], ['coffre', 'COFFRE_LIST', 'Mon Coffre (liste)'], ['rdv', 'RDV_READ', 'Prochains rendez-vous']];

/**
 * PKG-2 / C23 — what a delegate sees (/compte/delegations/:id): read-only, only the parts the person granted, never notes nor document contents. The server re-checks
 * the delegation (active, not expired, scope) on every view and logs it for the person.
 */
export default function CompteDelegationVue() {
  const { t } = useT('compte');
  const { coffreCategory: COFFRE_CATEGORY_LABELS, delegationScope: DELEGATION_SCOPE_LABELS, parcoursStatus: PARCOURS_STATUS_LABELS, formatBytes } = useMonEspaceLabels();
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, error: '', delegation: null, parts: {}, actionsOpen: false });
  // G14-AID: the trusted person may ASK for one action; the person confirms it (or allowed « agir pour moi » for that part)
  const [mine, setMine] = useState([]); const [note, setNote] = useState(''); const [problem, setProblem] = useState(''); const [choice, setChoice] = useState({});
  const loadMine = useCallback(async () => { try { setMine((await citizenApi.delegateRequests(id)).requests || []); } catch { setMine([]); } }, [id]);
  const ask = async (input) => {
    setNote(''); setProblem('');
    try {
      const out = await citizenApi.requestDelegateAction({ id, ...input });
      setNote(out.executed ? t('compte:delegation_view.ask_done', 'C’est fait : la personne vous a autorisé à agir sans lui demander. Elle le voit dans son historique.')
        : t('compte:delegation_view.ask_sent', 'Demande envoyée : rien n’est fait tant que la personne ne l’a pas acceptée (48 heures au plus).'));
      await loadMine();
    } catch (err) { setProblem(err.message); }
  };
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { received, offeredScopes, actions } = await citizenApi.listDelegations();
        const offered = (scope) => !Array.isArray(offeredScopes) || offeredScopes.includes(scope);   // A-18: a part closed on this service is not asked for (the server answers 404)
        const d = (received || []).find((x) => x.id === id);
        if (!d || d.status !== 'ACTIVE') throw Object.assign(new Error(t('compte:delegation_view.inactive', 'Cet accès n’est pas (ou plus) actif.')), { status: 404 });
        const parts = {};
        for (const [view, scope] of VIEWS) if (d.scopes.includes(scope) && offered(scope)) parts[view] = await citizenApi.delegateView(id, view);
        if (live) setState({ loading: false, error: '', delegation: d, parts, actionsOpen: actions?.open === true });
        if (live && actions?.open === true) await loadMine();
      } catch (err) { if (live) setState({ loading: false, error: err.status === 401 ? t('compte:delegation_view.login_required', 'Connectez-vous pour consulter cet accès.') : err.message, delegation: null, parts: {} }); }
    })();
    return () => { live = false; };
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once per delegation; the messages follow the language at load time
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:delegation_view.chargement', 'Chargement…')}</div>;
  const { delegation: d, parts } = state;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="delegation-view">
      <SEO title={t('compte:delegation_view.acces_lecture_seule', 'Accès en lecture seule')} noindex />
      <p><Link className="text-blue-800 underline" to="/compte/delegations">{t('compte:delegation_view.personnes_confiance', '← Personnes de confiance')}</Link></p>
      {state.error ? <><h1 className="text-2xl font-bold text-slate-900">{t('compte:delegation_view.acces_lecture_seule', 'Accès en lecture seule')}</h1><p role="alert" data-testid="delegation-view-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p></> : (
        <>
          <h1 className="text-2xl font-bold text-slate-900">{t('compte:delegation_view.space_of', 'Espace de {{email}}', { email: d.principalEmail })}</h1>
          <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="delegation-readonly-banner">{t('compte:delegation_view.readonly_until', 'Lecture seule, jusqu’au {{date}}. Vous ne pouvez rien modifier. La personne voit ce que vous consultez et peut arrêter cet accès à tout moment.', { date: formatDate(d.expiresAt) })}</p>
          {state.actionsOpen ? <p className="text-sm text-slate-800" data-testid="delegation-ask-intro">{t('compte:delegation_view.ask_intro', 'Vous pouvez demander une action (annuler un rendez-vous, changer l’état d’une étape). La personne doit l’accepter, sauf si elle vous a autorisé à agir sans lui demander.')}</p> : null}
          {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900" data-testid="delegation-ask-problem">{problem}</p> : null}
          <div aria-live="polite" role="status">{note ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" data-testid="delegation-ask-note">{note}</p> : null}</div>
          {parts.parcours ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.PARCOURS_READ}</CardTitle></CardHeader><CardContent>
              {parts.parcours.items.length ? <ul className="space-y-2 text-sm" data-testid="delegate-parcours">{parts.parcours.items.map((i) => (
                <li key={i.id} data-testid="delegate-parcours-item">{i.title} — {PARCOURS_STATUS_LABELS[i.status] || i.status}{i.dueDate ? ` — ${t('compte:parcours.due_on', 'échéance le {{date}}', { date: formatDate(i.dueDate) })}` : ''}
                  {state.actionsOpen ? (
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <label htmlFor={`ask-status-${i.id}`} className="sr-only">{t('compte:delegation_view.new_status', 'Nouvel état')}</label>
                      <select id={`ask-status-${i.id}`} className="rounded-md border border-slate-300 p-1" value={choice[i.id] || ''} onChange={(e) => setChoice((c) => ({ ...c, [i.id]: e.target.value }))} data-testid="delegate-ask-status">
                        <option value="">{t('compte:delegation_view.choose_status', 'Choisir un état…')}</option>
                        {Object.entries(PARCOURS_STATUS_LABELS).filter(([k]) => k !== i.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <Button type="button" size="sm" variant="outline" disabled={!choice[i.id]} onClick={() => ask({ type: 'PARCOURS_STATUS', itemId: i.id, status: choice[i.id] })} data-testid="delegate-ask-status-send">{t('compte:delegation_view.ask_status', 'Demander ce changement')}</Button>
                    </span>
                  ) : null}
                </li>
              ))}</ul>
                : <p className="text-sm text-slate-700">{t('compte:delegation_view.aucune_etape', 'Aucune étape.')}</p>}
              {/* G8: the server never sends a sensitive step to a delegate (api/_services/delegation.js) — said, without saying whether there is one */}
              <p className="mt-2 text-xs text-slate-700" data-testid="delegate-parcours-sensitive">{t('compte:delegation_view.sensitive_hidden', 'Les étapes qui concernent la santé ou une autre information sensible ne sont jamais montrées ici.')}</p>
            </CardContent></Card>
          ) : null}
          {parts.coffre ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.COFFRE_LIST}</CardTitle></CardHeader><CardContent>
              {parts.coffre.documents.length ? <ul className="space-y-1 text-sm" data-testid="delegate-coffre">{parts.coffre.documents.map((c, i) => <li key={i} data-testid="delegate-coffre-item">{c.name} ({COFFRE_CATEGORY_LABELS[c.category]}) — {formatBytes(c.byteLength)}</li>)}</ul>
                : <p className="text-sm text-slate-700">{t('compte:delegation_view.aucun_document', 'Aucun document.')}</p>}
            </CardContent></Card>
          ) : null}
          {parts.rdv ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.RDV_READ}</CardTitle></CardHeader><CardContent>
              {parts.rdv.appointments.length ? <ul className="space-y-2 text-sm" data-testid="delegate-rdv">{parts.rdv.appointments.map((a, i) => (
                <li key={a.id || i} className="flex flex-wrap items-center justify-between gap-2">{formatDate(a.startAt, { dateStyle: 'short', timeStyle: 'medium' })} — {a.structure}
                  {state.actionsOpen && a.id ? <Button type="button" size="sm" variant="outline" onClick={() => ask({ type: 'RDV_CANCEL', appointmentId: a.id })} data-testid="delegate-ask-cancel">{t('compte:delegation_view.ask_cancel', 'Demander l’annulation')}</Button> : null}
                </li>
              ))}</ul>
                : <p className="text-sm text-slate-700" data-testid="delegate-rdv-empty">{t('compte:delegation_view.aucun_rendez_vous_venir', 'Aucun rendez-vous à venir.')}</p>}
            </CardContent></Card>
          ) : null}
          {state.actionsOpen ? (
            <Card><CardHeader><CardTitle className="text-lg">{t('compte:delegation_view.my_requests', 'Mes demandes')}</CardTitle></CardHeader><CardContent>
              {mine.length ? <ul className="space-y-1 text-sm" data-testid="delegate-requests">{mine.map((r, i) => (
                <li key={i} data-testid="delegate-request">{formatDate(r.at, { dateStyle: 'short', timeStyle: 'short' })} — {r.type === 'RDV_CANCEL' ? t('compte:delegation_view.req_cancel', 'Annulation d’un rendez-vous') : t('compte:delegation_view.req_status', 'Changement d’état d’une étape')} — {
                  { PENDING: t('compte:delegation_view.state_pending', 'en attente de la personne'), DONE: t('compte:delegation_view.state_done', 'fait'), REFUSED: t('compte:delegation_view.state_refused', 'non fait'), EXPIRED: t('compte:delegation_view.state_expired', 'expirée') }[r.state] || r.state}</li>
              ))}</ul> : <p className="text-sm text-slate-700">{t('compte:delegation_view.no_request', 'Aucune demande.')}</p>}
            </CardContent></Card>
          ) : null}
        </>
      )}
    </div>
  );
}
