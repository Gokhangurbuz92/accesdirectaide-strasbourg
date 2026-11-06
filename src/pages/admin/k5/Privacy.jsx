// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useK5, explain } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT, DATE_SHORT, formatDate, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * PKG-5 / A12 — privacy console (/admin/privacy). Access requests with organization-held notes (two people: one proposes, another confirms), legal holds
 * (placing one protects at once; releasing needs two people), assisted ownership recovery (two people), retention rules with the conflicts that need a legal
 * decision. Every action is journalised; this page never shows dossier content except the notes under review, read on purpose and journalised.
 */
/** launch-readiness item 63: the one-month deadline of GDPR art. 12(3), red once passed */
function DsrDue({ r }) {
  const { t } = useT('admin');
  if (!r?.dueAt) return null;
  const date = formatDate(r.dueAt, { day: 'numeric', month: 'long', year: 'numeric' });
  return r.overdue
    ? <p className="font-semibold text-red-800" data-testid="dsr-overdue">{t('admin:k5.privacy.overdue', 'Délai dépassé : la réponse était due le {{date}}.', { date })}</p>
    : <p className={r.daysLeft <= 7 ? 'font-semibold text-amber-900' : 'text-slate-700'} data-testid="dsr-due">{t('admin:k5.privacy.due', 'Réponse due au plus tard le {{date}} ({{days}} j).', { date, days: r.daysLeft })}</p>;
}

