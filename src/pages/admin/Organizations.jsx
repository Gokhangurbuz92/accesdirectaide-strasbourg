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
const DECISIONS = ['never', 'hold', 'rejected', 'verified', 'pro_pending'];
const ROLE_LABEL = () => ({ STRUCTURE_ADMIN: i18n.t('admin:organizations.members.role_admin', 'Administrateur de la structure'), PRO: i18n.t('admin:organizations.members.role_pro', 'Professionnel') });

/**
 * G14 (owner 23/11/2026: ADA Pro opens without a pilot structure) — a structure's own sign-up request (api/_services/pro-self-registration.js). « Vérifier et
 * activer »: the structure is verified on an official source (note ≥ 20 characters, https source of an allowed domain, territory confirmed, bound to the
 * version of the record read above), activated, and its administrator receives the e-mail that opens the second factor — in one step. « Refuser »: the
 * pending account is disabled with the reason of the card (kept in the journal).
 */
function PendingRegistration({ orgId, member, activeMembers, busy, reasonOk, reason, run, onChanged }) {
  const { t } = useT('admin');
  const [v, setV] = useState({ sourceUrl: '', note: '', territory: false, version: '' });
  const errs = useFormErrors();
  useEffect(() => { let live = true; apiClient.admin.getVerification('structure', orgId).then((r) => { if (live) setV((x) => ({ ...x, version: r.version || '' })); }).catch(() => {}); return () => { live = false; }; }, [orgId]);
  const id = (k) => `pro-reg-${k}-${member.id}`;
  const check = () => {
    const e = {};
    if (!/^https:\/\//.test(v.sourceUrl.trim())) e[id('source')] = t('admin:organizations.pro_registration.source_required', 'Indiquez l’adresse https de la source officielle consultée (annuaire des entreprises, INSEE, Journal officiel…).');
    if (v.note.trim().length < 20) e[id('note')] = minLengthMessage(t, t('admin:organizations.pro_registration.note_label', 'Ce que la source montre (au moins 20 caractères)'), 20);
    if (!v.territory) e[id('territory')] = t('admin:organizations.pro_registration.territory_required', 'Confirmez le territoire de la structure.');
    return errs.check(e);
  };
  const activate = () => check() && run(async () => {
    await apiClient.admin.verifyAndActivateProRegistration(member.id, { sourceUrl: v.sourceUrl.trim(), evidenceNote: v.note.trim(), territoryConfirmed: v.territory === true, expectedVersion: v.version });
    await onChanged();
  }, t('admin:organizations.pro_registration.done_activated', 'Structure vérifiée et activée : l’e-mail d’activation de la double authentification a été remis à la messagerie.'));
  const refuse = () => reasonOk() && run(async () => { await apiClient.admin.refuseProRegistration(member.id, reason); await onChanged(); },
    t('admin:organizations.pro_registration.done_refused', 'Demande refusée : le compte est désactivé, le motif est conservé dans le journal.'));
  return (
    <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-950" data-testid="admin-org-pro-registration">
      <p className="font-semibold">{t('admin:organizations.pro_registration.title', 'Demande d’inscription ADA Pro à vérifier')}</p>
      <p>{t('admin:organizations.pro_registration.intro', 'Vérifiez la structure et son SIRET sur une source officielle, puis lisez la fiche ci-dessus. « Vérifier et activer » vérifie la fiche, active l’organisation et envoie à cette personne le lien d’activation de la double authentification.')}</p>
      {activeMembers > 0 ? <p className="font-semibold" data-testid="admin-org-pro-registration-existing">{t('admin:organizations.pro_registration.existing_members', 'Attention : cette organisation a déjà {{n}} membre(s) actif(s). Cette personne en deviendrait administratrice.', { n: activeMembers })}</p> : null}
      <ErrorSummary ref={errs.summaryRef} errors={errs.errors} order={[id('source'), id('note'), id('territory')]} testid={`admin-org-pro-registration-errors-${member.id}`} />
      <label className="block" htmlFor={id('source')}>{t('admin:organizations.pro_registration.source_label', 'Source officielle consultée (adresse https)')}</label>
      <input id={id('source')} type="url" aria-required="true" className="w-full rounded border bg-white p-2" value={v.sourceUrl} {...fieldA11y(id('source'), errs.errors)} onChange={(e) => { setV((x) => ({ ...x, sourceUrl: e.target.value })); errs.clear(id('source')); }} />
      <FieldError field={id('source')} errors={errs.errors} />
      <label className="block" htmlFor={id('note')}>{t('admin:organizations.pro_registration.note_label', 'Ce que la source montre (au moins 20 caractères)')}</label>
      <textarea id={id('note')} aria-required="true" className="w-full rounded border bg-white p-2" rows={2} value={v.note} {...fieldA11y(id('note'), errs.errors)} onChange={(e) => { setV((x) => ({ ...x, note: e.target.value })); errs.clear(id('note')); }} />
      <FieldError field={id('note')} errors={errs.errors} />
      <label className="flex items-center gap-2" htmlFor={id('territory')}>
        <input id={id('territory')} type="checkbox" checked={v.territory} {...fieldA11y(id('territory'), errs.errors)} onChange={(e) => { setV((x) => ({ ...x, territory: e.target.checked })); errs.clear(id('territory')); }} />
        {t('admin:organizations.pro_registration.territory_label', 'Je confirme le territoire de la structure')}
      </label>
      <FieldError field={id('territory')} errors={errs.errors} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !v.version} data-testid="admin-org-pro-registration-activate" onClick={activate}>{t('admin:organizations.pro_registration.activate', 'Vérifier et activer')}</Button>
        <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-org-pro-registration-refuse" onClick={refuse}>{t('admin:organizations.pro_registration.refuse', 'Refuser')}</Button>
      </div>
    </div>
  );
}

