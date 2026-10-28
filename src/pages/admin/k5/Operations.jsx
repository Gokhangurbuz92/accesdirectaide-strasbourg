// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useK5, explain, downloadText } from './helpers.js';
import { Status, Field } from './ui.jsx';

/**
 * PKG-5 / A16 A15 A13 — platform operations (/admin/operations). Elevation: a super-administrator asks for 15 minutes with a fresh MFA code and a reason;
 * break-glass (any named MFA administrator, 30 minutes) is reviewed afterwards by ANOTHER administrator. Elevation never opens a dossier.
 * Kill switches can only force a feature OFF. The audit trail can be searched (MFA) and exported (elevation, audited).
 */
export default function AdminOperations() {
  const elev = useK5('elevation'); const plat = useK5('platform');
  const [f, setF] = useState({ code: '', reason: '', review: {}, flagReason: {}, audit: { action: '', actor: '', from: '', to: '', reason: '' } });
  const [found, setFound] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const elevation = async (action) => {
    setBusy(true); setMsg(''); setProblem('');
    try { await apiClient.admin.elevation({ action, code: f.code, reason: f.reason }); setMsg(action === 'end' ? 'Élévation terminée.' : 'Élévation accordée (durée limitée).'); set({ code: '' }); await elev.load(); }
    catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  const auditQuery = { action: f.audit.action, actor: f.audit.actor, from: f.audit.from, to: f.audit.to };
  const searchAudit = async () => {
    setProblem('');
    try { setFound(await apiClient.admin.k5('audit-log?' + new URLSearchParams(Object.entries(auditQuery).filter(([, v]) => v)).toString())); }
    catch (e) { setProblem(explain(e)); }
  };
  const exportAudit = async () => {
    if (busy) return; setBusy(true);   // R8: one export at a time (each one is journalised)
    setProblem('');
    try { const csv = await apiClient.admin.k5('audit-log', { format: 'csv', ...auditQuery, reason: f.audit.reason }); downloadText(String(csv), 'journal-audit.csv'); setMsg('Export du journal téléchargé (cet export est lui-même journalisé).'); }
    catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  const e = elev.data;
  return (
    <div className="space-y-6 p-4" data-testid="admin-operations">
      <h1 className="text-2xl font-bold">Opérations de plateforme</h1>
      <Status msg={msg || elev.msg || plat.msg} problem={problem || elev.problem || plat.problem} id="admin-ops" />
      {/* R8: a page that could not be read says so (it read « Aucune élévation active » and an empty list of switches) */}
      {elev.error || plat.error ? (
        <div role="alert" data-testid="admin-ops-load-error" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p>{[elev.error && `État de l’élévation non chargé : ${elev.error}`, plat.error && `Fonctions de la plateforme non chargées : ${plat.error}`].filter(Boolean).join(' ')}</p>
          <Button size="sm" variant="outline" className="mt-2" data-testid="admin-ops-retry" onClick={() => { elev.load(); plat.load(); }}>Réessayer</Button>
        </div>
      ) : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-elev">
        <h2 id="ops-elev" className="font-semibold">Élévation temporaire</h2>
        <p data-testid="admin-ops-elevation">{elev.error ? 'État de l’élévation inconnu (non chargé).' : e?.elevated ? `Élévation active (${e.kind === 'BREAK_GLASS' ? 'accès d’urgence' : 'ordinaire'}) jusqu’à ${new Date(e.until).toLocaleTimeString('fr-FR')}` : 'Aucune élévation active.'}{e && !e.mfa ? ' — session sans MFA : lecture seule.' : ''}</p>
        <Field id="ops-reason" label="Motif (conservé dans le journal)" value={f.reason} onChange={(v) => set({ reason: v })} rows={2} />
        <Field id="ops-code" label="Code MFA (6 chiffres)" value={f.code} onChange={(v) => set({ code: v })} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} data-testid="admin-ops-elevate" onClick={() => elevation('elevate')}>Demander 15 minutes</Button>
          <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-ops-breakglass" onClick={() => elevation('break_glass')}>Accès d’urgence (revu ensuite)</Button>
          {e?.elevated ? <Button size="sm" variant="outline" disabled={busy} onClick={() => elevation('end')}>Terminer maintenant</Button> : null}
        </div>
        {(e?.pendingBreakGlassReviews || []).length ? <h3 className="pt-2 font-semibold">Accès d’urgence à revoir (par un autre administrateur)</h3> : null}
        <ul className="space-y-2">
          {(e?.pendingBreakGlassReviews || []).map((r) => (
            <li key={r.id} className="rounded border p-2 text-sm" data-testid="admin-ops-bg">
              <p>{r.actor} — {new Date(r.openedAt).toLocaleString('fr-FR')} — {r.reason}</p>
              <details data-testid="admin-ops-bg-actions"><summary className="cursor-pointer text-blue-800">Ce qui a été fait pendant l’accès d’urgence ({(r.actions || []).length} entrée(s) du journal)</summary>
                <ul className="list-disc pl-5">{(r.actions || []).map((x, i) => <li key={i}>{new Date(x.at).toLocaleTimeString('fr-FR')} — {x.action}{x.entity ? ` — ${x.entity}` : ''}{x.entityId ? ` ${x.entityId}` : ''}</li>)}</ul>
              </details>
              <Field id={`bg-${r.id}`} label="Revue (ce qui a été vérifié dans le journal)" value={f.review[r.id] || ''} onChange={(v) => set({ review: { ...f.review, [r.id]: v } })} rows={2} />
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setProblem(''); try { await apiClient.admin.elevation({ action: 'review', id: r.id, note: f.review[r.id] || '' }); setMsg('Revue enregistrée.'); await elev.load(); } catch (x) { setProblem(explain(x)); } }}>Enregistrer la revue</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-flags">
        <h2 id="ops-flags" className="font-semibold">Interrupteurs (fermeture seulement)</h2>
        <p className="text-sm text-slate-700">Un interrupteur peut seulement FERMER une fonction ; l’ouvrir demande un changement de configuration du déploiement. Les intégrations externes (IA, SIAO, Outlook, visio, e-mail, SMS) restent fermées tant que la configuration ne les ouvre pas.</p>
        <ul className="space-y-2">
          {(plat.data?.flags || []).map((fl) => (
            <li key={fl.key} className="rounded border p-2 text-sm" data-testid="admin-ops-flag">
              <p className="font-semibold">{fl.label}</p>
              <p data-testid={`admin-ops-flag-${fl.key}`}>Configuration : {fl.environment === 'ON' ? 'ouverte' : 'fermée'} — effectif : {fl.effective === 'ON' ? 'ouvert' : 'fermé'}{fl.forcedOff ? ' (fermé par un administrateur)' : ''}</p>
              <Field id={`flag-${fl.key}`} label="Motif" value={f.flagReason[fl.key] || ''} onChange={(v) => set({ flagReason: { ...f.flagReason, [fl.key]: v } })} />
              <Button size="sm" variant="outline" disabled={plat.busy} onClick={() => plat.act({ action: 'flag', key: fl.key, forcedOff: !fl.forcedOff, reason: f.flagReason[fl.key] || '' }, fl.forcedOff ? 'Fermeture levée.' : 'Fonction fermée.')}>{fl.forcedOff ? 'Lever la fermeture' : 'Fermer cette fonction'}</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-audit">
        <h2 id="ops-audit" className="font-semibold">Journal d’audit</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field id="aud-action" label="Action (début)" value={f.audit.action} onChange={(v) => set({ audit: { ...f.audit, action: v } })} />
          <Field id="aud-actor" label="Auteur" value={f.audit.actor} onChange={(v) => set({ audit: { ...f.audit, actor: v } })} />
          <Field id="aud-from" label="Du" type="date" value={f.audit.from} onChange={(v) => set({ audit: { ...f.audit, from: v } })} />
          <Field id="aud-to" label="Au" type="date" value={f.audit.to} onChange={(v) => set({ audit: { ...f.audit, to: v } })} />
        </div>
        <Button size="sm" onClick={searchAudit} data-testid="admin-ops-audit-search">Rechercher</Button>
        {found ? (
          <ul className="space-y-1 text-sm" data-testid="admin-ops-audit-results">
            {found.items.map((i) => <li key={i.id}>{new Date(i.at).toLocaleString('fr-FR')} — {i.action} — {i.actor || '—'} — {i.entity || ''} {i.entityId || ''}</li>)}
            {!found.items.length ? <li>Aucune entrée.</li> : null}
          </ul>
        ) : null}
        <Field id="aud-reason" label="Motif de l’export (obligatoire, journalisé)" value={f.audit.reason} onChange={(v) => set({ audit: { ...f.audit, reason: v } })} />
        <Button disabled={busy} size="sm" variant="outline" onClick={exportAudit}>Exporter (CSV, élévation requise)</Button>
      </section>
    </div>
  );
}