export default function AdminPrivacy() {
  const { t } = useT('admin');
  // R47: the retention categories and their conditions are French legal wording the DPO must validate: never translated, marked lang="fr" and said so
  const fr = useFrAttrs();
  const k = useK5('privacy');
  const [f, setF] = useState({}); const v = (key) => f[key] || ''; const set = (key, val) => setF((x) => ({ ...x, [key]: val }));
  const [notes, setNotes] = useState({}); const [extracts, setExtracts] = useState({}); const [bases, setBases] = useState({}); const [problem, setProblem] = useState('');
  const d = k.data;
  const [erasure, setErasure] = useState({});
  const [closure, setClosure] = useState({});
  const [restrictions, setRestrictions] = useState(null);
  const loadRestrictions = async () => { setProblem(''); try { setRestrictions((await apiClient.admin.k5('processing-restrictions')).restrictions || []); } catch (e) { setProblem(explain(e)); } };
  const liftRestriction = async (id) => { const r = await k.act({ id, reason: v(`lift-${id}`) }, (out) => (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.notice) ? t('admin:k5.privacy.lifted_notified', 'Limitation levée : le message à la personne a été remis au service d’envoi.') : t('admin:k5.privacy.lifted_not_notified', 'Limitation levée, mais la personne n’a pas pu être prévenue par e-mail : prévenez-la par un autre moyen.')), 'processing-restrictions'); if (r) await loadRestrictions(); };
  const readClosure = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`org-closure?id=${encodeURIComponent(id)}`); setClosure((x) => ({ ...x, [id]: r.summary })); } catch (e) { setProblem(explain(e)); } };
  const readErasure = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`dsr-erasure?id=${encodeURIComponent(id)}`); setErasure((x) => ({ ...x, [id]: r.summary })); } catch (e) { setProblem(explain(e)); } };
  const readNotes = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`dsr-review?id=${encodeURIComponent(id)}`); setNotes((x) => ({ ...x, [id]: r.notes || [] })); setExtracts((x) => ({ ...x, [id]: r.proposalExtract ?? null })); setBases((x) => ({ ...x, [id]: r.proposal?.basis || '' })); } catch (e) { setProblem(explain(e)); } };
  return (
    <div className="space-y-6 p-4" data-testid="admin-privacy">
      <h1 className="text-2xl font-bold">{t('admin:k5.privacy.title', 'Console de protection des données')}</h1>
      <Status msg={k.msg} problem={problem || k.problem || k.error} id="admin-privacy" />
      {k.loading ? <p role="status">{t('admin:k5.privacy.loading', 'Chargement…')}</p> : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-dsr">
        <h2 id="pv-dsr" className="font-semibold">{t('admin:k5.privacy.dsr_heading', 'Demandes d’accès à examiner')}</h2>
        {(d?.accessRequests?.requests || []).length === 0 ? <p className="text-sm">{t('admin:k5.privacy.no_request', 'Aucune demande en cours.')}</p> : null}
        <ul className="space-y-2">
          {(d?.accessRequests?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-dsr">
              <DsrDue r={r} />
              <p>{t('admin:k5.privacy.request_of', 'Demande du {{date}} — {{stage}}', { date: formatDate(r.createdAt, DATE_SHORT), stage: r.stage === 'AWAITING_SECOND_REVIEWER' ? t('admin:k5.privacy.proposed_waiting', 'proposition ({{proposed}}) en attente d’une deuxième personne', { proposed: r.proposed }) : t('admin:k5.privacy.to_examine', 'à examiner') })}</p>
              <Button size="sm" variant="outline" onClick={() => readNotes(r.id)}>{t('admin:k5.privacy.read_notes', 'Lire les notes concernées (journalisé)')}</Button>
              {notes[r.id] ? <ul className="list-disc pl-5">{notes[r.id].map((n, i) => <li key={i}>{n.body}</li>)}</ul> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`basis-${r.id}`} label={t('admin:k5.privacy.basis', 'Fondement de la décision')} value={v(`basis-${r.id}`)} onChange={(x) => set(`basis-${r.id}`, x)} rows={2} />
                  <Field id={`extract-${r.id}`} label={t('admin:k5.privacy.extract', 'Extrait à communiquer (si communication)')} value={v(`extract-${r.id}`)} onChange={(x) => set(`extract-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'RELEASE', basis: v(`basis-${r.id}`), extract: v(`extract-${r.id}`) }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'dsr-review')}>{t('admin:k5.privacy.propose_release', 'Proposer de communiquer')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'WITHHOLD', basis: v(`basis-${r.id}`) }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'dsr-review')}>{t('admin:k5.privacy.propose_withhold', 'Proposer de ne pas communiquer')}</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p data-testid="admin-dsr-proposal">{t('admin:k5.privacy.proposed_by', 'Proposé par {{by}} le {{date}}', { by: r.proposedBy, date: r.proposedAt ? formatDateTime(r.proposedAt) : '—' })}{bases[r.id] ? t('admin:k5.privacy.basis_suffix', ' — fondement : {{basis}}', { basis: bases[r.id] }) : ''}</p>
                  {notes[r.id] ? <p className="whitespace-pre-wrap rounded bg-slate-50 p-2" data-testid="admin-dsr-extract">{extracts[r.id] != null ? t('admin:k5.privacy.extract_proposed', 'Extrait proposé : {{extract}}', { extract: extracts[r.id] || '—' }) : t('admin:k5.privacy.no_extract', 'Aucun extrait : la proposition est de ne pas communiquer.')}</p> : <p className="text-sm" data-testid="admin-dsr-read-first">{t('admin:k5.privacy.read_first', 'Lisez les notes (journalisé) pour voir l’extrait proposé : « Confirmer » s’active après votre lecture.')}</p>}
                  <Field id={`confirm-${r.id}`} label={t('admin:k5.privacy.second_note', 'Note de la deuxième personne')} value={v(`confirm-${r.id}`)} onChange={(x) => set(`confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    {/* the server confirms only after the confirming person's own journalised reading (409 read_required): the button says so instead of failing */}
                    <Button size="sm" disabled={k.busy || !notes[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`confirm-${r.id}`) }, t('admin:k5.privacy.confirmed', 'Décision confirmée.'), 'dsr-review')}>{t('admin:k5.privacy.confirm', 'Confirmer')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`confirm-${r.id}`) }, t('admin:k5.privacy.sent_back', 'Proposition renvoyée.'), 'dsr-review')}>{t('admin:k5.privacy.send_back', 'Renvoyer')}</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-erase">
        <h2 id="pv-erase" className="font-semibold">{t('admin:k5.privacy.erase_heading', 'Demandes d’effacement de compte')}</h2>
        <p className="text-sm text-slate-700">{t('admin:k5.privacy.erase_intro', 'Deux personnes : l’une propose (exécuter ou refuser, avec la raison qui sera communiquée), une autre confirme. La confirmation d’une exécution supprime les données aussitôt ; une conservation légale active la bloque.')}</p>
        {(d?.erasureRequests?.requests || []).length === 0 ? <p className="text-sm">{t('admin:k5.privacy.no_request', 'Aucune demande en cours.')}</p> : null}
        <ul className="space-y-2">
          {(d?.erasureRequests?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-erasure" data-request={r.id}>
              <DsrDue r={r} />
              <p>{t('admin:k5.privacy.request_of', 'Demande du {{date}} — {{stage}}', { date: formatDate(r.createdAt, DATE_SHORT), stage: r.stage === 'BLOCKED_BY_LEGAL_HOLD' ? t('admin:k5.privacy.blocked', 'bloquée par une conservation légale') : r.stage === 'EXECUTION_FAILED_RETRYABLE' ? t('admin:k5.privacy.failed', 'exécution échouée (rien n’a été effacé) : à relancer') : r.stage === 'AWAITING_SECOND_REVIEWER' ? t('admin:k5.privacy.proposed_waiting', 'proposition ({{proposed}}) en attente d’une deuxième personne', { proposed: r.proposed === 'APPROVE' ? t('admin:k5.privacy.execute', 'exécuter') : t('admin:k5.privacy.refuse', 'refuser') }) : t('admin:k5.privacy.to_examine', 'à examiner') })}</p>
              <Button size="sm" variant="outline" onClick={() => readErasure(r.id)}>{t('admin:k5.privacy.see_erasure', 'Voir ce qui serait supprimé (journalisé)')}</Button>
              {erasure[r.id] ? <p data-testid="admin-erasure-summary">{t('admin:k5.privacy.erasure_summary', 'Compte : {{account}} — dossiers : {{dossiers}} — rendez-vous : {{appointments}} — conservations légales actives : {{holds}}', { account: erasure[r.id].accountExists ? t('admin:k5.privacy.present', 'présent') : t('admin:k5.privacy.absent', 'absent'), dossiers: erasure[r.id].dossiers, appointments: erasure[r.id].appointments, holds: erasure[r.id].activeLegalHolds })}</p> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`erase-reason-${r.id}`} label={t('admin:k5.privacy.refusal_reason', 'Raison du refus (si refus)')} value={v(`erase-reason-${r.id}`)} onChange={(x) => set(`erase-reason-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'APPROVE' }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'dsr-erasure')}>{t('admin:k5.privacy.propose_execute', 'Proposer d’exécuter')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'REJECT', reason: v(`erase-reason-${r.id}`) }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'dsr-erasure')}>{t('admin:k5.privacy.propose_refuse', 'Proposer de refuser')}</Button>
                  </div>
                </div>
              ) : r.stage === 'AWAITING_SECOND_REVIEWER' ? (
                <div className="space-y-1">
                  <p data-testid="admin-erasure-proposal">{t('admin:k5.privacy.proposed_by', 'Proposé par {{by}} le {{date}}', { by: r.proposedBy, date: r.proposedAt ? formatDateTime(r.proposedAt) : '—' })}{r.reason ? t('admin:k5.privacy.reason_suffix', ' — raison : {{reason}}', { reason: r.reason }) : ''}</p>
                  {erasure[r.id] ? null : <p className="text-sm" data-testid="admin-erasure-read-first">{t('admin:k5.privacy.erasure_read_first', 'Ouvrez « Voir ce qui serait supprimé » (journalisé) : « Confirmer » s’active après votre lecture.')}</p>}
                  <Field id={`erase-confirm-${r.id}`} label={t('admin:k5.privacy.second_note', 'Note de la deuxième personne')} value={v(`erase-confirm-${r.id}`)} onChange={(x) => set(`erase-confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy || !erasure[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`erase-confirm-${r.id}`) }, t('admin:k5.privacy.confirmed', 'Décision confirmée.'), 'dsr-erasure')}>{t('admin:k5.privacy.confirm', 'Confirmer')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`erase-confirm-${r.id}`) }, t('admin:k5.privacy.sent_back', 'Proposition renvoyée.'), 'dsr-erasure')}>{t('admin:k5.privacy.send_back', 'Renvoyer')}</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'retry' }, (out) => (out?.request?.status === 'COMPLETED' ? t('admin:k5.privacy.erased', 'Effacement exécuté.') : out?.request?.status === 'BLOCKED' ? t('admin:k5.privacy.still_blocked', 'Toujours bloquée : voir la raison.') : t('admin:k5.privacy.retried', 'Exécution relancée.')), 'dsr-erasure')}>{r.stage === 'EXECUTION_FAILED_RETRYABLE' ? t('admin:k5.privacy.retry_erasure', 'Relancer l’effacement') : t('admin:k5.privacy.retry_after_hold', 'Relancer après la levée de la conservation')}</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-restrict" data-testid="admin-privacy-restrictions">
        <h2 id="pv-restrict" className="font-semibold">{t('admin:k5.privacy.restrict_heading', 'Limitations du traitement (RGPD, article 18)')}</h2>
        <p className="text-sm text-slate-700">{t('admin:k5.privacy.restrict_intro', 'Une limitation s’applique dès la demande de la personne : aucune structure n’ouvre ses dossiers, rien n’est partagé ni purgé, aucune notification. La lever demande une raison, communiquée à la personne avant la levée.')}</p>
        <Button size="sm" variant="outline" onClick={loadRestrictions}>{t('admin:k5.privacy.show_restrictions', 'Afficher les limitations en cours (journalisé)')}</Button>
        {restrictions && restrictions.length === 0 ? <p className="text-sm">{t('admin:k5.privacy.no_restriction', 'Aucune limitation en cours.')}</p> : null}
        {restrictions && restrictions.length ? (
          <ul className="space-y-2">
            {restrictions.map((r) => (
              <li key={r.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-restriction" data-request={r.id}>
                <p>{t('admin:k5.privacy.restriction_line', '{{account}} — depuis le {{date}} — raison : {{ground}}', { account: r.account || t('admin:k5.privacy.account', 'compte'), date: formatDate(r.since, DATE_SHORT), ground: r.ground })}</p>
                <Field id={`lift-${r.id}`} label={t('admin:k5.privacy.lift_reason', 'Raison de la levée (communiquée à la personne)')} value={v(`lift-${r.id}`)} onChange={(x) => set(`lift-${r.id}`, x)} rows={2} />
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => liftRestriction(r.id)}>{t('admin:k5.privacy.lift', 'Lever la limitation')}</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-close">
        <h2 id="pv-close" className="font-semibold">{t('admin:k5.privacy.closure_heading', 'Fermetures d’espaces de structure')}</h2>
        <p className="text-sm text-slate-700">{t('admin:k5.privacy.closure_intro', 'Deux personnes : l’une propose (exécuter ou refuser, avec la raison communiquée à la structure), une autre confirme. L’exécution retire les accès aux dossiers (les personnes gardent leurs dossiers), efface les notes internes, les notifications et les comptes des membres, clôt les suivis et les orientations en cours et annule les rendez-vous à venir en prévenant les personnes. Une conservation légale active sur la structure la bloque.')}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field id="close-sid" label={t('admin:k5.privacy.close_sid', 'Structure concernée (référence ; fermeture à l’initiative d’ADA)')} value={v('closeSid')} onChange={(x) => set('closeSid', x)} />
          <Field id="close-why" label={t('admin:k5.privacy.close_why', 'Raison de la fermeture décidée par ADA')} value={v('closeWhy')} onChange={(x) => set('closeWhy', x)} />
          <div className="flex items-end"><Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'open', structureId: v('closeSid'), reason: v('closeWhy') }, t('admin:k5.privacy.closure_opened', 'Demande de fermeture ouverte : deux personnes doivent l’examiner.'), 'org-closure')}>{t('admin:k5.privacy.open_request', 'Ouvrir une demande')}</Button></div>
        </div>
        {(d?.organizationClosures?.requests || []).length === 0 ? <p className="text-sm">{t('admin:k5.privacy.no_request', 'Aucune demande en cours.')}</p> : null}
        <ul className="space-y-2">
          {(d?.organizationClosures?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-closure" data-request={r.id}>
              <p>{r.structureNom} — {r.origin === 'ADA' ? t('admin:k5.privacy.closure_by_ada', 'demande d’ADA du {{date}}', { date: formatDate(r.createdAt, DATE_SHORT) }) : t('admin:k5.privacy.closure_by_structure', 'demande de la structure du {{date}}', { date: formatDate(r.createdAt, DATE_SHORT) })}{r.requestReason ? ` (« ${r.requestReason} »)` : ''} — {r.stage === 'BLOCKED_BY_LEGAL_HOLD' ? t('admin:k5.privacy.blocked', 'bloquée par une conservation légale') : r.stage === 'AWAITING_SECOND_REVIEWER' ? t('admin:k5.privacy.proposed_waiting', 'proposition ({{proposed}}) en attente d’une deuxième personne', { proposed: r.proposed === 'APPROVE' ? t('admin:k5.privacy.execute', 'exécuter') : t('admin:k5.privacy.refuse', 'refuser') }) : t('admin:k5.privacy.to_examine', 'à examiner')}</p>
              <Button size="sm" variant="outline" onClick={() => readClosure(r.id)}>{t('admin:k5.privacy.see_closure', 'Voir ce que la fermeture toucherait (journalisé)')}</Button>
              {closure[r.id] ? <p data-testid="admin-closure-summary">{t('admin:k5.privacy.closure_summary', 'Membres : {{members}} — accès aux dossiers : {{accesses}} — suivis ouverts : {{cases}} — notes internes : {{notes}} — orientations en cours : {{referrals}} — rendez-vous à venir : {{appointments}} — conservations légales actives : {{holds}}', { members: closure[r.id].members, accesses: closure[r.id].activeDossierAccesses, cases: closure[r.id].openCases, notes: closure[r.id].internalNotes, referrals: closure[r.id].liveReferrals, appointments: closure[r.id].futureAppointments, holds: closure[r.id].activeLegalHolds })}</p> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`close-reason-${r.id}`} label={t('admin:k5.privacy.refusal_reason', 'Raison du refus (si refus)')} value={v(`close-reason-${r.id}`)} onChange={(x) => set(`close-reason-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'APPROVE' }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'org-closure')}>{t('admin:k5.privacy.propose_close', 'Proposer de fermer')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'REJECT', reason: v(`close-reason-${r.id}`) }, t('admin:k5.privacy.proposal_saved', 'Proposition enregistrée : une autre personne doit confirmer.'), 'org-closure')}>{t('admin:k5.privacy.propose_refuse', 'Proposer de refuser')}</Button>
                  </div>
                </div>
              ) : r.stage === 'AWAITING_SECOND_REVIEWER' ? (
                <div className="space-y-1">
                  <p data-testid="admin-closure-proposal">{t('admin:k5.privacy.proposed_by', 'Proposé par {{by}} le {{date}}', { by: r.proposedBy, date: r.proposedAt ? formatDateTime(r.proposedAt) : '—' })}{r.reason ? t('admin:k5.privacy.reason_suffix', ' — raison : {{reason}}', { reason: r.reason }) : ''}</p>
                  {closure[r.id] ? null : <p className="text-sm" data-testid="admin-closure-read-first">{t('admin:k5.privacy.closure_read_first', 'Ouvrez « Voir ce que la fermeture toucherait » (journalisé) : « Confirmer » s’active après votre lecture.')}</p>}
                  <Field id={`close-confirm-${r.id}`} label={t('admin:k5.privacy.second_note', 'Note de la deuxième personne')} value={v(`close-confirm-${r.id}`)} onChange={(x) => set(`close-confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy || !closure[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`close-confirm-${r.id}`) }, t('admin:k5.privacy.confirmed', 'Décision confirmée.'), 'org-closure')}>{t('admin:k5.privacy.confirm', 'Confirmer')}</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`close-confirm-${r.id}`) }, t('admin:k5.privacy.sent_back', 'Proposition renvoyée.'), 'org-closure')}>{t('admin:k5.privacy.send_back', 'Renvoyer')}</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'retry' }, t('admin:k5.privacy.retried', 'Exécution relancée.'), 'org-closure')}>{t('admin:k5.privacy.retry_after_hold', 'Relancer après la levée de la conservation')}</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-hold">
        <h2 id="pv-hold" className="font-semibold">{t('admin:k5.privacy.holds_heading', 'Conservations légales')}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1"><label htmlFor="hold-cat" className="block text-sm">{t('admin:k5.privacy.category', 'Catégorie')}</label>
            <select id="hold-cat" className="w-full rounded border p-2" value={v('holdCat') || 'SharedDiagnostic'} onChange={(e) => set('holdCat', e.target.value)}>
              <option value="SharedDiagnostic">{t('admin:k5.privacy.cat.shared', 'Dossier partagé')}</option><option value="CitizenUser">{t('admin:k5.privacy.cat.account', 'Compte')}</option><option value="ProCase">{t('admin:k5.privacy.cat.case', 'Suivi de structure')}</option><option value="Structure">{t('admin:k5.privacy.cat.structure', 'Structure (organisation)')}</option>
            </select></div>
          <Field id="hold-id" label={t('admin:k5.privacy.id', 'Identifiant')} value={v('holdId')} onChange={(x) => set('holdId', x)} />
          <Field id="hold-reason" label={t('admin:k5.privacy.ground', 'Fondement')} value={v('holdReason')} onChange={(x) => set('holdReason', x)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'hold_place', dataCategory: v('holdCat') || 'SharedDiagnostic', recordId: v('holdId'), reasonCode: v('holdReason') }, t('admin:k5.privacy.hold_placed', 'Conservation posée.'))}>{t('admin:k5.privacy.place_hold', 'Poser une conservation')}</Button>
        <ul className="space-y-2">
          {(d?.legalHolds || []).map((h) => (
            <li key={h.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-hold">
              <p>{h.dataCategory} {h.recordId} — {h.reasonCode} — {t('admin:k5.privacy.placed_by', 'posée par {{by}}', { by: h.createdBy })}</p>
              {h.releaseProposedBy ? (
                <><p>{t('admin:k5.privacy.release_proposed_by', 'Levée proposée par {{by}} : {{reason}}', { by: h.releaseProposedBy, reason: h.releaseReason })}</p>
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'hold_confirm_release', id: h.id, proposedAt: h.releaseProposedAt }, t('admin:k5.privacy.hold_released', 'Conservation levée.'))}>{t('admin:k5.privacy.confirm_release', 'Confirmer la levée (autre personne)')}</Button></>
              ) : (
                <><Field id={`rel-${h.id}`} label={t('admin:k5.privacy.release_reason', 'Motif de la levée')} value={v(`rel-${h.id}`)} onChange={(x) => set(`rel-${h.id}`, x)} />
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'hold_propose_release', id: h.id, reason: v(`rel-${h.id}`) }, t('admin:k5.privacy.release_proposed', 'Levée proposée : une autre personne doit confirmer.'))}>{t('admin:k5.privacy.propose_release_hold', 'Proposer la levée')}</Button></>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-rec">
        <h2 id="pv-rec" className="font-semibold">{t('admin:k5.privacy.recovery_heading', 'Récupération assistée d’un compte')}</h2>
        <p className="text-sm text-slate-700">{t('admin:k5.privacy.recovery_intro', 'Pour une personne qui n’a plus accès à son adresse e-mail, après vérification de son identité en personne. Une deuxième personne décide. Le compte prend la nouvelle adresse, l’ancien mot de passe ne fonctionne plus, et la personne choisit un mot de passe avec « mot de passe oublié ».')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="rec-cur" label={t('admin:k5.privacy.rec_cur', 'Adresse actuelle du compte')} value={v('recCur')} onChange={(x) => set('recCur', x)} />
          <Field id="rec-new" label={t('admin:k5.privacy.rec_new', 'Nouvelle adresse')} value={v('recNew')} onChange={(x) => set('recNew', x)} />
        </div>
        <Field id="rec-ev" label={t('admin:k5.privacy.rec_ev', 'Vérification d’identité faite (sans copier de pièce)')} value={v('recEv')} onChange={(x) => set('recEv', x)} rows={2} />
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'recovery_propose', currentEmail: v('recCur'), newEmail: v('recNew'), evidenceNote: v('recEv') }, t('admin:k5.privacy.rec_proposed', 'Demande enregistrée : une autre personne doit décider.'))}>{t('admin:k5.privacy.propose', 'Proposer')}</Button>
        <ul className="space-y-2">
          {(d?.recoveryCases || []).map((c) => (
            <li key={c.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-recovery">
              <p>{t('admin:k5.privacy.rec_proposed_by', 'Proposée par {{by}} le {{date}}', { by: c.proposedBy, date: formatDate(c.proposedAt, DATE_SHORT) })} — {c.evidenceNote}</p>
              <Field id={`dec-${c.id}`} label={t('admin:k5.privacy.decision_reason', 'Motif de la décision')} value={v(`dec-${c.id}`)} onChange={(x) => set(`dec-${c.id}`, x)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'recovery_decide', id: c.id, decision: 'APPROVE', note: v(`dec-${c.id}`) }, t('admin:k5.privacy.rec_approved', 'Récupération approuvée.'))}>{t('admin:k5.privacy.approve', 'Approuver')}</Button>
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'recovery_decide', id: c.id, decision: 'REJECT', note: v(`dec-${c.id}`) }, t('admin:k5.privacy.rec_refused', 'Demande refusée.'))}>{t('admin:k5.privacy.refuse_btn', 'Refuser')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-ret">
        <h2 id="pv-ret" className="font-semibold">{t('admin:k5.privacy.retention_heading', 'Durées de conservation')}</h2>
        <ul className="list-disc pl-5 text-sm">
          {Object.entries(d?.retention?.registry || {}).map(([key, r]) => <li key={key}>{key} : {r.durationDays ? t('admin:k5.privacy.days', '{{n}} jours', { n: r.durationDays }) : t('admin:k5.privacy.to_decide', 'à décider')} — {r.action}</li>)}
        </ul>
        {(d?.retention?.conflicts || []).length ? <h3 className="font-semibold">{t('admin:k5.privacy.to_settle', 'À trancher (décision juridique)')}</h3> : null}
        <ul className="list-disc pl-5 text-sm" data-testid="admin-privacy-conflicts">
          {(d?.retention?.conflicts || []).map((c) => <li key={c.data}>{t('admin:k5.privacy.conflict', '{{data}} : registre « {{registry}} » mais {{purge}} — décision : {{decision}}', { data: c.data, registry: c.registry, purge: c.purge, decision: c.decision })}</li>)}
        </ul>
        {/* launch-readiness item 62: what no job deletes yet — counted, never deleted here */}
        {d?.retentionReport ? (
          <>
            <h3 className="font-semibold">{t('admin:k5.privacy.report_heading', 'Données qu’aucune tâche ne supprime encore (comptage seulement)')}</h3>
            {fr.lang ? <p className="text-xs text-slate-600" data-testid="admin-privacy-legal-fr">{t('admin:k5.privacy.legal_text_fr', 'Texte juridique en français : les catégories et leurs conditions restent rédigées en français tant que le DPO ne les a pas validées.')}</p> : null}
            <table className="w-full text-left text-sm" data-testid="admin-privacy-retention-report">
              <thead><tr><th scope="col">{t('admin:k5.privacy.category', 'Catégorie')}</th><th scope="col">{t('admin:k5.privacy.col.duration', 'Durée')}</th><th scope="col">{t('admin:k5.privacy.col.records', 'Enregistrements')}</th><th scope="col">{t('admin:k5.privacy.col.overdue', 'Au-delà de la durée')}</th></tr></thead>
              <tbody>
                {d.retentionReport.items.map((it) => (
                  <tr key={it.key}>
                    <td><span {...fr}>{it.label}</span>{it.blocker ? <span className="block text-xs text-slate-600" {...fr}>{it.blocker}</span> : null}</td>
                    <td>{it.durationDays ? t('admin:k5.privacy.days_from', '{{n}} jours ({{from}})', { n: it.durationDays, from: it.durationFrom }) : t('admin:k5.privacy.to_decide', 'à décider')}</td>
                    <td>{it.total ?? '—'}{it.oldest ? <span className="block text-xs text-slate-600">{t('admin:k5.privacy.since', 'depuis le {{date}}', { date: formatDate(it.oldest, DATE_SHORT) })}</span> : null}</td>
                    <td>{it.overdue ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-600">{t('admin:k5.privacy.no_deletion', 'Aucune suppression n’est faite sur cette base : une durée devient une suppression seulement par une décision du propriétaire ou du DPO.')}</p>
          </>
        ) : null}
      </section>
    </div>
  );
}
