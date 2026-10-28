// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useK5, explain } from './helpers.js';
import { Status, Field } from './ui.jsx';

/**
 * PKG-5 / A12 — privacy console (/admin/privacy). Access requests with organization-held notes (two people: one proposes, another confirms), legal holds
 * (placing one protects at once; releasing needs two people), assisted ownership recovery (two people), retention rules with the conflicts that need a legal
 * decision. Every action is journalised; this page never shows dossier content except the notes under review, read on purpose and journalised.
 */
/** launch-readiness item 63: the one-month deadline of GDPR art. 12(3), red once passed */
function DsrDue({ r }) {
  if (!r?.dueAt) return null;
  const date = new Date(r.dueAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  return r.overdue
    ? <p className="font-semibold text-red-800" data-testid="dsr-overdue">Délai dépassé : la réponse était due le {date}.</p>
    : <p className={r.daysLeft <= 7 ? 'font-semibold text-amber-900' : 'text-slate-700'} data-testid="dsr-due">Réponse due au plus tard le {date} ({r.daysLeft} j).</p>;
}

export default function AdminPrivacy() {
  const k = useK5('privacy');
  const [f, setF] = useState({}); const v = (key) => f[key] || ''; const set = (key, val) => setF((x) => ({ ...x, [key]: val }));
  const [notes, setNotes] = useState({}); const [extracts, setExtracts] = useState({}); const [bases, setBases] = useState({}); const [problem, setProblem] = useState('');
  const d = k.data;
  const [erasure, setErasure] = useState({});
  const [closure, setClosure] = useState({});
  const [restrictions, setRestrictions] = useState(null);
  const loadRestrictions = async () => { setProblem(''); try { setRestrictions((await apiClient.admin.k5('processing-restrictions')).restrictions || []); } catch (e) { setProblem(explain(e)); } };
  const liftRestriction = async (id) => { const r = await k.act({ id, reason: v(`lift-${id}`) }, (out) => (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.notice) ? 'Limitation levée : le message à la personne a été remis au service d’envoi.' : 'Limitation levée, mais la personne n’a pas pu être prévenue par e-mail : prévenez-la par un autre moyen.'), 'processing-restrictions'); if (r) await loadRestrictions(); };
  const readClosure = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`org-closure?id=${encodeURIComponent(id)}`); setClosure((x) => ({ ...x, [id]: r.summary })); } catch (e) { setProblem(explain(e)); } };
  const readErasure = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`dsr-erasure?id=${encodeURIComponent(id)}`); setErasure((x) => ({ ...x, [id]: r.summary })); } catch (e) { setProblem(explain(e)); } };
  const readNotes = async (id) => { setProblem(''); try { const r = await apiClient.admin.k5(`dsr-review?id=${encodeURIComponent(id)}`); setNotes((x) => ({ ...x, [id]: r.notes || [] })); setExtracts((x) => ({ ...x, [id]: r.proposalExtract ?? null })); setBases((x) => ({ ...x, [id]: r.proposal?.basis || '' })); } catch (e) { setProblem(explain(e)); } };
  return (
    <div className="space-y-6 p-4" data-testid="admin-privacy">
      <h1 className="text-2xl font-bold">Console de protection des données</h1>
      <Status msg={k.msg} problem={problem || k.problem || k.error} id="admin-privacy" />
      {k.loading ? <p role="status">Chargement…</p> : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-dsr">
        <h2 id="pv-dsr" className="font-semibold">Demandes d’accès à examiner</h2>
        {(d?.accessRequests?.requests || []).length === 0 ? <p className="text-sm">Aucune demande en cours.</p> : null}
        <ul className="space-y-2">
          {(d?.accessRequests?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-dsr">
              <DsrDue r={r} />
              <p>Demande du {new Date(r.createdAt).toLocaleDateString('fr-FR')} — {r.stage === 'AWAITING_SECOND_REVIEWER' ? `proposition (${r.proposed}) en attente d’une deuxième personne` : 'à examiner'}</p>
              <Button size="sm" variant="outline" onClick={() => readNotes(r.id)}>Lire les notes concernées (journalisé)</Button>
              {notes[r.id] ? <ul className="list-disc pl-5">{notes[r.id].map((n, i) => <li key={i}>{n.body}</li>)}</ul> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`basis-${r.id}`} label="Fondement de la décision" value={v(`basis-${r.id}`)} onChange={(x) => set(`basis-${r.id}`, x)} rows={2} />
                  <Field id={`extract-${r.id}`} label="Extrait à communiquer (si communication)" value={v(`extract-${r.id}`)} onChange={(x) => set(`extract-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'RELEASE', basis: v(`basis-${r.id}`), extract: v(`extract-${r.id}`) }, 'Proposition enregistrée : une autre personne doit confirmer.', 'dsr-review')}>Proposer de communiquer</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'WITHHOLD', basis: v(`basis-${r.id}`) }, 'Proposition enregistrée : une autre personne doit confirmer.', 'dsr-review')}>Proposer de ne pas communiquer</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p data-testid="admin-dsr-proposal">Proposé par {r.proposedBy} le {r.proposedAt ? new Date(r.proposedAt).toLocaleString('fr-FR') : '—'}{bases[r.id] ? ` — fondement : ${bases[r.id]}` : ''}</p>
                  {notes[r.id] ? <p className="whitespace-pre-wrap rounded bg-slate-50 p-2" data-testid="admin-dsr-extract">{extracts[r.id] != null ? `Extrait proposé : ${extracts[r.id] || '—'}` : 'Aucun extrait : la proposition est de ne pas communiquer.'}</p> : <p className="text-sm" data-testid="admin-dsr-read-first">Lisez les notes (journalisé) pour voir l’extrait proposé : « Confirmer » s’active après votre lecture.</p>}
                  <Field id={`confirm-${r.id}`} label="Note de la deuxième personne" value={v(`confirm-${r.id}`)} onChange={(x) => set(`confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    {/* the server confirms only after the confirming person's own journalised reading (409 read_required): the button says so instead of failing */}
                    <Button size="sm" disabled={k.busy || !notes[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`confirm-${r.id}`) }, 'Décision confirmée.', 'dsr-review')}>Confirmer</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`confirm-${r.id}`) }, 'Proposition renvoyée.', 'dsr-review')}>Renvoyer</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-erase">
        <h2 id="pv-erase" className="font-semibold">Demandes d’effacement de compte</h2>
        <p className="text-sm text-slate-700">Deux personnes : l’une propose (exécuter ou refuser, avec la raison qui sera communiquée), une autre confirme. La confirmation d’une exécution supprime les données aussitôt ; une conservation légale active la bloque.</p>
        {(d?.erasureRequests?.requests || []).length === 0 ? <p className="text-sm">Aucune demande en cours.</p> : null}
        <ul className="space-y-2">
          {(d?.erasureRequests?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-erasure" data-request={r.id}>
              <DsrDue r={r} />
              <p>Demande du {new Date(r.createdAt).toLocaleDateString('fr-FR')} — {r.stage === 'BLOCKED_BY_LEGAL_HOLD' ? 'bloquée par une conservation légale' : r.stage === 'EXECUTION_FAILED_RETRYABLE' ? 'exécution échouée (rien n’a été effacé) : à relancer' : r.stage === 'AWAITING_SECOND_REVIEWER' ? `proposition (${r.proposed === 'APPROVE' ? 'exécuter' : 'refuser'}) en attente d’une deuxième personne` : 'à examiner'}</p>
              <Button size="sm" variant="outline" onClick={() => readErasure(r.id)}>Voir ce qui serait supprimé (journalisé)</Button>
              {erasure[r.id] ? <p data-testid="admin-erasure-summary">Compte : {erasure[r.id].accountExists ? 'présent' : 'absent'} — dossiers : {erasure[r.id].dossiers} — rendez-vous : {erasure[r.id].appointments} — conservations légales actives : {erasure[r.id].activeLegalHolds}</p> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`erase-reason-${r.id}`} label="Raison du refus (si refus)" value={v(`erase-reason-${r.id}`)} onChange={(x) => set(`erase-reason-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'APPROVE' }, 'Proposition enregistrée : une autre personne doit confirmer.', 'dsr-erasure')}>Proposer d’exécuter</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'REJECT', reason: v(`erase-reason-${r.id}`) }, 'Proposition enregistrée : une autre personne doit confirmer.', 'dsr-erasure')}>Proposer de refuser</Button>
                  </div>
                </div>
              ) : r.stage === 'AWAITING_SECOND_REVIEWER' ? (
                <div className="space-y-1">
                  <p data-testid="admin-erasure-proposal">Proposé par {r.proposedBy} le {r.proposedAt ? new Date(r.proposedAt).toLocaleString('fr-FR') : '—'}{r.reason ? ` — raison : ${r.reason}` : ''}</p>
                  {erasure[r.id] ? null : <p className="text-sm" data-testid="admin-erasure-read-first">Ouvrez « Voir ce qui serait supprimé » (journalisé) : « Confirmer » s’active après votre lecture.</p>}
                  <Field id={`erase-confirm-${r.id}`} label="Note de la deuxième personne" value={v(`erase-confirm-${r.id}`)} onChange={(x) => set(`erase-confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy || !erasure[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`erase-confirm-${r.id}`) }, 'Décision confirmée.', 'dsr-erasure')}>Confirmer</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`erase-confirm-${r.id}`) }, 'Proposition renvoyée.', 'dsr-erasure')}>Renvoyer</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'retry' }, (out) => (out?.request?.status === 'COMPLETED' ? 'Effacement exécuté.' : out?.request?.status === 'BLOCKED' ? 'Toujours bloquée : voir la raison.' : 'Exécution relancée.'), 'dsr-erasure')}>{r.stage === 'EXECUTION_FAILED_RETRYABLE' ? 'Relancer l’effacement' : 'Relancer après la levée de la conservation'}</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-restrict" data-testid="admin-privacy-restrictions">
        <h2 id="pv-restrict" className="font-semibold">Limitations du traitement (RGPD, article 18)</h2>
        <p className="text-sm text-slate-700">Une limitation s’applique dès la demande de la personne : aucune structure n’ouvre ses dossiers, rien n’est partagé ni purgé, aucune notification. La lever demande une raison, communiquée à la personne avant la levée.</p>
        <Button size="sm" variant="outline" onClick={loadRestrictions}>Afficher les limitations en cours (journalisé)</Button>
        {restrictions && restrictions.length === 0 ? <p className="text-sm">Aucune limitation en cours.</p> : null}
        {restrictions && restrictions.length ? (
          <ul className="space-y-2">
            {restrictions.map((r) => (
              <li key={r.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-restriction" data-request={r.id}>
                <p>{r.account || 'compte'} — depuis le {new Date(r.since).toLocaleDateString('fr-FR')} — raison : {r.ground}</p>
                <Field id={`lift-${r.id}`} label="Raison de la levée (communiquée à la personne)" value={v(`lift-${r.id}`)} onChange={(x) => set(`lift-${r.id}`, x)} rows={2} />
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => liftRestriction(r.id)}>Lever la limitation</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-close">
        <h2 id="pv-close" className="font-semibold">Fermetures d’espaces de structure</h2>
        <p className="text-sm text-slate-700">Deux personnes : l’une propose (exécuter ou refuser, avec la raison communiquée à la structure), une autre confirme. L’exécution retire les accès aux dossiers (les personnes gardent leurs dossiers), efface les notes internes, les notifications et les comptes des membres, clôt les suivis et les orientations en cours et annule les rendez-vous à venir en prévenant les personnes. Une conservation légale active sur la structure la bloque.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field id="close-sid" label="Structure concernée (référence ; fermeture à l’initiative d’ADA)" value={v('closeSid')} onChange={(x) => set('closeSid', x)} />
          <Field id="close-why" label="Raison de la fermeture décidée par ADA" value={v('closeWhy')} onChange={(x) => set('closeWhy', x)} />
          <div className="flex items-end"><Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'open', structureId: v('closeSid'), reason: v('closeWhy') }, 'Demande de fermeture ouverte : deux personnes doivent l’examiner.', 'org-closure')}>Ouvrir une demande</Button></div>
        </div>
        {(d?.organizationClosures?.requests || []).length === 0 ? <p className="text-sm">Aucune demande en cours.</p> : null}
        <ul className="space-y-2">
          {(d?.organizationClosures?.requests || []).map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-2 text-sm" data-testid="admin-privacy-closure" data-request={r.id}>
              <p>{r.structureNom} — demande {r.origin === 'ADA' ? 'd’ADA' : 'de la structure'} du {new Date(r.createdAt).toLocaleDateString('fr-FR')}{r.requestReason ? ` (« ${r.requestReason} »)` : ''} — {r.stage === 'BLOCKED_BY_LEGAL_HOLD' ? 'bloquée par une conservation légale' : r.stage === 'AWAITING_SECOND_REVIEWER' ? `proposition (${r.proposed === 'APPROVE' ? 'exécuter' : 'refuser'}) en attente d’une deuxième personne` : 'à examiner'}</p>
              <Button size="sm" variant="outline" onClick={() => readClosure(r.id)}>Voir ce que la fermeture toucherait (journalisé)</Button>
              {closure[r.id] ? <p data-testid="admin-closure-summary">Membres : {closure[r.id].members} — accès aux dossiers : {closure[r.id].activeDossierAccesses} — suivis ouverts : {closure[r.id].openCases} — notes internes : {closure[r.id].internalNotes} — orientations en cours : {closure[r.id].liveReferrals} — rendez-vous à venir : {closure[r.id].futureAppointments} — conservations légales actives : {closure[r.id].activeLegalHolds}</p> : null}
              {r.stage === 'AWAITING_PROPOSAL' ? (
                <div className="space-y-1">
                  <Field id={`close-reason-${r.id}`} label="Raison du refus (si refus)" value={v(`close-reason-${r.id}`)} onChange={(x) => set(`close-reason-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'APPROVE' }, 'Proposition enregistrée : une autre personne doit confirmer.', 'org-closure')}>Proposer de fermer</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, decision: 'REJECT', reason: v(`close-reason-${r.id}`) }, 'Proposition enregistrée : une autre personne doit confirmer.', 'org-closure')}>Proposer de refuser</Button>
                  </div>
                </div>
              ) : r.stage === 'AWAITING_SECOND_REVIEWER' ? (
                <div className="space-y-1">
                  <p data-testid="admin-closure-proposal">Proposé par {r.proposedBy} le {r.proposedAt ? new Date(r.proposedAt).toLocaleString('fr-FR') : '—'}{r.reason ? ` — raison : ${r.reason}` : ''}</p>
                  {closure[r.id] ? null : <p className="text-sm" data-testid="admin-closure-read-first">Ouvrez « Voir ce que la fermeture toucherait » (journalisé) : « Confirmer » s’active après votre lecture.</p>}
                  <Field id={`close-confirm-${r.id}`} label="Note de la deuxième personne" value={v(`close-confirm-${r.id}`)} onChange={(x) => set(`close-confirm-${r.id}`, x)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={k.busy || !closure[r.id]} onClick={() => k.act({ id: r.id, action: 'confirm', proposedAt: r.proposedAt, note: v(`close-confirm-${r.id}`) }, 'Décision confirmée.', 'org-closure')}>Confirmer</Button>
                    <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'send_back', proposedAt: r.proposedAt, note: v(`close-confirm-${r.id}`) }, 'Proposition renvoyée.', 'org-closure')}>Renvoyer</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, action: 'retry' }, 'Exécution relancée.', 'org-closure')}>Relancer après la levée de la conservation</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-hold">
        <h2 id="pv-hold" className="font-semibold">Conservations légales</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1"><label htmlFor="hold-cat" className="block text-sm">Catégorie</label>
            <select id="hold-cat" className="w-full rounded border p-2" value={v('holdCat') || 'SharedDiagnostic'} onChange={(e) => set('holdCat', e.target.value)}>
              <option value="SharedDiagnostic">Dossier partagé</option><option value="CitizenUser">Compte</option><option value="ProCase">Suivi de structure</option><option value="Structure">Structure (organisation)</option>
            </select></div>
          <Field id="hold-id" label="Identifiant" value={v('holdId')} onChange={(x) => set('holdId', x)} />
          <Field id="hold-reason" label="Fondement" value={v('holdReason')} onChange={(x) => set('holdReason', x)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'hold_place', dataCategory: v('holdCat') || 'SharedDiagnostic', recordId: v('holdId'), reasonCode: v('holdReason') }, 'Conservation posée.')}>Poser une conservation</Button>
        <ul className="space-y-2">
          {(d?.legalHolds || []).map((h) => (
            <li key={h.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-hold">
              <p>{h.dataCategory} {h.recordId} — {h.reasonCode} — posée par {h.createdBy}</p>
              {h.releaseProposedBy ? (
                <><p>Levée proposée par {h.releaseProposedBy} : {h.releaseReason}</p>
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'hold_confirm_release', id: h.id, proposedAt: h.releaseProposedAt }, 'Conservation levée.')}>Confirmer la levée (autre personne)</Button></>
              ) : (
                <><Field id={`rel-${h.id}`} label="Motif de la levée" value={v(`rel-${h.id}`)} onChange={(x) => set(`rel-${h.id}`, x)} />
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'hold_propose_release', id: h.id, reason: v(`rel-${h.id}`) }, 'Levée proposée : une autre personne doit confirmer.')}>Proposer la levée</Button></>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-rec">
        <h2 id="pv-rec" className="font-semibold">Récupération assistée d’un compte</h2>
        <p className="text-sm text-slate-700">Pour une personne qui n’a plus accès à son adresse e-mail, après vérification de son identité en personne. Une deuxième personne décide. Le compte prend la nouvelle adresse, l’ancien mot de passe ne fonctionne plus, et la personne choisit un mot de passe avec « mot de passe oublié ».</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="rec-cur" label="Adresse actuelle du compte" value={v('recCur')} onChange={(x) => set('recCur', x)} />
          <Field id="rec-new" label="Nouvelle adresse" value={v('recNew')} onChange={(x) => set('recNew', x)} />
        </div>
        <Field id="rec-ev" label="Vérification d’identité faite (sans copier de pièce)" value={v('recEv')} onChange={(x) => set('recEv', x)} rows={2} />
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'recovery_propose', currentEmail: v('recCur'), newEmail: v('recNew'), evidenceNote: v('recEv') }, 'Demande enregistrée : une autre personne doit décider.')}>Proposer</Button>
        <ul className="space-y-2">
          {(d?.recoveryCases || []).map((c) => (
            <li key={c.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-privacy-recovery">
              <p>Proposée par {c.proposedBy} le {new Date(c.proposedAt).toLocaleDateString('fr-FR')} — {c.evidenceNote}</p>
              <Field id={`dec-${c.id}`} label="Motif de la décision" value={v(`dec-${c.id}`)} onChange={(x) => set(`dec-${c.id}`, x)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'recovery_decide', id: c.id, decision: 'APPROVE', note: v(`dec-${c.id}`) }, 'Récupération approuvée.')}>Approuver</Button>
                <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'recovery_decide', id: c.id, decision: 'REJECT', note: v(`dec-${c.id}`) }, 'Demande refusée.')}>Refuser</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="pv-ret">
        <h2 id="pv-ret" className="font-semibold">Durées de conservation</h2>
        <ul className="list-disc pl-5 text-sm">
          {Object.entries(d?.retention?.registry || {}).map(([key, r]) => <li key={key}>{key} : {r.durationDays ? `${r.durationDays} jours` : 'à décider'} — {r.action}</li>)}
        </ul>
        {(d?.retention?.conflicts || []).length ? <h3 className="font-semibold">À trancher (décision juridique)</h3> : null}
        <ul className="list-disc pl-5 text-sm" data-testid="admin-privacy-conflicts">
          {(d?.retention?.conflicts || []).map((c) => <li key={c.data}>{c.data} : registre « {c.registry} » mais {c.purge} — décision : {c.decision}</li>)}
        </ul>
        {/* launch-readiness item 62: what no job deletes yet — counted, never deleted here */}
        {d?.retentionReport ? (
          <>
            <h3 className="font-semibold">Données qu’aucune tâche ne supprime encore (comptage seulement)</h3>
            <table className="w-full text-left text-sm" data-testid="admin-privacy-retention-report">
              <thead><tr><th scope="col">Catégorie</th><th scope="col">Durée</th><th scope="col">Enregistrements</th><th scope="col">Au-delà de la durée</th></tr></thead>
              <tbody>
                {d.retentionReport.items.map((it) => (
                  <tr key={it.key}>
                    <td>{it.label}{it.blocker ? <span className="block text-xs text-slate-600">{it.blocker}</span> : null}</td>
                    <td>{it.durationDays ? `${it.durationDays} jours (${it.durationFrom})` : 'à décider'}</td>
                    <td>{it.total ?? '—'}{it.oldest ? <span className="block text-xs text-slate-600">depuis le {new Date(it.oldest).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}</span> : null}</td>
                    <td>{it.overdue ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-600">Aucune suppression n’est faite sur cette base : une durée devient une suppression seulement par une décision du propriétaire ou du DPO.</p>
          </>
        ) : null}
      </section>
    </div>
  );
}
