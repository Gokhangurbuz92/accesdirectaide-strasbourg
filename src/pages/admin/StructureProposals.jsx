// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { PROPOSAL_STATUS_LABELS, STRUCTURE_FIELD_LABELS } from '@/lib/structureFields';
import { explain } from './k5/helpers';   // R7: the server's refusal in French (it showed « API Error: 403 »)

/** PKG-4 / E02 — ADA review of structure profile proposals. Deciding requires an administrator session with MFA (enforced by the API). */
export default function AdminStructureProposals() {
  const [state, setState] = useState({ loading: true, error: '', proposals: [] });
  const [notes, setNotes] = useState({}); const [sources, setSources] = useState({}); const [territory, setTerritory] = useState({}); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const out = await apiClient.admin.getStructureProposals('PENDING'); setState({ loading: false, error: '', proposals: out.proposals || [] }); }
    catch (e) { setState({ loading: false, error: `Les propositions n’ont pas pu être chargées : ${explain(e)}`, proposals: [], failed: true }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (id, decision) => {
    setBusy(true); setProblem('');
    try { await apiClient.admin.decideStructureProposal(id, decision, notes[id] || '', { sourceUrl: sources[id] || '', territoryConfirmed: territory[id] === true }); await load(); }
    catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  if (state.loading) return <div role="status">Chargement…</div>;
  return (
    <div className="space-y-4 p-4" data-testid="admin-structure-proposals">
      <h1 className="text-2xl font-bold">Propositions des structures</h1>
      <p className="text-sm text-slate-700">Vérifiez chaque information auprès d’une source fiable avant d’accepter : une proposition acceptée est publiée sur la fiche publique.</p>
      {state.error ? <p role="alert" className="text-red-800" data-testid="admin-proposals-load-error">{state.error}</p> : null}
      {problem ? <p role="alert" className="text-red-800" data-testid="admin-proposals-problem">{problem}</p> : null}
      {state.proposals.length ? state.proposals.map((p) => (
        <div key={p.id} className="space-y-2 rounded-md border p-3 text-sm" data-testid="admin-structure-proposal">
          <p><strong>{p.structureNom}</strong> — {STRUCTURE_FIELD_LABELS[p.field] || p.field} ({PROPOSAL_STATUS_LABELS[p.status]})</p>
          <p>Actuel : <span className="whitespace-pre-wrap">{p.previousValue ?? '—'}</span></p>
          <p>Proposé : <span className="whitespace-pre-wrap">{p.proposedValue}</span></p>
          <label className="block" htmlFor={`note-${p.id}`}>Commentaire (obligatoire en cas de refus, visible par la structure)</label>
          <textarea id={`note-${p.id}`} className="w-full rounded border p-2" rows={2} value={notes[p.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))} />
          <label className="block" htmlFor={`src-${p.id}`}>Source officielle vérifiée (https, obligatoire pour accepter)</label>
          <input id={`src-${p.id}`} type="url" className="w-full rounded border p-2" value={sources[p.id] || ''} onChange={(e) => setSources((n) => ({ ...n, [p.id]: e.target.value }))} />
          {['adresse', 'code_postal', 'ville', 'service_area'].includes(p.field) ? (
            <label className="flex items-center gap-2"><input type="checkbox" checked={territory[p.id] === true} onChange={(e) => setTerritory((n) => ({ ...n, [p.id]: e.target.checked }))} />
              Territoire d’intervention confirmé (sinon la fiche perd la vérification territoriale et n’est plus publiée jusqu’à nouvelle vérification)</label>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => decide(p.id, 'ACCEPT')}>Accepter et publier</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(p.id, 'REJECT')}>Refuser</Button>
          </div>
        </div>
      )) : state.failed ? null : <p data-testid="admin-proposals-empty">Aucune proposition en attente.</p>}
    </div>
  );
}
