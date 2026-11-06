// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useK5, explain, downloadText } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT, formatDateTime, formatTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * PKG-5 / A16 A15 A13 — platform operations (/admin/operations). Elevation: a super-administrator asks for 15 minutes with a fresh MFA code and a reason;
 * break-glass (any named MFA administrator, 30 minutes) is reviewed afterwards by ANOTHER administrator. Elevation never opens a dossier.
 * Kill switches can only force a feature OFF. The audit trail can be searched (MFA) and exported (elevation, audited).
 */
export default function AdminOperations() {
  const { t } = useT('admin');
  const fr = useFrAttrs();
  // R47: the switches the server lists (api/_services/feature-flags.js) are named by their key in the interface language; an unknown key keeps the server's
  // French label, marked lang="fr"
  const FLAG_LABEL = { PUBLIC_FEEDBACK: t('admin:k5.operations.flag.public_feedback', 'Signalements de contenu et suggestions de structures (public)'), SUPPORT_FORM: t('admin:k5.operations.flag.support_form', 'Formulaire d’aide (support)'),
    OPEN_DATA_EXPORT: t('admin:k5.operations.flag.open_data_export', 'Export statistique territorial (licence à décider par le propriétaire)') };
  const elev = useK5('elevation'); const plat = useK5('platform');
  const [f, setF] = useState({ code: '', reason: '', review: {}, flagReason: {}, audit: { action: '', actor: '', from: '', to: '', reason: '' } });
  const [found, setFound] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const elevation = async (action) => {
    setBusy(true); setMsg(''); setProblem('');
    try { await apiClient.admin.elevation({ action, code: f.code, reason: f.reason }); setMsg(action === 'end' ? t('admin:k5.operations.elevation_ended', 'Élévation terminée.') : t('admin:k5.operations.elevation_granted', 'Élévation accordée (durée limitée).')); set({ code: '' }); await elev.load(); }
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
    try { const csv = await apiClient.admin.k5('audit-log', { format: 'csv', ...auditQuery, reason: f.audit.reason }); downloadText(String(csv), 'journal-audit.csv'); setMsg(t('admin:k5.operations.exported', 'Export du journal téléchargé (cet export est lui-même journalisé).')); }
    catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  const e = elev.data;
  return (
    <div className="space-y-6 p-4" data-testid="admin-operations">
      <h1 className="text-2xl font-bold">{t('admin:k5.operations.title', 'Opérations de plateforme')}</h1>
      <Status msg={msg || elev.msg || plat.msg} problem={problem || elev.problem || plat.problem} id="admin-ops" />
      {/* R8: a page that could not be read says so (it read « Aucune élévation active » and an empty list of switches) */}
      {elev.error || plat.error ? (
        <div role="alert" data-testid="admin-ops-load-error" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p>{[elev.error && t('admin:k5.operations.elev_not_loaded', 'État de l’élévation non chargé : {{why}}', { why: elev.error }), plat.error && t('admin:k5.operations.plat_not_loaded', 'Fonctions de la plateforme non chargées : {{why}}', { why: plat.error })].filter(Boolean).join(' ')}</p>
          <Button size="sm" variant="outline" className="mt-2" data-testid="admin-ops-retry" onClick={() => { elev.load(); plat.load(); }}>{t('admin:k5.operations.retry', 'Réessayer')}</Button>
        </div>
      ) : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-elev">
        <h2 id="ops-elev" className="font-semibold">{t('admin:k5.operations.elevation_heading', 'Élévation temporaire')}</h2>
        <p data-testid="admin-ops-elevation">{elev.error ? t('admin:k5.operations.elevation_unknown', 'État de l’élévation inconnu (non chargé).') : e?.elevated ? t('admin:k5.operations.elevation_active', 'Élévation active ({{kind}}) jusqu’à {{time}}', { kind: e.kind === 'BREAK_GLASS' ? t('admin:k5.operations.kind_break_glass', 'accès d’urgence') : t('admin:k5.operations.kind_ordinary', 'ordinaire'), time: formatTime(e.until) }) : t('admin:k5.operations.no_elevation', 'Aucune élévation active.')}{e && !e.mfa ? t('admin:k5.operations.no_mfa', ' — session sans MFA : lecture seule.') : ''}</p>
        <Field id="ops-reason" label={t('admin:k5.operations.reason', 'Motif (conservé dans le journal)')} value={f.reason} onChange={(v) => set({ reason: v })} rows={2} />
        <Field id="ops-code" label={t('admin:k5.operations.mfa_code', 'Code MFA (6 chiffres)')} value={f.code} onChange={(v) => set({ code: v })} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} data-testid="admin-ops-elevate" onClick={() => elevation('elevate')}>{t('admin:k5.operations.elevate', 'Demander 15 minutes')}</Button>
          <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-ops-breakglass" onClick={() => elevation('break_glass')}>{t('admin:k5.operations.break_glass', 'Accès d’urgence (revu ensuite)')}</Button>
          {e?.elevated ? <Button size="sm" variant="outline" disabled={busy} onClick={() => elevation('end')}>{t('admin:k5.operations.end_now', 'Terminer maintenant')}</Button> : null}
        </div>
        {(e?.pendingBreakGlassReviews || []).length ? <h3 className="pt-2 font-semibold">{t('admin:k5.operations.bg_to_review', 'Accès d’urgence à revoir (par un autre administrateur)')}</h3> : null}
        <ul className="space-y-2">
          {(e?.pendingBreakGlassReviews || []).map((r) => (
            <li key={r.id} className="rounded border p-2 text-sm" data-testid="admin-ops-bg">
              <p>{r.actor} — {formatDateTime(r.openedAt)} — {r.reason}</p>
              <details data-testid="admin-ops-bg-actions"><summary className="cursor-pointer text-blue-800">{t('admin:k5.operations.bg_actions', 'Ce qui a été fait pendant l’accès d’urgence ({{n}} entrée(s) du journal)', { n: (r.actions || []).length })}</summary>
                <ul className="list-disc pl-5">{(r.actions || []).map((x, i) => <li key={i}>{formatTime(x.at)} — {x.action}{x.entity ? ` — ${x.entity}` : ''}{x.entityId ? ` ${x.entityId}` : ''}</li>)}</ul>
              </details>
              <Field id={`bg-${r.id}`} label={t('admin:k5.operations.review_label', 'Revue (ce qui a été vérifié dans le journal)')} value={f.review[r.id] || ''} onChange={(v) => set({ review: { ...f.review, [r.id]: v } })} rows={2} />
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setProblem(''); try { await apiClient.admin.elevation({ action: 'review', id: r.id, note: f.review[r.id] || '' }); setMsg(t('admin:k5.operations.review_saved', 'Revue enregistrée.')); await elev.load(); } catch (x) { setProblem(explain(x)); } }}>{t('admin:k5.operations.save_review', 'Enregistrer la revue')}</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-flags">
        <h2 id="ops-flags" className="font-semibold">{t('admin:k5.operations.flags_heading', 'Interrupteurs (fermeture seulement)')}</h2>
        <p className="text-sm text-slate-700">{t('admin:k5.operations.flags_intro', 'Un interrupteur peut seulement FERMER une fonction ; l’ouvrir demande un changement de configuration du déploiement. Les intégrations externes (IA, SIAO, Outlook, visio, e-mail, SMS) restent fermées tant que la configuration ne les ouvre pas.')}</p>
        <ul className="space-y-2">
          {(plat.data?.flags || []).map((fl) => (
            <li key={fl.key} className="rounded border p-2 text-sm" data-testid="admin-ops-flag">
              {FLAG_LABEL[fl.key] ? <p className="font-semibold">{FLAG_LABEL[fl.key]}</p> : <p className="font-semibold" {...fr}>{fl.label}</p>}
              <p data-testid={`admin-ops-flag-${fl.key}`}>{t('admin:k5.operations.flag_state', 'Configuration : {{env}} — effectif : {{effective}}', { env: fl.environment === 'ON' ? t('admin:k5.operations.env_open', 'ouverte') : t('admin:k5.operations.env_closed', 'fermée'), effective: fl.effective === 'ON' ? t('admin:k5.operations.eff_open', 'ouvert') : t('admin:k5.operations.eff_closed', 'fermé') })}{fl.forcedOff ? t('admin:k5.operations.forced_off', ' (fermé par un administrateur)') : ''}</p>
              <Field id={`flag-${fl.key}`} label={t('admin:k5.operations.flag_reason', 'Motif')} value={f.flagReason[fl.key] || ''} onChange={(v) => set({ flagReason: { ...f.flagReason, [fl.key]: v } })} />
              <Button size="sm" variant="outline" disabled={plat.busy} onClick={() => plat.act({ action: 'flag', key: fl.key, forcedOff: !fl.forcedOff, reason: f.flagReason[fl.key] || '' }, fl.forcedOff ? t('admin:k5.operations.lifted', 'Fermeture levée.') : t('admin:k5.operations.closed', 'Fonction fermée.'))}>{fl.forcedOff ? t('admin:k5.operations.lift', 'Lever la fermeture') : t('admin:k5.operations.close', 'Fermer cette fonction')}</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="ops-audit">
        <h2 id="ops-audit" className="font-semibold">{t('admin:k5.operations.audit_heading', 'Journal d’audit')}</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field id="aud-action" label={t('admin:k5.operations.audit_action', 'Action (début)')} value={f.audit.action} onChange={(v) => set({ audit: { ...f.audit, action: v } })} />
          <Field id="aud-actor" label={t('admin:k5.operations.audit_actor', 'Auteur')} value={f.audit.actor} onChange={(v) => set({ audit: { ...f.audit, actor: v } })} />
          <Field id="aud-from" label={t('admin:k5.operations.audit_from', 'Du')} type="date" value={f.audit.from} onChange={(v) => set({ audit: { ...f.audit, from: v } })} />
          <Field id="aud-to" label={t('admin:k5.operations.audit_to', 'Au')} type="date" value={f.audit.to} onChange={(v) => set({ audit: { ...f.audit, to: v } })} />
        </div>
        <Button size="sm" onClick={searchAudit} data-testid="admin-ops-audit-search">{t('admin:k5.operations.search', 'Rechercher')}</Button>
        {found ? (
          <ul className="space-y-1 text-sm" data-testid="admin-ops-audit-results">
            {found.items.map((i) => <li key={i.id}>{formatDateTime(i.at)} — {i.action} — {i.actor || '—'} — {i.entity || ''} {i.entityId || ''}</li>)}
            {!found.items.length ? <li>{t('admin:k5.operations.no_entry', 'Aucune entrée.')}</li> : null}
          </ul>
        ) : null}
        <Field id="aud-reason" label={t('admin:k5.operations.export_reason', 'Motif de l’export (obligatoire, journalisé)')} value={f.audit.reason} onChange={(v) => set({ audit: { ...f.audit, reason: v } })} />
        <Button disabled={busy} size="sm" variant="outline" onClick={exportAudit}>{t('admin:k5.operations.export', 'Exporter (CSV, élévation requise)')}</Button>
      </section>
    </div>
  );
}
