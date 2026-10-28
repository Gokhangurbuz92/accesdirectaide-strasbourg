// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { explain } from '@/pages/admin/k5/helpers.js';

/**
 * PKG-11 / A02 — administrator list of one catalogue kind (aide, démarche, structure) through /api/admin/content: drafts, unverified and archived records
 * included (before: the public API, which hides them), with publish / unpublish and archive. Publication on the public site still needs the D-5 verification,
 * which this screen states and never sets.
 */
const STATE = { brouillon: 'Brouillon', publie: 'Publié', actif: 'Publié', archive: 'Archivé' };
// owner LAB audit (2026-10-25): the label says what was really decided — a reviewer's hold, a change made after a verification, a refusal, a verification —
// instead of « en attente de revérification » for every hold and « non vérifiée » for refused records
const verification = (r) => (r.publication_hold ? (r.holdKind === 'EDIT' ? 'Modifiée depuis la vérification : à revérifier' : 'En attente (décision d’une personne)')
  : r.verification_status === 'VERIFIED' ? 'Vérifiée' : r.verification_status === 'REJECTED' ? 'Refusée' : 'Non vérifiée');
const statusOf = (r) => (r.publication_hold ? (r.holdKind === 'EDIT' ? 'edit' : 'hold') : r.verification_status === 'VERIFIED' ? 'verified' : r.verification_status === 'REJECTED' ? 'rejected' : 'never');
const FILTERS = [['all', 'Toutes'], ['never', 'Non vérifiées'], ['hold', 'En attente (décision)'], ['edit', 'Modifiées depuis la vérification'], ['rejected', 'Refusées'], ['verified', 'Vérifiées']];

export default function CatalogueList({ kind, title, published, newPath, editPath, createLabel, verifiable = true }) {
  const [q, setQ] = useState(''); const [items, setItems] = useState(null); const [error, setError] = useState('');
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [show, setShow] = useState('all');
  const load = useCallback(async (query = '') => {
    // R7: a failed load keeps the list unknown (it showed « Aucune fiche. » under the error, as if the catalogue were empty)
    try { const r = await apiClient.admin.content.list(kind, query); setItems(r.items || []); setError(''); } catch (e) { setError(`La liste n’a pas pu être chargée : ${explain(e)}`); setItems(null); }
  }, [kind]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, ok) => {
    setBusy(true); setMsg(''); setProblem('');
    try { await fn(); setMsg(ok); await load(q); } catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid={`admin-catalogue-${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <Button asChild className="min-h-11"><Link to={newPath}>{createLabel}</Link></Button>
      </div>
      <p className="text-sm text-slate-700">{verifiable
        ? 'Une fiche créée est un brouillon. « Publier » la rend publiable ; elle n’apparaît sur le site qu’une fois vérifiée (registre de vérification). Modifier une fiche vérifiée la met en attente de revérification. Archiver ne supprime rien.'
        : 'Un contenu créé est un brouillon. « Publier » le met en ligne aussitôt (contenu éditorial d’ADA, sans registre de vérification) ; « Dépublier » le retire. Chaque modification garde la version précédente. Archiver ne supprime rien.'}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <label htmlFor={`admin-catalogue-q-${kind}`} className="sr-only">Rechercher</label>
        <Input id={`admin-catalogue-q-${kind}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou identifiant" />
        <Button type="submit" variant="outline" className="min-h-11">Rechercher</Button>
      </form>
      <p role="status" aria-live="polite" data-testid="admin-catalogue-status" className="text-sm text-slate-900">{msg}</p>
      {problem ? <p role="alert" data-testid="admin-catalogue-problem" className="text-sm text-rose-800">{problem}</p> : null}
      {error ? <p role="alert" data-testid="admin-catalogue-load-error" className="text-sm text-rose-800">{error}</p> : null}
      {verifiable && items?.length ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="admin-catalogue-summary">
          <span>{items.length} fiches : {FILTERS.slice(1).map(([k, l]) => `${items.filter((r) => statusOf(r) === k).length} ${l.toLowerCase()}`).join(' · ')}</span>
          <label htmlFor={`admin-catalogue-show-${kind}`} className="ml-auto">Afficher</label>
          <select id={`admin-catalogue-show-${kind}`} className="min-h-11 rounded border border-slate-300 px-2" value={show} onChange={(e) => setShow(e.target.value)}>
            {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ) : null}
      {items === null ? (error ? null : <p role="status">Chargement…</p>) : items.length === 0 ? <p data-testid="admin-catalogue-empty">Aucune fiche.</p> : (
        <ul className="space-y-2">
          {items.filter((r) => show === 'all' || statusOf(r) === show).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-300 bg-white p-3" data-testid="admin-catalogue-row" data-id={r.id}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{r.label}</p>
                <p className="text-xs text-slate-700">{[r.categorie || r.ville || r.departement, r.updatedAt ? `modifiée le ${new Date(r.updatedAt).toLocaleDateString('fr-FR')}` : null].filter(Boolean).join(' — ')}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="secondary" data-testid="admin-catalogue-state">{STATE[r.statut] || r.statut}</Badge>
                  {verifiable ? <Badge variant="outline" data-testid="admin-catalogue-verification">{verification(r)}</Badge> : null}
                </div>
                {verifiable && r.publication_hold ? <p className="mt-1 max-w-2xl text-xs text-slate-700" data-testid="admin-catalogue-hold">Motif : {String(r.publication_hold).slice(0, 160)}{String(r.publication_hold).length > 160 ? '…' : ''}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="min-h-11"><Link to={editPath(r.id)}>Modifier</Link></Button>
                {r.statut !== 'archive' && r.statut !== published && (kind !== 'structure' || r.statut === 'brouillon') ? <Button size="sm" className="min-h-11" disabled={busy} onClick={() => act(() => apiClient.admin.content.update(kind, r.id, { statut: published }), 'Fiche marquée publiée.')}>Publier</Button> : null}
                {r.statut === published ? <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => act(() => apiClient.admin.content.update(kind, r.id, { statut: 'brouillon' }), 'Fiche repassée en brouillon.')}>Dépublier</Button> : null}
                {r.statut !== 'archive' ? <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => { if (window.confirm('Archiver cette fiche ? Elle disparaît du site ; une version est conservée.')) act(() => apiClient.admin.content.archive(kind, r.id), 'Fiche archivée.'); }}>Archiver</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
