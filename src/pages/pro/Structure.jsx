// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { PROPOSAL_STATUS_LABELS, STRUCTURE_FIELD_LABELS } from '@/lib/structureFields';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '');
const shown = (field, v) => (v === null || v === undefined || v === '' ? '—' : field === 'accessibilite_pmr' ? (String(v) === 'true' ? 'Oui' : 'Non confirmée') : Array.isArray(v) ? v.join(', ') || '—' : String(v));

/**
 * PKG-4 / E02 E05 E08 — Ma structure (/pro/structure). The public record is shown as ADA published it; administrators PROPOSE changes, which an ADA reviewer checks
 * before anything is published (D-5). Every rule is enforced by /api/pro/structure. PKG-11 / E08: an administrator can ask ADA to close the space and erase the
 * organization's own data; two ADA reviewers decide, and the people keep their dossiers.
 */
const CLOSURE_STATE = { IN_REVIEW: 'en cours d’examen par l’équipe ADA (deux personnes)', BLOCKED: 'suspendue : une conservation légale s’applique', EXECUTING: 'en cours d’exécution', COMPLETED: 'exécutée', REJECTED: 'refusée' };
export default function ProStructure() {
  const [state, setState] = useState({ loading: true, error: '', structure: null, proposals: [], canPropose: false, fields: [] });
  const [field, setField] = useState('horaires'); const [value, setValue] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const load = useCallback(async () => {
    try { const out = await proRdvRequest('/api/pro/structure'); setState({ loading: false, error: '', ...out }); }
    catch (e) { setState({ loading: false, error: msgOf(e, 'Impossible de charger la fiche de la structure.'), structure: null, proposals: [], canPropose: false, fields: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'propose', field, value } }); setValue(''); setMessage('Proposition envoyée : elle sera publiée après vérification par l’équipe ADA.'); await load(); }
    catch (err) { setProblem(msgOf(err, 'La proposition n’a pas pu être enregistrée.')); } finally { setBusy(false); }
  };
  const withdraw = async (id) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'withdraw', id } }); setMessage('Proposition retirée.'); await load(); }
    catch (err) { setProblem(msgOf(err, 'Impossible de retirer la proposition.')); } finally { setBusy(false); }
  };
  const requestClosure = async (e) => {
    e.preventDefault();
    if (!window.confirm('Demander la fermeture de l’espace de la structure ? Après examen par deux personnes d’ADA, les accès aux dossiers, les comptes des membres et les notes internes seront effacés. Les personnes gardent leurs dossiers.')) return;
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'request_closure', reason: closeReason } }); setCloseReason(''); setMessage('Demande de fermeture envoyée : deux personnes de l’équipe ADA vont l’examiner.'); await load(); }
    catch (err) { setProblem(msgOf(err, 'La demande n’a pas pu être envoyée.')); } finally { setBusy(false); }
  };
  const exportData = async () => {
    setProblem('');
    try {
      const out = await proRdvRequest('/api/pro/structure', { query: { export: '1' } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(out.export, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'export-structure.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);   // revoking at once can cancel the download
    } catch (err) { setProblem(msgOf(err, 'Export impossible.')); }
  };
  if (state.loading) return <div role="status">Chargement…</div>;
  const s = state.structure;
  return (
    <div className="space-y-6" data-testid="pro-structure">
      <SEO title="Ma structure" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Ma structure</h1>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {problem ? <p role="alert" data-testid="structure-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="structure-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {s ? (
        <Card><CardHeader><CardTitle>{s.nom}</CardTitle><CardDescription>Fiche publique telle que vérifiée par ADA ({s.verification_status === 'VERIFIED' ? `vérifiée${s.date_verification ? ` le ${new Date(s.date_verification).toLocaleDateString('fr-FR')}` : ''}` : 'non vérifiée'}).</CardDescription></CardHeader>
          <CardContent><dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="structure-record">
            {Object.keys(STRUCTURE_FIELD_LABELS).map((f) => (
              <div key={f}><dt className="font-medium text-slate-700">{STRUCTURE_FIELD_LABELS[f]}</dt><dd className="whitespace-pre-wrap text-slate-900">{shown(f, f === 'service_area' ? s.insee_codes : s[f])}</dd></div>
            ))}
          </dl></CardContent></Card>
      ) : null}
      {state.canPropose ? (
        <Card><CardHeader><CardTitle className="text-lg">Proposer une modification</CardTitle><CardDescription>Rien n’est publié directement : l’équipe ADA vérifie chaque proposition avant publication.</CardDescription></CardHeader>
          <CardContent><form onSubmit={submit} className="space-y-3">
            <div><label htmlFor="structure-field" className="block text-sm font-medium">Information à modifier</label>
              <select id="structure-field" data-testid="structure-field" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={field} onChange={(e) => { setField(e.target.value); setValue(''); }}>
                {state.fields.map((f) => <option key={f} value={f}>{STRUCTURE_FIELD_LABELS[f] || f}</option>)}
              </select></div>
            <div><label htmlFor="structure-value" className="block text-sm font-medium">Nouvelle valeur</label>
              {field === 'accessibilite_pmr'
                ? <select id="structure-value" data-testid="structure-value" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={value} onChange={(e) => setValue(e.target.value)} required><option value="">Choisir…</option><option value="true">Oui</option><option value="false">Non</option></select>
                : <textarea id="structure-value" data-testid="structure-value" className="mt-1 w-full rounded-md border border-slate-300 p-2" rows={field === 'summary_falc' || field === 'horaires' || field === 'service_area' ? 4 : 1} value={value} onChange={(e) => setValue(e.target.value)} required aria-describedby={field === 'service_area' ? 'structure-value-help' : undefined} />}
              {field === 'service_area' ? <p id="structure-value-help" className="mt-1 text-xs text-slate-600">Codes INSEE séparés par des virgules (ex. 67482 pour Strasbourg).</p> : null}
            </div>
            <Button type="submit" disabled={busy} data-testid="structure-propose">Envoyer la proposition</Button>
          </form></CardContent></Card>
      ) : <p className="text-sm text-slate-700">Seul·e un·e administrateur·rice de la structure peut proposer une modification de la fiche.</p>}
      <Card><CardHeader><CardTitle className="text-lg">Propositions</CardTitle></CardHeader><CardContent>
        {state.proposals.length ? <ul className="space-y-2">{state.proposals.map((p) => (
          <li key={p.id} data-testid="structure-proposal" className="rounded-md border border-slate-200 p-2 text-sm">
            <p><strong>{STRUCTURE_FIELD_LABELS[p.field] || p.field}</strong> : {shown(p.field, p.proposedValue)} — <span data-testid="structure-proposal-status">{PROPOSAL_STATUS_LABELS[p.status] || p.status}</span> <span className="text-slate-600">({when(p.createdAt)})</span></p>
            {p.reviewNote ? <p>Commentaire ADA : « {p.reviewNote} »</p> : null}
            {p.status === 'PENDING' && state.canPropose ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => withdraw(p.id)} data-testid="structure-withdraw">Retirer</Button> : null}
          </li>
        ))}</ul> : <p className="text-sm text-slate-700" data-testid="structure-no-proposal">Aucune proposition.</p>}
      </CardContent></Card>
      {state.canPropose ? <Button type="button" variant="outline" onClick={exportData} data-testid="structure-export">Exporter les données de la structure</Button> : null}
      {state.canPropose ? (
        <Card data-testid="structure-closure"><CardHeader><CardTitle className="text-lg">Fermer l’espace de la structure</CardTitle>
          <CardDescription>Deux personnes de l’équipe ADA examinent la demande. À l’exécution : les accès aux dossiers sont retirés (les personnes gardent leurs dossiers), les notes internes, les notifications et les comptes des membres sont effacés, les suivis et orientations en cours sont clos et les rendez-vous à venir annulés (les personnes sont prévenues). Exportez d’abord les données de la structure si vous en avez besoin.</CardDescription></CardHeader>
          <CardContent>
            {state.closure && ['IN_REVIEW', 'BLOCKED', 'EXECUTING'].includes(state.closure.status)
              ? <p data-testid="structure-closure-state">Demande du {new Date(state.closure.createdAt).toLocaleDateString('fr-FR')} : {CLOSURE_STATE[state.closure.status] || state.closure.status}.</p>
              : (
                <form onSubmit={requestClosure} className="space-y-3">
                  {state.closure?.status === 'REJECTED' ? <p data-testid="structure-closure-state">Dernière demande refusée{state.closure.reason ? ` : « ${state.closure.reason} »` : ''}.</p> : null}
                  <div><label htmlFor="structure-closure-reason" className="block text-sm font-medium">Raison de la fermeture</label>
                    <textarea id="structure-closure-reason" data-testid="structure-closure-reason" className="mt-1 w-full rounded-md border border-slate-300 p-2" rows={3} minLength={10} required value={closeReason} onChange={(e) => setCloseReason(e.target.value)} /></div>
                  <Button type="submit" variant="outline" disabled={busy} data-testid="structure-closure-request">Demander la fermeture</Button>
                </form>
              )}
          </CardContent></Card>
      ) : null}
    </div>
  );
}
