// @ts-nocheck
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useT, formatDate } from '@/i18n';
import { explain } from './helpers.js';
import { REASON_MAX, REASON_MIN, validate } from './guardians-validate.js';

/**
 * R46 / C05 — « Représentants légaux : vérification renforcée » (/admin/representants-legaux): the verifier's side of the guardian state machine
 * (api/_services/guardianship.js) through POST /api/admin/guardianships (list / record; named administrator session with MFA). The page shows the links that
 * wait for the strong check — an identifier and a date only, never a name, an e-mail or an account — and records the check with a method the DPO's age
 * policy allows and the reason (10 to 500 characters, kept in the audit trail). While the DPO has not set the policy, no method exists: the page says so
 * and offers no record form (the server answers POLICY_PENDING anyway, fail-closed).
 */

function methodLabel(t, m) {
  return {
    PROFESSIONAL_ATTESTATION: t('admin:k5.guardians.method.professional_attestation', 'Attestation d’un professionnel habilité'),
    IDENTITY_DOCUMENT_CHECK: t('admin:k5.guardians.method.identity_document_check', 'Contrôle des pièces d’identité et du justificatif de représentation légale'),
    OFFICIAL_IDENTITY_SERVICE: t('admin:k5.guardians.method.official_identity_service', 'Service d’identité officiel'),
  }[m] || m;
}

/** the server's refusal in the page language (codes of guardianship.js and of the handler); anything else through the shared K5 explanation */
function refusalText(t, e) {
  const code = e?.payload?.error;
  const known = {
    POLICY_PENDING: t('admin:k5.guardians.err.policy_pending', 'La façon de vérifier un représentant légal n’est pas encore fixée par la politique de la personne déléguée à la protection des données : rien n’a été enregistré.'),
    METHOD_NOT_ALLOWED: t('admin:k5.guardians.err.method_not_allowed', 'Cette méthode n’est pas prévue par la politique en vigueur : rien n’a été enregistré.'),
    INVALID_STATE: t('admin:k5.guardians.err.invalid_state', 'Ce lien n’attend plus de vérification renforcée (il a changé entre-temps) : rien n’a été enregistré.'),
    NOT_FOUND: t('admin:k5.guardians.err.not_found', 'Lien introuvable : il a peut-être été retiré.'),
    ALREADY_REVOKED: t('admin:k5.guardians.err.revoked', 'Ce lien a été retiré : rien n’a été enregistré.'),
    reason_required: t('admin:k5.guardians.err.reason', 'Le motif doit faire de 10 à 500 caractères, en texte simple (sans < ni >).'),
  };
  if (e?.status === 503 && e?.payload?.error === 'CAPABILITY_NOT_OPEN') return t('admin:k5.guardians.err.closed', 'Cette fonction n’est pas ouverte sur cet environnement.');
  return known[code] || explain(e);
}

