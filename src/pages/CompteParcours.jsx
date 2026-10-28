// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { PARCOURS_DONE, PARCOURS_STATUS_LABELS, formatDate } from '@/lib/monEspace';

/**
 * PKG-2 / C07 — Mon Parcours (/compte/parcours): the steps the person follows, kept across sessions. The plan d'action of a dossier attached to the account becomes tracked steps;
 * the person records where each step stands (never a decision by ADA), adds a deadline ONLY with its official source, keeps a private note, and sees the history of each step.
 */
export default function CompteParcours() {
  const [state, setState] = useState({ loading: true, error: '', items: [], shares: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [open, setOpen] = useState(null);   // id of the step whose details are shown
  const [history, setHistory] = useState({});
  const [due, setDue] = useState({ date: '', source: '' });

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([citizenApi.listParcours(), citizenApi.listShares()]);
      setState({ loading: false, error: '', items: p.items || [], shares: s.shares || [] });
    } catch (err) { setState({ loading: false, unauth: err.status === 401, error: err.status === 401 ? 'Connectez-vous pour accéder à Mon Parcours.' : err.message, items: [], shares: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { const out = await fn(); if (ok) setMessage(typeof ok === 'function' ? ok(out) : ok); await load(); return out; } catch (err) { setProblem(err.message); return null; } };
  const toggle = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDue({ date: '', source: '' });
    try { const h = await citizenApi.parcoursHistory(id); setHistory((x) => ({ ...x, [id]: h.events || [] })); } catch { setHistory((x) => ({ ...x, [id]: [] })); }
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement de Mon Parcours…</div>;
  if (state.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8" data-testid="parcours-error">
        <SEO title="Mon Parcours" noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Mon Parcours</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>
        {/* R7: « Se connecter » only when the session is the problem; an outage offers to try again */}
        {state.unauth ? <Button asChild className="mt-4" variant="outline"><Link to="/auth/login?next=/compte/parcours">Se connecter</Link></Button>
          : <Button className="mt-4" variant="outline" onClick={() => { setState((x) => ({ ...x, loading: true, error: '' })); load(); }} data-testid="parcours-retry">Réessayer</Button>}
      </div>
    );
  }
  const active = state.items.filter((i) => !PARCOURS_DONE.includes(i.status));
  const done = state.items.filter((i) => PARCOURS_DONE.includes(i.status));
  const renderItem = (i) => (
    <li key={i.id} data-testid="parcours-item" className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{i.title}</p>
          <p className="text-sm text-slate-700" data-testid="parcours-item-status">{PARCOURS_STATUS_LABELS[i.status]}{i.dueDate ? ` — échéance le ${formatDate(i.dueDate)}` : ''}</p>
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={open === i.id} aria-controls={`parcours-detail-${i.id}`} onClick={() => toggle(i.id)}>{open === i.id ? 'Fermer' : 'Mettre à jour'}</Button>
      </div>
      {open === i.id ? (
        <div id={`parcours-detail-${i.id}`} className="mt-3 space-y-3 border-t border-slate-200 pt-3" data-testid="parcours-detail">
          <div>
            <label htmlFor={`st-${i.id}`} className="block text-sm font-medium text-slate-800">Où en êtes-vous ?</label>
            <select id={`st-${i.id}`} data-testid="parcours-status-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={i.status}
              onChange={(e) => run(() => citizenApi.parcours({ action: 'status', id: i.id, status: e.target.value }), 'Étape mise à jour.')}>
              {Object.entries(PARCOURS_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]" onSubmit={(e) => { e.preventDefault(); run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: due.date, dueSourceUrl: due.source }), 'Échéance enregistrée.'); }}>
            <div><label htmlFor={`dd-${i.id}`} className="block text-sm text-slate-800">Échéance</label><input id={`dd-${i.id}`} data-testid="parcours-due-date" type="date" required className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.date} onChange={(e) => setDue({ ...due, date: e.target.value })} /></div>
            <div><label htmlFor={`ds-${i.id}`} className="block text-sm text-slate-800">Source officielle de cette échéance (adresse du site)</label><input id={`ds-${i.id}`} data-testid="parcours-due-source" type="url" required placeholder="https://www.service-public.fr/…" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.source} onChange={(e) => setDue({ ...due, source: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" size="sm" data-testid="parcours-due-save">Enregistrer</Button></div>
          </form>
          {i.dueDate ? <Button type="button" size="sm" variant="outline" onClick={() => run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: null }), 'Échéance retirée.')}>Retirer l’échéance</Button> : null}
          <div>
            <label htmlFor={`nt-${i.id}`} className="block text-sm text-slate-800">Note personnelle (visible par vous seul)</label>
            <textarea id={`nt-${i.id}`} data-testid="parcours-note" maxLength={500} className="mt-1 w-full rounded-md border border-slate-300 p-2" defaultValue={i.note || ''}
              onBlur={(e) => { if ((e.target.value || '') !== (i.note || '')) run(() => citizenApi.parcours({ action: 'note', id: i.id, note: e.target.value }), 'Note enregistrée.'); }} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-800">Historique de l’étape</h3>
            <ol className="mt-1 space-y-1 text-sm text-slate-700" data-testid="parcours-history">
              {(history[i.id] || []).map((ev, n) => <li key={n}>{new Date(ev.createdAt).toLocaleString('fr-FR')} — {ev.kind === 'STATUS' ? `${PARCOURS_STATUS_LABELS[ev.fromStatus] || ''} → ${PARCOURS_STATUS_LABELS[ev.toStatus] || ''}` : ev.kind === 'CREATED' ? 'Étape créée' : ev.kind === 'DEADLINE' ? 'Échéance modifiée' : 'Note modifiée'}</li>)}
            </ol>
          </div>
          <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={() => run(() => citizenApi.removeParcours(i.id), 'Étape supprimée.')}>Supprimer cette étape</Button>
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-parcours">
      <SEO title="Mon Parcours" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mon Parcours</h1>
      <p className="text-sm text-slate-700">Suivez vos démarches étape par étape. Vous indiquez vous-même où vous en êtes : AccesDirectAide ne prend aucune décision sur vos droits.</p>
      <div aria-live="polite" role="status" data-testid="parcours-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="parcours-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}

      {state.shares.length ? (
        <Card>
          <CardHeader><CardTitle className="text-lg">Suivre le plan d’un dossier</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {state.shares.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>Dossier du {formatDate(s.createdAt)}</span>
                  <Button type="button" size="sm" data-testid="parcours-import" onClick={() => run(() => citizenApi.parcours({ action: 'import', shareId: s.id }), (out) => (out && out.added ? `${out.added} étape(s) ajoutée(s) à Mon Parcours.` : 'Ce plan est déjà dans Mon Parcours.'))}>Ajouter son plan d’action</Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-lg">Étapes en cours</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {active.length ? <ul className="space-y-3" data-testid="parcours-active">{active.map(renderItem)}</ul> : <p className="text-sm text-slate-700" data-testid="parcours-empty">Aucune étape en cours.</p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await citizenApi.parcours({ action: 'add', title: newTitle }); setNewTitle(''); }, 'Étape ajoutée.'); }}>
            <div className="min-w-[240px] flex-1"><label htmlFor="pc-new" className="block text-sm text-slate-800">Ajouter une étape</label><input id="pc-new" data-testid="parcours-new-title" maxLength={200} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
            <Button type="submit" data-testid="parcours-add" disabled={newTitle.trim().length < 3}>Ajouter</Button>
          </form>
        </CardContent>
      </Card>
      {done.length ? (
        <Card><CardHeader><CardTitle className="text-lg">Étapes terminées</CardTitle></CardHeader><CardContent><ul className="space-y-3" data-testid="parcours-done">{done.map(renderItem)}</ul></CardContent></Card>
      ) : null}
    </div>
  );
}
