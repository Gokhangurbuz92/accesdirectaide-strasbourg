// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { Status } from './ui.jsx';

const REPORT = { NEW: 'Nouveau', IN_PROGRESS: 'En cours', FIXED: 'Corrigé', REJECTED: 'Rejeté' };

/** PKG-5 / P19 — public content reports and structure suggestions (/admin/signalements): triage by a named administrator (changes need MFA, journalised). */
export default function AdminSubmissions() {
  const [d, setD] = useState(/** @type {{ reports: any[], suggestions: any[], loaded?: boolean, failed?: boolean }} */ ({ reports: [], suggestions: [] })); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  // owner LAB audit: every state can be listed (only NEW reports were, so a report moved to « En cours » could never be closed)
  const [status, setStatus] = useState('NEW'); const [notes, setNotes] = useState({});
  const SUGGESTION = { pending: 'à traiter', contacted: 'contactée', approved: 'acceptée', rejected: 'refusée' };
  const load = useCallback(async () => {
    // R7: a refused or failed load is said as such — it used to read as an empty list (« Aucun. » / « Aucune. »)
    try {
      setProblem('');
      // R7: the two lists load independently — a failed suggestions list no longer hides the public reports
      const [rep, sug] = await Promise.allSettled([apiClient.admin.contentReports(status), apiClient.admin.k5('partnerships')]);
      if (rep.status === 'rejected') throw rep.reason;
      const suggestions = sug.status === 'fulfilled' ? sug.value : null;
      setD({ loaded: true, reports: rep.value.reports || [], suggestionsFailed: !suggestions, suggestions: !suggestions ? [] : Array.isArray(suggestions) ? suggestions : suggestions.items || suggestions.data || [] });
    } catch (e) { setD({ reports: [], suggestions: [], failed: true }); setProblem(`La liste n’a pas pu être chargée : ${explain(e)}`); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const setReport = async (id, next) => {
    setMsg(''); setProblem('');
    try { await apiClient.admin.setContentReport(id, next, (notes[id] || '').trim()); setMsg('Signalement mis à jour.'); await load(); } catch (e) { setProblem(explain(e)); }
  };
  return (
    <div className="space-y-4 p-4" data-testid="admin-submissions">
      <h1 className="text-2xl font-bold">Signalements et suggestions</h1>
      <Status msg={msg} problem={problem} id="admin-submissions" />
      <section className="space-y-2" aria-labelledby="sub-r"><h2 id="sub-r" className="font-semibold">Signalements de contenu</h2>
        <label htmlFor="sub-status" className="mr-2 text-sm">Afficher</label>
        <select id="sub-status" className="rounded border p-2" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(REPORT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <ul className="space-y-2">{d.reports.map((r) => (
          <li key={r.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-submission-report">
            <p>{r.contentType} {r.contentId} — {r.reason} — {REPORT[r.status] || r.status}</p>{r.message ? <p className="whitespace-pre-wrap">{r.message}</p> : null}
            <label htmlFor={`sub-note-${r.id}`} className="block text-xs">Note (conservée dans le journal)</label>
            <input id={`sub-note-${r.id}`} className="w-full rounded border p-1" value={notes[r.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
            <div className="flex gap-2">{['IN_PROGRESS', 'FIXED', 'REJECTED'].filter((s) => s !== r.status).map((s) => <Button key={s} size="sm" variant="outline" onClick={() => setReport(r.id, s)}>{REPORT[s]}</Button>)}</div>
          </li>))}{d.loaded && !d.reports.length ? <li data-testid="admin-submissions-empty">Aucun.</li> : null}</ul>
      </section>
      <section className="space-y-2" aria-labelledby="sub-s"><h2 id="sub-s" className="font-semibold">Suggestions de structures</h2>
        <ul className="space-y-1 text-sm">{d.suggestions.map((s) => <li key={s.id} data-testid="admin-submission-suggestion">{s.structureName} — {s.city} — {SUGGESTION[s.status] || s.status}</li>)}{d.suggestionsFailed ? <li role="alert" data-testid="admin-suggestions-problem">Les suggestions n’ont pas pu être chargées.</li> : d.loaded && !d.suggestions.length ? <li>Aucune.</li> : null}</ul>
        <p className="text-xs text-slate-700">Une suggestion n’est jamais publiée telle quelle : la fiche passe par la vérification (source officielle, MFA).</p>
      </section>
    </div>
  );
}
