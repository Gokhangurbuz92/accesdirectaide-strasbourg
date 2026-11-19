// @ts-nocheck
/**
 * X05 (expansion) — /pro/offres-emploi: the job listings of the organization (api/_handlers/pro/employment.js). Only a structure administrator manages them,
 * and only an organization ADA verified (E01) can send one to the review. The form has the required fields only — title, contract type, place, description,
 * the inclusive accommodations (closed list), how to apply (the employer's own web address or e-mail) and the end date — and says what a listing may never
 * contain: a selection criterion forbidden by Code du travail article L1132-1, or a request for health or disability details. ADA keeps nothing about
 * applicants: they apply through the channel given here. Every rule is enforced by the server. Closed by default (503: « not open yet »).
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { formatDate, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { ACCOMMODATIONS, CONTRACT_TYPES, DESCRIPTION_MAX, EXPIRY_MAX_DAYS, TITLE_MAX, accommodationLabel, contractLabel, problemLabel, reasonLabel, statusLabel } from '@/lib/jobBoard';

const EMPTY = { title: '', contractType: '', city: '', postalCode: '', description: '', accommodations: [], applyMethod: 'url', applyTarget: '', expiresOn: '' };
const day = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return day(d); };
const pick = (l) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, l[k] ?? EMPTY[k]]));

export default function JobListings() {
  const { t } = useT('employment');
  const fr = useFrAttrs();
  const [state, setState] = useState({ loading: true, closed: false, error: '', data: null });
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const data = await proRdvRequest('/api/pro/employment'); setState({ loading: false, closed: false, error: '', data }); }
    catch (e) { setState({ loading: false, closed: e?.status === 503, error: e?.status === 503 ? '' : t('employment:failed', 'Les offres n’ont pas pu être chargées.'), data: null }); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const say = (e) => {
    const code = e?.payload?.error;
    setMsg({ text: problemLabel(code, t) || e?.payload?.message || t('employment:pro.refused', 'Action refusée.'), error: true });
  };
  const post = async (body, done) => {
    setBusy(true); setMsg({ text: '', error: false });
    try { await proRdvRequest('/api/pro/employment', { method: 'POST', body }); setMsg({ text: done, error: false }); await load(); return true; }
    catch (e) { say(e); return false; }
    finally { setBusy(false); }
  };
  const save = async (ev) => {
    ev.preventDefault();
    const ok = await post(editing ? { action: 'update', id: editing, ...form } : { action: 'create', ...form }, t('employment:pro.saved', 'Brouillon enregistré. Envoyez-le à la relecture quand il est prêt.'));
    if (ok) { setForm(EMPTY); setEditing(null); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (a) => setForm((f) => ({ ...f, accommodations: f.accommodations.includes(a) ? f.accommodations.filter((x) => x !== a) : [...f.accommodations, a] }));

  const title = t('employment:pro.title', 'Offres d’emploi de la structure');
  const data = state.data;
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/pro/offres-emploi" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('employment:pro.intro', 'Publiez des offres d’emploi inclusives. Chaque offre est relue par l’équipe ADA avant sa publication et reste visible jusqu’à sa date de fin. Les candidats postulent directement auprès de vous : ADA ne reçoit ni ne garde aucune candidature.')}</p>
      </div>
      {state.loading && <p role="status">{t('employment:loading', 'Chargement…')}</p>}
      {state.closed && <p role="status" data-testid="jobs-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('employment:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error && <p role="alert" className="text-red-900">{state.error}</p>}
      {data && !data.available && <p role="status">{t('employment:pro.unavailable', 'Les offres d’emploi ne sont pas disponibles sur ce service.')}</p>}
      {data?.available && !data.canManage && <p role="status" data-testid="jobs-not-manager">{t('employment:pro.not_manager', 'Seul un administrateur de la structure gère ses offres d’emploi.')}</p>}
      {data?.available && data.canManage && (
        <>
          {!data.employerVerified && <p role="status" data-testid="jobs-not-verified" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{problemLabel('EMPLOYER_NOT_VERIFIED', t)}</p>}
          <form onSubmit={save} className="max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="job-form" noValidate>
            <h2 className="text-lg font-semibold text-slate-900">{editing ? t('employment:pro.edit', 'Modifier l’offre') : t('employment:pro.new', 'Nouvelle offre')}</h2>
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-950" id="job-rules" data-testid="job-rules">
              <p>{t('employment:pro.rule_criteria', 'N’indiquez aucun critère de sélection interdit : âge, sexe, origine, nationalité, santé, handicap, grossesse, situation de famille, religion, apparence, lieu de résidence… (Code du travail, article L1132-1).')}</p>
              <p>{t('employment:pro.rule_health', 'Ne demandez jamais aux candidats d’informations sur leur santé ou un handicap. Décrivez plutôt les aménagements que vous proposez.')}</p>
            </div>
            <div>
              <label htmlFor="job-title" className="block font-semibold text-slate-900">{t('employment:form.title', 'Intitulé du poste')}</label>
              <input id="job-title" className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" maxLength={TITLE_MAX} value={form.title} onChange={set('title')} required aria-describedby="job-rules" />
            </div>
            <div>
              <label htmlFor="job-contract" className="block font-semibold text-slate-900">{t('employment:form.contract', 'Type de contrat')}</label>
              <select id="job-contract" className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2" value={form.contractType} onChange={set('contractType')} required>
                <option value="">{t('employment:form.choose', 'Choisir')}</option>
                {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{contractLabel(c, t)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <label htmlFor="job-city" className="block font-semibold text-slate-900">{t('employment:form.city', 'Commune')}</label>
                <input id="job-city" className="mt-1 rounded-md border border-slate-400 px-3 py-2" value={form.city} onChange={set('city')} required />
              </div>
              <div>
                <label htmlFor="job-postal" className="block font-semibold text-slate-900">{t('employment:form.postal', 'Code postal')}</label>
                <input id="job-postal" className="mt-1 w-28 rounded-md border border-slate-400 px-3 py-2" inputMode="numeric" maxLength={5} value={form.postalCode} onChange={set('postalCode')} required />
              </div>
            </div>
            <div>
              <label htmlFor="job-description" className="block font-semibold text-slate-900">{t('employment:form.description', 'Description du poste')}</label>
              <textarea id="job-description" className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" rows={6} maxLength={DESCRIPTION_MAX} value={form.description} onChange={set('description')} required aria-describedby="job-rules job-text-only" />
              <p id="job-text-only" className="text-sm text-slate-700">{t('employment:form.text_only', 'Du texte seulement : pas de lien, d’adresse e-mail ni de téléphone dans la description (le moyen de candidature suffit).')}</p>
            </div>
            <fieldset>
              <legend className="font-semibold text-slate-900">{t('employment:form.accommodations', 'Aménagements proposés (au moins un)')}</legend>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {ACCOMMODATIONS.map((a) => (
                  <label key={a} className="flex items-center gap-2 text-sm text-slate-900">
                    <input type="checkbox" checked={form.accommodations.includes(a)} onChange={() => toggle(a)} />{accommodationLabel(a, t)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-semibold text-slate-900">{t('employment:form.apply', 'Comment postuler')}</legend>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="job-apply-method" value="url" checked={form.applyMethod === 'url'} onChange={set('applyMethod')} />{t('employment:form.apply_url', 'Page de candidature de votre site (https://…)')}</label>
                <label className="flex items-center gap-2"><input type="radio" name="job-apply-method" value="email" checked={form.applyMethod === 'email'} onChange={set('applyMethod')} />{t('employment:form.apply_email', 'Adresse e-mail de recrutement')}</label>
              </div>
              <label htmlFor="job-apply-target" className="mt-2 block font-semibold text-slate-900">{form.applyMethod === 'email' ? t('employment:form.apply_email', 'Adresse e-mail de recrutement') : t('employment:form.apply_url', 'Page de candidature de votre site (https://…)')}</label>
              <input id="job-apply-target" type={form.applyMethod === 'email' ? 'email' : 'url'} className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" value={form.applyTarget} onChange={set('applyTarget')} required aria-describedby="job-apply-help" />
              <p id="job-apply-help" className="text-sm text-slate-700">{t('employment:form.apply_help', 'Les candidats vous écrivent directement : préférez une adresse de service plutôt que l’adresse personnelle d’un salarié.')}</p>
            </fieldset>
            <div>
              <label htmlFor="job-expires" className="block font-semibold text-slate-900">{t('employment:form.expires', 'Date de fin de publication')}</label>
              <input id="job-expires" type="date" className="mt-1 rounded-md border border-slate-400 px-3 py-2" min={plusDays(1)} max={plusDays(EXPIRY_MAX_DAYS)} value={form.expiresOn} onChange={set('expiresOn')} required aria-describedby="job-expires-help" />
              <p id="job-expires-help" className="text-sm text-slate-700">{t('employment:form.expires_help', 'Au plus 90 jours. Après cette date, l’offre n’est plus visible.')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>{t('employment:form.save', 'Enregistrer le brouillon')}</Button>
              {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(EMPTY); }}>{t('employment:form.cancel', 'Annuler')}</Button>}
            </div>
          </form>
          <div aria-live="polite" role="status">{msg.text && <p className={msg.error ? 'text-red-900' : 'text-emerald-900'}>{msg.text}</p>}</div>
          <section aria-labelledby="job-mine" className="max-w-3xl">
            <h2 id="job-mine" className="text-lg font-semibold text-slate-900">{t('employment:pro.mine', 'Vos offres')}</h2>
            {data.listings.length === 0 ? <p className="text-sm text-slate-700" data-testid="job-mine-empty">{t('employment:pro.empty', 'Aucune offre pour le moment.')}</p> : (
              <ul className="mt-2 space-y-3" data-testid="job-mine-list">
                {data.listings.map((l) => (
                  <li key={l.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="font-semibold text-slate-900" {...fr}>{l.title}</h3>
                    <p className="text-sm text-slate-800">{statusLabel(l.status, t)} — {t('employment:list.until', 'Offre visible jusqu’au')} {formatDate(l.expiresOn)}</p>
                    {l.moderationReason && <p className="text-sm text-red-900">{t('employment:pro.reason', 'Motif de la relecture')} : {reasonLabel(l.moderationReason, t)}</p>}
                    <div className="flex flex-wrap gap-2">
                      {['draft', 'rejected'].includes(l.status) && <Button size="sm" variant="outline" onClick={() => { setEditing(l.id); setForm(pick(l)); }}>{t('employment:pro.edit_action', 'Modifier')}</Button>}
                      {l.status === 'draft' && <Button size="sm" disabled={busy || !data.employerVerified} onClick={() => post({ action: 'submit', id: l.id }, t('employment:pro.submitted', 'Offre envoyée à la relecture.'))}>{t('employment:pro.submit', 'Envoyer à la relecture')}</Button>}
                      {['draft', 'pending', 'published', 'rejected'].includes(l.status) && <Button size="sm" variant="destructive" disabled={busy} onClick={() => post({ action: 'withdraw', id: l.id }, t('employment:pro.withdrawn', 'Offre retirée.'))}>{t('employment:pro.withdraw', 'Retirer')}</Button>}
                      {l.status === 'draft' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ action: 'delete', id: l.id }, t('employment:pro.deleted', 'Brouillon supprimé.'))}>{t('employment:pro.delete', 'Supprimer le brouillon')}</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
