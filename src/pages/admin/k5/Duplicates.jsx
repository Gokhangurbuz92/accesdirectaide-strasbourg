// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { Status } from './ui.jsx';
import { reviewValue } from '@/components/admin/reviewValue.js';

// owner LAB audit (2026-10-25): each record's current decision is shown, so a pair whose record was already refused or put on hold is recognisable at once
const STATE = (decision, held) => (decision === 'REJECTED' ? ' — fiche refusée' : held ? ' — fiche en attente' : decision === 'VERIFIED' ? ' — fiche vérifiée' : '');
const WHY = (c) => [c.sameSiret && 'même SIRET', c.sameRna && 'même RNA', c.sameFiness && 'même FINESS', c.sameAddress && 'même adresse', Number(c.nameSimilarity) >= 0.6 && `noms proches (${c.nameSimilarity})`].filter(Boolean).join(', ');

/**
 * D13 — registre des doublons (/admin/doublons). La détection propose des paires ; seule une personne d'ADA décide, sur une preuve institutionnelle (registre
 * officiel), que deux fiches sont la même organisation (l'une est conservée, l'autre quitte l'annuaire public) ou deux organisations distinctes.
 * La décision porte sur les versions lues des deux fiches.
 */
export default function AdminDuplicates() {
  const [list, setList] = useState({ loading: true, items: [] }); const [pair, setPair] = useState(null);
  const [form, setForm] = useState({ decision: '', primaryId: '', evidenceUrl: '', note: '' }); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const out = await apiClient.admin.getDuplicates(); setList({ loading: false, items: out.candidates || [] }); }
    catch (e) { setList({ loading: false, items: [] }); setProblem(explain(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const open = async (c) => {
    setProblem(''); setMsg(''); setForm({ decision: '', primaryId: '', evidenceUrl: '', note: '' });
    try { setPair(await apiClient.admin.getDuplicates(c.a, c.b)); } catch (e) { setProblem(explain(e)); }
  };
  const decide = async () => {
    setBusy(true); setProblem('');
    try {
      await apiClient.admin.decideDuplicate({ a: pair.a.id, b: pair.b.id, decision: form.decision, primaryId: form.decision === 'SAME_ENTITY' ? form.primaryId : undefined,
        evidenceUrl: form.evidenceUrl, note: form.note, versionA: pair.a.version, versionB: pair.b.version });
      setMsg(form.decision === 'SAME_ENTITY' ? 'Décision enregistrée : la fiche non conservée est retirée de l’annuaire public (mise en attente).' : 'Décision enregistrée : organisations distinctes.');
      setPair(null); await load();
    } catch (e) {
      setProblem(explain(e));
      if (e?.payload?.error === 'STALE_REVIEW') setPair(await apiClient.admin.getDuplicates(pair.a.id, pair.b.id).catch(() => null));
    } finally { setBusy(false); }
  };
  const Record = ({ r, label }) => (
    <div className="space-y-1 rounded border p-2" data-testid="admin-duplicate-record">
      <p className="font-semibold">{label} : {r.nom}</p>
      <p className="text-xs text-slate-700">Statut : {r.statut || '—'} — vérification : {r.verification || 'aucune'}{r.hold ? ` — en attente : ${r.hold}` : ''}</p>
      <dl className="space-y-1 text-sm">{r.content.map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap">{reviewValue(c.field, c.value)}</dd></div>)}</dl>
    </div>
  );
  return (
    <div className="space-y-4 p-4" data-testid="admin-duplicates">
      <h1 className="text-2xl font-bold">Registre des doublons</h1>
      <p className="text-sm text-slate-700">Les paires sont proposées automatiquement (même numéro SIRET, RNA ou FINESS, même adresse, ou noms très proches dans le même code postal) : ce n’est qu’une suggestion. Décidez sur une source officielle ; rien n’est fusionné automatiquement.</p>
      <Status msg={msg} problem={problem} id="admin-duplicates" />
      {list.loading ? <p role="status">Chargement…</p> : (
        <ul className="space-y-2">
          {list.items.map((c) => (
            <li key={`${c.a}|${c.b}`} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm" data-testid="admin-duplicate-candidate">
              <span>{c.nomA} ({c.villeA || '—'}){STATE(c.decisionA, c.heldA)} / {c.nomB} ({c.villeB || '—'}){STATE(c.decisionB, c.heldB)} — {WHY(c)}</span>
              <Button size="sm" variant="outline" onClick={() => open(c)}>Comparer</Button>
            </li>
          ))}
          {!list.items.length ? <li>Aucune paire à examiner.</li> : null}
        </ul>
      )}
      {pair ? (
        <section className="space-y-3 rounded border p-3" aria-labelledby="dup-pair" data-testid="admin-duplicate-pair">
          <h2 id="dup-pair" className="font-semibold">Comparer les deux fiches</h2>
          <div className="grid gap-3 md:grid-cols-2"><Record r={pair.a} label="Fiche 1" /><Record r={pair.b} label="Fiche 2" /></div>
          <fieldset className="space-y-1"><legend className="font-medium">Décision</legend>
            <label className="flex items-center gap-2"><input type="radio" name="dup-decision" checked={form.decision === 'SAME_ENTITY'} onChange={() => setForm({ ...form, decision: 'SAME_ENTITY' })} /> Même organisation</label>
            <label className="flex items-center gap-2"><input type="radio" name="dup-decision" checked={form.decision === 'DISTINCT'} onChange={() => setForm({ ...form, decision: 'DISTINCT', primaryId: '' })} /> Organisations distinctes</label>
          </fieldset>
          {form.decision === 'SAME_ENTITY' ? (
            <div><label htmlFor="dup-primary" className="block text-sm">Fiche à conserver (l’autre quitte l’annuaire public)</label>
              <select id="dup-primary" className="rounded border p-2" value={form.primaryId} onChange={(e) => setForm({ ...form, primaryId: e.target.value })}>
                <option value="">—</option><option value={pair.a.id}>Fiche 1 : {pair.a.nom}</option><option value={pair.b.id}>Fiche 2 : {pair.b.nom}</option>
              </select></div>
          ) : null}
          <label htmlFor="dup-evidence" className="block text-sm">Preuve institutionnelle (page d’un registre officiel : annuaire des entreprises, FINESS, Journal officiel…)</label>
          <input id="dup-evidence" type="url" className="w-full rounded border p-2" value={form.evidenceUrl} onChange={(e) => setForm({ ...form, evidenceUrl: e.target.value })} placeholder="https://…" />
          <label htmlFor="dup-note" className="block text-sm">Ce que la source établit (conservé dans le registre)</label>
          <textarea id="dup-note" className="w-full rounded border p-2" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button disabled={busy || !form.decision} onClick={decide} data-testid="admin-duplicate-decide">Enregistrer la décision</Button>
          {pair.decisions?.length ? (
            <details><summary className="cursor-pointer text-blue-800">Décisions précédentes pour cette paire</summary>
              <ul className="text-sm">{pair.decisions.map((d) => <li key={d.id}>{new Date(d.decidedAt).toLocaleString('fr-FR')} — {d.decision === 'SAME_ENTITY' ? 'même organisation' : 'distinctes'} — {d.reviewerId}{d.supersededAt ? ' (remplacée)' : ''}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
