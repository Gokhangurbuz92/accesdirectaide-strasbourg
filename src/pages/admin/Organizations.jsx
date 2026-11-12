// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { Link, useSearchParams } from 'react-router-dom';
import VerificationPanel from '@/components/admin/VerificationPanel';
import { publicReason } from '@/components/admin/reviewValue.js';
import i18n, { useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { fieldA11y, minLengthMessage, requiredMessage } from '@/lib/fieldErrors';

const ID_LABEL = () => ({ VERIFIED: i18n.t('admin:organizations.identity.verified', 'Vérifiée'), UNVERIFIED: i18n.t('admin:organizations.identity.unverified', 'Non vérifiée'), REJECTED: i18n.t('admin:organizations.identity.rejected', 'Refusée') });
const ACT_LABEL = () => ({ actif: i18n.t('admin:organizations.activity.active', 'Active'), suspendu: i18n.t('admin:organizations.activity.suspended', 'Suspendue'), brouillon: i18n.t('admin:organizations.activity.not_activated', 'Non activée (inscription)') });
const explain = (e) => {
  if (e?.status === 401 || e?.status === 403) return i18n.t('admin:organizations.refused_mfa', 'Refusé : cette action demande une session administrateur nominative avec MFA.');
  const p = e?.payload || {}; return p.message || p.error || e?.message || i18n.t('admin:organizations.action_impossible', 'Action impossible.');
};

/**
 * PKG-5 / E01 — Organisations (/admin/organizations). Three separate checks, shown separately: identity verification (MFA review with an official source),
 * activity (active / suspended / not activated) and D-5 public visibility (derived). Only an active AND verified organization with members can receive a NEW
 * dossier access or NEW bookings. Every write needs an administrator session with MFA; the reason is kept in the audit log.
 */
const DECISIONS = ['never', 'hold', 'rejected', 'verified'];

export default function AdminOrganizations() {
  const { t } = useT('admin');
  const fr = useFrAttrs();   // R47: the structure's name and town stay French (lang="fr" outside French)
  const [q, setQ] = useState(''); const [state, setState] = useState({ loading: true, error: '', items: [], total: 0, limit: 0 });
  // UX ecosystem (2026-11-12): a decision filter, set from the « À traiter » card (?decision=never), and how many organisations match (the list stops at 200)
  const [params, setParams] = useSearchParams(); const decision = DECISIONS.includes(params.get('decision') || '') ? params.get('decision') : '';
  const [form, setForm] = useState({}); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async (query = '') => {
    try { const out = await apiClient.admin.getOrganizations(query, decision); setState({ loading: false, error: '', items: out.organizations || [], total: out.total ?? (out.organizations || []).length, limit: out.limit || 0 }); }
    catch (e) { setState({ loading: false, error: e?.message || t('admin:organizations.load_impossible', 'Chargement impossible.'), items: [], total: 0, limit: 0 }); }
  }, [decision]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(q); }, [load]);   // eslint-disable-line react-hooks/exhaustive-deps -- the search is applied on submit
  const f = (id) => form[id] || {}; const setF = (id, patch) => setForm((x) => ({ ...x, [id]: { ...f(id), ...patch } }));
  // R43 (A5): the reason is mandatory on the server (5 characters, kept in the audit log); it is checked first, with its own message and a focused summary
  const reasonErr = useFormErrors();
  const reasonOk = (id) => {
    const why = String(f(id).reason || '').trim(); const lbl = t('admin:organizations.reason_label', 'Motif (conservé dans le journal)');
    return reasonErr.check(why.length >= 5 ? {} : { [`why-${id}`]: why ? minLengthMessage(t, lbl, 5) : requiredMessage(t, lbl) });
  };
  const run = async (fn, ok) => { setBusy(true); setMsg(''); setProblem(''); try { await fn(); setMsg(ok); await load(q); } catch (e) { setProblem(explain(e)); } finally { setBusy(false); } };
  return (
    <div className="space-y-4 p-4" data-testid="admin-organizations">
      <h1 className="text-2xl font-bold">{t('admin:organizations.title', 'Organisations')}</h1>
      <p className="text-sm text-slate-700">{t('admin:organizations.intro', 'Trois contrôles distincts : l’identité (vérifiée par une personne d’ADA avec MFA, à partir d’une source officielle), l’activité (active ou suspendue) et la publication D-5 (calculée). Une organisation ne peut recevoir un NOUVEL accès à un dossier ou de NOUVEAUX rendez-vous que si elle est active, vérifiée et a des membres actifs. Rien de ce qui existe n’est supprimé ni annulé automatiquement.')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <label htmlFor="org-q" className="sr-only">{t('admin:organizations.search', 'Rechercher')}</label>
        <input id="org-q" className="rounded border p-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin:organizations.search_placeholder', 'Nom ou ville')} />
        <Button type="submit" variant="outline">{t('admin:organizations.search', 'Rechercher')}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="org-decision">{t('admin:organizations.decision_filter', 'Décision')}</label>
        <select id="org-decision" className="min-h-11 rounded border p-2" value={decision} data-testid="admin-org-decision"
          onChange={(e) => { const next = new URLSearchParams(params); if (e.target.value) next.set('decision', e.target.value); else next.delete('decision'); setParams(next, { replace: true }); }}>
          <option value="">{t('admin:organizations.decision.all', 'Toutes')}</option>
          <option value="never">{t('admin:organizations.decision.never', 'Sans décision')}</option>
          <option value="hold">{t('admin:organizations.decision.hold', 'En attente (décision d’une personne)')}</option>
          <option value="rejected">{t('admin:organizations.decision.rejected', 'Refusées')}</option>
          <option value="verified">{t('admin:organizations.decision.verified', 'Vérifiées')}</option>
        </select>
        {!state.loading && !state.error ? <span className="text-slate-700" data-testid="admin-org-count">{t('admin:organizations.count', '{{shown}} affichée(s) sur {{total}}', { shown: state.items.length, total: state.total })}</span> : null}
      </div>
      {!state.loading && state.total > state.items.length ? <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="admin-org-truncated">{t('admin:organizations.truncated', 'La liste s’arrête aux {{shown}} premières par ordre alphabétique : recherchez par nom ou ville, ou choisissez une décision.', { shown: state.items.length })}</p> : null}
      {state.error ? <p role="alert" className="text-red-800">{state.error}</p> : null}
      {problem ? <p role="alert" className="text-red-800" data-testid="admin-org-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid="admin-org-status" className={busy || msg ? 'sticky top-20 z-10 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-900 md:top-0' : ''}>{busy ? t('common:form.status.saving', 'Enregistrement en cours…') : msg}</div>
      {state.loading ? <p role="status">{t('admin:organizations.loading', 'Chargement…')}</p> : (
        <ul className="space-y-3">
          {!state.error && state.items.length === 0 ? <li className="text-slate-700" data-testid="admin-org-empty">{decision ? t('admin:organizations.empty_decision', 'Aucune organisation pour cette décision : rien à traiter ici.') : t('admin:organizations.empty', 'Aucune organisation ne correspond.')}</li> : null}
          {state.items.map((o) => (
            <li key={o.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-org">
              <p className="font-semibold"><span {...fr}>{o.nom}</span> <span className="font-normal text-slate-700">— <span {...fr}>{o.ville || '—'}</span></span></p>
              <dl className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {/* owner LAB audit (2026-10-25): a record a reviewer put on hold says so (it showed « Non vérifiée »); the public reasons are in French, not codes */}
                <div><dt className="text-slate-700">{t('admin:organizations.identity', 'Identité')}</dt><dd data-testid="admin-org-identity">{o.publicationHold && o.identity !== 'REJECTED' ? t('admin:organizations.identity.on_hold', 'En attente (décision d’une personne)') : (ID_LABEL()[o.identity] || o.identity)}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.activity', 'Activité')}</dt><dd data-testid="admin-org-activity">{ACT_LABEL()[o.statut] || o.statut}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.publication', 'Publication D-5')}</dt><dd data-testid="admin-org-public">{o.public.visible ? t('admin:organizations.public', 'Publique') : t('admin:organizations.not_public', 'Non publique : {{reasons}}', { reasons: o.public.reasons.map((x) => publicReason(x)).join(', ') })}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.can_receive', 'Peut recevoir')}</dt><dd data-testid="admin-org-can-receive">{o.canReceiveNew ? t('admin:organizations.yes', 'Oui') : t('admin:organizations.no', 'Non')} {t('admin:organizations.active_members', '({{n}} membre(s) actif(s))', { n: o.activeMembers })}</dd></div>
              </dl>
              {o.publicationHold ? <p className="text-slate-800" data-testid="admin-org-hold-reason">{t('admin:organizations.hold_reason', 'Motif de l’attente : {{reason}}', { reason: o.publicationHold })}</p> : null}
              <p><Link className="text-blue-800 underline" to={`/admin/structures/${o.id}`}>{t('admin:organizations.fix_in_editor', 'Corriger la fiche dans l’éditeur')}</Link></p>
              <details onToggle={(e) => setF(o.id, { open: e.currentTarget.open })}>
                <summary className="cursor-pointer text-blue-800">{t('admin:organizations.act', 'Agir')}</summary>
                <div className="mt-2 space-y-3">
                  {/* owner LAB audit: identity verification is the D-5 verification of the structure record (it also makes it publishable): the reviewer reads the
                      record, confirms the territory explicitly (it used to be sent as confirmed), and the decision is bound to the version read */}
                  <section aria-label={t('admin:organizations.verification_section', 'Vérification de l’identité et de la fiche')} className="space-y-1">
                    <h2 className="text-base font-semibold">{t('admin:organizations.verification_title', 'Identité et fiche (vérification D-5)')}</h2>
                    {f(o.id).open ? <VerificationPanel entityType="structure" entityId={o.id} testIdPrefix="admin-org" verifyLabel={t('admin:organizations.verify_label', 'Vérifier l’identité et la fiche')} onDone={(m) => { setProblem(''); setMsg(m); load(q); }} onProblem={setProblem} /> : null}
                  </section>
                  <section aria-label={t('admin:organizations.activity_section', 'Activité de l’organisation')} className="space-y-1" aria-busy={busy || undefined}>
                    <h2 className="text-base font-semibold">{t('admin:organizations.activity', 'Activité')}</h2>
                    <ErrorSummary ref={reasonErr.summaryRef} errors={reasonErr.errors} order={[`why-${o.id}`]} testid={`admin-org-errors-${o.id}`} />
                    <label className="block" htmlFor={`why-${o.id}`}>{t('admin:organizations.reason_label', 'Motif (conservé dans le journal)')}</label>
                    <textarea id={`why-${o.id}`} aria-required="true" className="w-full rounded border p-2" rows={2} value={f(o.id).reason || ''} {...fieldA11y(`why-${o.id}`, reasonErr.errors)} onChange={(e) => { setF(o.id, { reason: e.target.value }); reasonErr.clear(`why-${o.id}`); }} />
                    <FieldError field={`why-${o.id}`} errors={reasonErr.errors} />
                  </section>
                  <div className="flex flex-wrap gap-2">
                    {o.statut === 'actif'
                      ? <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-org-suspend" onClick={() => reasonOk(o.id) && run(() => apiClient.admin.setOrganizationActivity(o.id, 'SUSPEND', f(o.id).reason || ''), t('admin:organizations.done.suspended', 'Organisation suspendue.'))}>{t('admin:organizations.suspend', 'Suspendre')}</Button>
                      : <Button size="sm" variant="outline" disabled={busy} data-testid="admin-org-reactivate" onClick={() => reasonOk(o.id) && run(() => apiClient.admin.setOrganizationActivity(o.id, 'REACTIVATE', f(o.id).reason || ''), t('admin:organizations.done.reactivated', 'Organisation réactivée.'))}>{t('admin:organizations.reactivate', 'Réactiver')}</Button>}
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
