// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { Link } from 'react-router-dom';
import VerificationPanel from '@/components/admin/VerificationPanel';
import { PUBLIC_REASON } from '@/components/admin/reviewValue.js';

const ID_LABEL = { VERIFIED: 'Vérifiée', UNVERIFIED: 'Non vérifiée', REJECTED: 'Refusée' };
const ACT_LABEL = { actif: 'Active', suspendu: 'Suspendue', brouillon: 'Non activée (inscription)' };
const explain = (e) => {
  if (e?.status === 401 || e?.status === 403) return 'Refusé : cette action demande une session administrateur nominative avec MFA.';
  const p = e?.payload || {}; return p.message || p.error || e?.message || 'Action impossible.';
};

/**
 * PKG-5 / E01 — Organisations (/admin/organizations). Three separate checks, shown separately: identity verification (MFA review with an official source),
 * activity (active / suspended / not activated) and D-5 public visibility (derived). Only an active AND verified organization with members can receive a NEW
 * dossier access or NEW bookings. Every write needs an administrator session with MFA; the reason is kept in the audit log.
 */
export default function AdminOrganizations() {
  const [q, setQ] = useState(''); const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [form, setForm] = useState({}); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async (query = '') => {
    try { const out = await apiClient.admin.getOrganizations(query); setState({ loading: false, error: '', items: out.organizations || [] }); }
    catch (e) { setState({ loading: false, error: e?.message || 'Chargement impossible.', items: [] }); }
  }, []);
  useEffect(() => { load(''); }, [load]);
  const f = (id) => form[id] || {}; const setF = (id, patch) => setForm((x) => ({ ...x, [id]: { ...f(id), ...patch } }));
  const run = async (fn, ok) => { setBusy(true); setMsg(''); setProblem(''); try { await fn(); setMsg(ok); await load(q); } catch (e) { setProblem(explain(e)); } finally { setBusy(false); } };
  return (
    <div className="space-y-4 p-4" data-testid="admin-organizations">
      <h1 className="text-2xl font-bold">Organisations</h1>
      <p className="text-sm text-slate-700">Trois contrôles distincts : l’identité (vérifiée par une personne d’ADA avec MFA, à partir d’une source officielle), l’activité (active ou suspendue) et la publication D-5 (calculée). Une organisation ne peut recevoir un NOUVEL accès à un dossier ou de NOUVEAUX rendez-vous que si elle est active, vérifiée et a des membres actifs. Rien de ce qui existe n’est supprimé ni annulé automatiquement.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <label htmlFor="org-q" className="sr-only">Rechercher</label>
        <input id="org-q" className="rounded border p-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou ville" />
        <Button type="submit" variant="outline">Rechercher</Button>
      </form>
      {state.error ? <p role="alert" className="text-red-800">{state.error}</p> : null}
      {problem ? <p role="alert" className="text-red-800" data-testid="admin-org-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid="admin-org-status">{msg}</div>
      {state.loading ? <p role="status">Chargement…</p> : (
        <ul className="space-y-3">
          {state.items.map((o) => (
            <li key={o.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-org">
              <p className="font-semibold">{o.nom} <span className="font-normal text-slate-700">— {o.ville || '—'}</span></p>
              <dl className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {/* owner LAB audit (2026-10-25): a record a reviewer put on hold says so (it showed « Non vérifiée »); the public reasons are in French, not codes */}
                <div><dt className="text-slate-700">Identité</dt><dd data-testid="admin-org-identity">{o.publicationHold && o.identity !== 'REJECTED' ? 'En attente (décision d’une personne)' : (ID_LABEL[o.identity] || o.identity)}</dd></div>
                <div><dt className="text-slate-700">Activité</dt><dd data-testid="admin-org-activity">{ACT_LABEL[o.statut] || o.statut}</dd></div>
                <div><dt className="text-slate-700">Publication D-5</dt><dd data-testid="admin-org-public">{o.public.visible ? 'Publique' : `Non publique : ${o.public.reasons.map((x) => PUBLIC_REASON[x] || x).join(', ')}`}</dd></div>
                <div><dt className="text-slate-700">Peut recevoir</dt><dd data-testid="admin-org-can-receive">{o.canReceiveNew ? 'Oui' : 'Non'} ({o.activeMembers} membre(s) actif(s))</dd></div>
              </dl>
              {o.publicationHold ? <p className="text-slate-800" data-testid="admin-org-hold-reason">Motif de l’attente : {o.publicationHold}</p> : null}
              <p><Link className="text-blue-800 underline" to={`/admin/structures/${o.id}`}>Corriger la fiche dans l’éditeur</Link></p>
              <details onToggle={(e) => setF(o.id, { open: e.currentTarget.open })}>
                <summary className="cursor-pointer text-blue-800">Agir</summary>
                <div className="mt-2 space-y-3">
                  {/* owner LAB audit: identity verification is the D-5 verification of the structure record (it also makes it publishable): the reviewer reads the
                      record, confirms the territory explicitly (it used to be sent as confirmed), and the decision is bound to the version read */}
                  <section aria-label="Vérification de l’identité et de la fiche" className="space-y-1">
                    <h2 className="text-base font-semibold">Identité et fiche (vérification D-5)</h2>
                    {f(o.id).open ? <VerificationPanel entityType="structure" entityId={o.id} testIdPrefix="admin-org" verifyLabel="Vérifier l’identité et la fiche" onDone={(m) => { setProblem(''); setMsg(m); load(q); }} onProblem={setProblem} /> : null}
                  </section>
                  <section aria-label="Activité de l’organisation" className="space-y-1">
                    <h2 className="text-base font-semibold">Activité</h2>
                    <label className="block" htmlFor={`why-${o.id}`}>Motif (conservé dans le journal)</label>
                    <textarea id={`why-${o.id}`} className="w-full rounded border p-2" rows={2} value={f(o.id).reason || ''} onChange={(e) => setF(o.id, { reason: e.target.value })} />
                  </section>
                  <div className="flex flex-wrap gap-2">
                    {o.statut === 'actif'
                      ? <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-org-suspend" onClick={() => run(() => apiClient.admin.setOrganizationActivity(o.id, 'SUSPEND', f(o.id).reason || ''), 'Organisation suspendue.')}>Suspendre</Button>
                      : <Button size="sm" variant="outline" disabled={busy} data-testid="admin-org-reactivate" onClick={() => run(() => apiClient.admin.setOrganizationActivity(o.id, 'REACTIVATE', f(o.id).reason || ''), 'Organisation réactivée.')}>Réactiver</Button>}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