/**
 * G8 (pilot onboarding) — the organization's ADA Pro accounts, and ADA's own two actions on ONE account (api/_services/pro-account-admin.js): disable an active
 * account (incident, lost device while the structure administrator is away — refused while the member still holds work to hand over) and erase a disabled
 * one (a former member's erasure request). Same reason field and MFA rule as the activity actions.
 */
function MembersPanel({ orgId, activeMembers = 0, busy, reasonOk, reason, run }) {
  const { t } = useT('admin');
  const [state, setState] = useState({ loading: true, error: '', members: [] });
  const load = useCallback(async () => {
    try { const out = await apiClient.admin.getOrganizationMembers(orgId); setState({ loading: false, error: '', members: out.members || [] }); }
    catch { setState({ loading: false, error: t('admin:organizations.members.load_impossible', 'Les comptes n’ont pas pu être chargés.'), members: [] }); }
  }, [orgId]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const act = (action, userId, ok) => reasonOk() && run(async () => { await apiClient.admin.administerProAccount(userId, action, reason); await load(); }, ok);
  return (
    <section aria-label={t('admin:organizations.members.title', 'Comptes ADA Pro')} className="space-y-1" data-testid="admin-org-members">
      <h2 className="text-base font-semibold">{t('admin:organizations.members.title', 'Comptes ADA Pro')}</h2>
      <p className="text-slate-700">{t('admin:organizations.members.intro', 'L’administrateur de la structure gère son équipe. ADA peut désactiver un compte en cas d’incident (s’il ne détient plus de dossier, de proposition, de rendez-vous ni de rôle de référent) et effacer un compte déjà désactivé à la demande de la personne. Le motif ci-dessus est conservé dans le journal.')}</p>
      {state.loading ? <p role="status">{t('admin:organizations.loading', 'Chargement…')}</p> : state.error ? <p role="alert" className="text-red-800">{state.error}</p> : state.members.length === 0
        ? <p className="text-slate-700" data-testid="admin-org-members-empty">{t('admin:organizations.members.none', 'Aucun compte ADA Pro pour cette organisation.')}</p>
        : (
          <ul className="space-y-1">
            {state.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2" data-testid="admin-org-member">
                <span>{m.erased ? t('admin:organizations.members.erased', 'Compte effacé') : m.email}</span>
                <span className="text-slate-700">— {ROLE_LABEL()[m.role] || m.role} · {m.status === 'active' ? t('admin:organizations.members.active', 'actif') : m.status === 'pending_verification' ? t('admin:organizations.members.pending_verification', 'inscription à vérifier') : t('admin:organizations.members.disabled', 'désactivé')}</span>
                {m.status === 'active' ? <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-org-member-disable"
                  onClick={() => act('DISABLE_PRO_ACCOUNT', m.id, t('admin:organizations.members.done_disabled', 'Compte désactivé : ses sessions sont terminées.'))}>{t('admin:organizations.members.disable', 'Désactiver ce compte')}</Button> : null}
                {m.status === 'pending_verification' ? <div className="w-full"><PendingRegistration orgId={orgId} member={m} activeMembers={activeMembers} busy={busy} reasonOk={reasonOk} reason={reason} run={run} onChanged={load} /></div> : null}
                {m.status !== 'active' && m.status !== 'pending_verification' && !m.erased ? <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="admin-org-member-erase"
                  onClick={() => act('ERASE_PRO_ACCOUNT', m.id, t('admin:organizations.members.done_erased', 'Compte effacé : adresse, mot de passe et double authentification supprimés.'))}>{t('admin:organizations.members.erase', 'Effacer ce compte (demande de la personne)')}</Button> : null}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

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
          <option value="pro_pending">{t('admin:organizations.decision.pro_pending', 'Inscriptions ADA Pro à vérifier')}</option>
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
              {o.pendingRegistrations > 0 ? <p><span className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 font-semibold text-amber-950" data-testid="admin-org-pro-pending">{t('admin:organizations.pro_registration.badge', '{{n}} inscription(s) ADA Pro à vérifier (Agir)', { n: o.pendingRegistrations })}</span></p> : null}
              {o.siret ? <p className="text-slate-800" data-testid="admin-org-siret">{t('admin:organizations.siret', 'SIRET')} : <code>{o.siret}</code></p> : null}
              <dl className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {/* owner LAB audit (2026-10-25): a record a reviewer put on hold says so (it showed « Non vérifiée »); the public reasons are in French, not codes */}
                <div><dt className="text-slate-700">{t('admin:organizations.identity', 'Identité')}</dt><dd data-testid="admin-org-identity">{o.publicationHold && o.identity !== 'REJECTED' ? t('admin:organizations.identity.on_hold', 'En attente (décision d’une personne)') : (ID_LABEL()[o.identity] || o.identity)}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.activity', 'Activité')}</dt><dd data-testid="admin-org-activity">{ACT_LABEL()[o.statut] || o.statut}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.publication', 'Publication D-5')}</dt><dd data-testid="admin-org-public">{o.public.visible ? t('admin:organizations.public', 'Publique') : t('admin:organizations.not_public', 'Non publique : {{reasons}}', { reasons: o.public.reasons.map((x) => publicReason(x)).join(', ') })}</dd></div>
                <div><dt className="text-slate-700">{t('admin:organizations.can_receive', 'Peut recevoir')}</dt><dd data-testid="admin-org-can-receive">{o.canReceiveNew ? t('admin:organizations.yes', 'Oui') : t('admin:organizations.no', 'Non')} {t('admin:organizations.active_members', '({{n}} membre(s) actif(s))', { n: o.activeMembers })}</dd></div>
              </dl>
              {o.publicationHold ? <p className="text-slate-800" data-testid="admin-org-hold-reason">{t('admin:organizations.hold_reason', 'Motif de l’attente : {{reason}}', { reason: o.publicationHold })}</p> : null}
              {/* G8: the platform invitation of the first ADA Pro administrator (ADA Pro → Équipe → « Structure partenaire ») asks for one of these */}
              <p className="text-slate-800" data-testid="admin-org-identifier">{t('admin:organizations.identifier', 'Identifiant (pour inviter le premier administrateur ADA Pro)')} : <code className="break-all">{o.id}</code>{o.slug && o.slug !== o.id ? <> · {t('admin:organizations.slug', 'adresse courte')} : <code className="break-all">{o.slug}</code></> : null}</p>
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
                  {f(o.id).open ? <MembersPanel orgId={o.id} activeMembers={o.activeMembers} busy={busy} reason={f(o.id).reason || ''} reasonOk={() => reasonOk(o.id)} run={run} /> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