export default function AdminGuardianships() {
  const { t } = useT('admin');
  const uid = useId();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [form, setForm] = useState({ id: '', method: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [problem, setProblem] = useState('');
  const summaryRef = useRef(null);

  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', data: await apiClient.admin.k5('guardianships', { action: 'list' }) }); }
    catch (e) { setState({ loading: false, error: refusalText(t, e), data: null }); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const pending = data?.pending || [];
  const methods = data?.policy?.methods || [];
  const policyPending = data && data.policy?.strongVerification !== 'CONFIGURED';
  const ids = { link: `${uid}-link`, method: `${uid}-method`, reason: `${uid}-reason` };
  const errId = (k) => `${uid}-${k}-error`;
  const fmtDate = (d) => { try { return formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(d); } };

  const submit = async (ev) => {
    ev.preventDefault();
    setDone(''); setProblem('');
    const v = validate(form, t);
    setErrors(v);
    if (Object.keys(v).length) {
      // the summary takes the focus: each entry links to its field
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setBusy(true);
    try {
      const out = await apiClient.admin.k5('guardianships', { action: 'record', id: form.id, method: form.method, reason: form.reason.trim() });
      setDone(t('admin:k5.guardians.recorded', 'Vérification renforcée enregistrée : le lien est maintenant vérifié ({{status}}). Le motif est conservé dans le journal d’audit.', { status: out?.guardianship?.status || 'VERIFIED_STRONG' }));
      setForm({ id: '', method: '', reason: '' });
      await load();
    } catch (e) { setProblem(refusalText(t, e)); }
    finally { setBusy(false); }
  };

  const fieldErrors = Object.entries(errors);
  const labelOf = { id: t('admin:k5.guardians.link_legend', 'Lien vérifié'), method: t('admin:k5.guardians.method_label', 'Méthode utilisée'), reason: t('admin:k5.guardians.reason_label', 'Motif : comment la vérification a été faite') };
  const anchorOf = { id: `${ids.link}-0`, method: ids.method, reason: ids.reason };

  return (
    <div className="max-w-3xl space-y-6 p-4" data-testid="admin-guardians">
      <h1 className="text-2xl font-bold">{t('admin:k5.guardians.title', 'Représentants légaux : vérification renforcée')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.guardians.intro', 'Une personne mineure peut relier son compte à un représentant légal. Un e-mail ne prouve pas ce lien : la vérification renforcée est faite par une personne habilitée, avec une méthode prévue par la politique de la personne déléguée à la protection des données, puis enregistrée ici. Aucun nom, aucun e-mail n’est montré : seulement l’identifiant du lien et sa date.')}</p>

      {state.loading ? <p role="status">{t('admin:k5.guardians.loading', 'Chargement…')}</p> : null}
      {state.error ? (
        <div role="alert" data-testid="admin-guardians-error" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p>{t('admin:k5.guardians.not_loaded', 'Liste non chargée : {{why}}', { why: state.error })}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => load()}>{t('admin:k5.guardians.retry', 'Réessayer')}</Button>
        </div>
      ) : null}

      {data ? (
        <>
          <section aria-labelledby={`${uid}-policy`} className={`space-y-1 rounded border p-3 text-sm ${policyPending ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}
            data-testid="admin-guardians-policy" data-state={policyPending ? 'POLICY_PENDING' : 'CONFIGURED'}>
            <h2 id={`${uid}-policy`} className="font-semibold">{t('admin:k5.guardians.policy_heading', 'Politique de vérification')}</h2>
            {policyPending ? (
              <p>{t('admin:k5.guardians.policy_pending', 'Pas encore fixée : la personne déléguée à la protection des données n’a choisi aucune méthode. Aucun lien ne peut être vérifié ; les liens restent enregistrés, sans effet sur les comptes.')}</p>
            ) : (
              <>
                <p>{t('admin:k5.guardians.policy_configured', 'Fixée. Méthodes autorisées :')}</p>
                <ul className="list-disc ps-5" data-testid="admin-guardians-methods">{methods.map((m) => <li key={m}>{methodLabel(t, m)}</li>)}</ul>
              </>
            )}
          </section>

          <section aria-labelledby={`${uid}-pending`} className="space-y-2">
            <h2 id={`${uid}-pending`} className="font-semibold">{t('admin:k5.guardians.pending_heading', 'Liens en attente de vérification renforcée')}</h2>
            {pending.length ? (
              <p className="text-sm" data-testid="admin-guardians-count">{t('admin:k5.guardians.pending_count', '{{n}} lien(s) en attente.', { n: pending.length })}</p>
            ) : (
              <p className="text-sm" data-testid="admin-guardians-none">{t('admin:k5.guardians.none', 'Aucun lien n’attend de vérification renforcée.')}</p>
            )}
            {pending.length && policyPending ? (
              <ul className="space-y-1 text-sm" data-testid="admin-guardians-list">
                {pending.map((p) => <li key={p.id} className="break-all">{t('admin:k5.guardians.link_item', 'Lien {{id}} — en attente depuis le {{date}}', { id: p.id, date: fmtDate(p.createdAt) })}</li>)}
              </ul>
            ) : null}
          </section>

          <div aria-live="polite" role="status" data-testid="admin-guardians-done">{done ? <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p> : null}</div>
          {problem ? <p role="alert" data-testid="admin-guardians-problem" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{problem}</p> : null}

          {pending.length && !policyPending ? (
            <form noValidate onSubmit={submit} className="space-y-4" data-testid="admin-guardians-form" aria-labelledby={`${uid}-form`}>
              <h2 id={`${uid}-form`} className="font-semibold">{t('admin:k5.guardians.form_heading', 'Enregistrer une vérification renforcée')}</h2>
              {fieldErrors.length ? (
                <div ref={summaryRef} tabIndex={-1} role="alert" data-testid="admin-guardians-summary" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                  <p className="font-semibold">{t('admin:k5.guardians.summary', 'Le formulaire contient {{n}} erreur(s) :', { n: fieldErrors.length })}</p>
                  <ul className="list-disc ps-5">{fieldErrors.map(([k, msg]) => <li key={k}><a className="underline" href={`#${anchorOf[k]}`}>{labelOf[k]} : {msg}</a></li>)}</ul>
                </div>
              ) : null}

              <fieldset className="space-y-2" aria-describedby={errors.id ? errId('link') : undefined} aria-invalid={errors.id ? 'true' : undefined}>
                <legend className="text-sm font-medium">{labelOf.id} <span aria-hidden="true">*</span></legend>
                {errors.id ? <p id={errId('link')} className="text-sm text-rose-800">{errors.id}</p> : null}
                {pending.map((p, i) => (
                  <label key={p.id} htmlFor={`${ids.link}-${i}`} className="flex min-h-11 items-start gap-2 rounded border p-2 text-sm">
                    <input id={`${ids.link}-${i}`} type="radio" name={`${uid}-link`} value={p.id} checked={form.id === p.id} required
                      onChange={() => setForm((f) => ({ ...f, id: p.id }))} className="mt-1" />
                    <span className="break-all">{t('admin:k5.guardians.link_item', 'Lien {{id}} — en attente depuis le {{date}}', { id: p.id, date: fmtDate(p.createdAt) })}</span>
                  </label>
                ))}
              </fieldset>

              <div className="space-y-1">
                <label htmlFor={ids.method} className="block text-sm font-medium">{labelOf.method} <span aria-hidden="true">*</span></label>
                <select id={ids.method} value={form.method} required aria-invalid={errors.method ? 'true' : undefined} aria-describedby={errors.method ? errId('method') : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                  <option value="">{t('admin:k5.guardians.method_choose', '— Choisir —')}</option>
                  {methods.map((m) => <option key={m} value={m}>{methodLabel(t, m)}</option>)}
                </select>
                {errors.method ? <p id={errId('method')} className="text-sm text-rose-800">{errors.method}</p> : null}
              </div>

              <div className="space-y-1">
                <label htmlFor={ids.reason} className="block text-sm font-medium">{labelOf.reason} <span aria-hidden="true">*</span></label>
                <p id={`${uid}-reason-hint`} className="text-sm text-slate-700">{t('admin:k5.guardians.reason_hint', 'De {{min}} à {{max}} caractères, sans donnée d’identité (pas de numéro de pièce). Le motif est conservé dans le journal d’audit.', { min: REASON_MIN, max: REASON_MAX })}</p>
                <textarea id={ids.reason} value={form.reason} required rows={4} maxLength={REASON_MAX + 50} aria-invalid={errors.reason ? 'true' : undefined}
                  aria-describedby={`${uid}-reason-hint ${uid}-reason-count${errors.reason ? ` ${errId('reason')}` : ''}`}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="w-full rounded-md border border-slate-300 p-3 text-sm" />
                <p id={`${uid}-reason-count`} className="text-sm text-slate-700">{t('admin:k5.guardians.reason_count', '{{n}} / {{max}} caractères', { n: form.reason.trim().length, max: REASON_MAX })}</p>
                {errors.reason ? <p id={errId('reason')} className="text-sm text-rose-800">{errors.reason}</p> : null}
              </div>

              <Button type="submit" disabled={busy} data-testid="admin-guardians-submit">{busy ? t('admin:k5.guardians.saving', 'Enregistrement…') : t('admin:k5.guardians.submit', 'Enregistrer la vérification')}</Button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
