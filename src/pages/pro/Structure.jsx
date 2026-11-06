// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { useStructureFieldLabels } from '@/lib/structureFieldsI18n';
import { formatDate, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { chooseMessage, fieldA11y, minLengthMessage, requiredMessage } from '@/lib/fieldErrors';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const when = (d) => (d ? formatDate(d, { dateStyle: 'short', timeStyle: 'medium' }) : '');
const shown = (field, v, t) => (v === null || v === undefined || v === '' ? '—' : field === 'accessibilite_pmr' ? (String(v) === 'true' ? t('pro:structure.yes', 'Oui') : t('pro:structure.not_confirmed', 'Non confirmée')) : Array.isArray(v) ? v.join(', ') || '—' : String(v));

/**
 * PKG-4 / E02 E05 E08 — Ma structure (/pro/structure). The public record is shown as ADA published it; administrators PROPOSE changes, which an ADA reviewer checks
 * before anything is published (D-5). Every rule is enforced by /api/pro/structure. PKG-11 / E08: an administrator can ask ADA to close the space and erase the
 * organization's own data; two ADA reviewers decide, and the people keep their dossiers.
 */
const closureStates = (t) => ({ IN_REVIEW: t('pro:structure.closure.in_review', 'en cours d’examen par l’équipe ADA (deux personnes)'), BLOCKED: t('pro:structure.closure.blocked', 'suspendue : une conservation légale s’applique'), EXECUTING: t('pro:structure.closure.executing', 'en cours d’exécution'), COMPLETED: t('pro:structure.closure.completed', 'exécutée'), REJECTED: t('pro:structure.closure.rejected', 'refusée') });
export default function ProStructure() {
  const { t } = useT('pro');
  const fr = useFrAttrs();   // R47: the public record's own text (name, address, hours…) stays French (lang="fr" outside French)
  const { fieldLabels: STRUCTURE_FIELD_LABELS, proposalStatus: PROPOSAL_STATUS_LABELS } = useStructureFieldLabels();
  const CLOSURE_STATE = closureStates(t);
  const [state, setState] = useState({ loading: true, error: '', structure: null, proposals: [], canPropose: false, fields: [] });
  const [field, setField] = useState('horaires'); const [value, setValue] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  // R43 (A5): per-field messages and a focused error summary on the two forms (proposal, closure request)
  const proposeErr = useFormErrors(); const closureErr = useFormErrors();
  const load = useCallback(async () => {
    try { const out = await proRdvRequest('/api/pro/structure'); setState({ loading: false, error: '', ...out }); }
    catch (e) { setState({ loading: false, error: msgOf(e, t('pro:structure.load_failed', 'Impossible de charger la fiche de la structure.')), structure: null, proposals: [], canPropose: false, fields: [] }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const submit = async (e) => {
    e.preventDefault();
    const lbl = t('pro:structure.nouvelle_valeur', 'Nouvelle valeur');
    if (!proposeErr.check(String(value).trim() ? {} : { 'structure-value': field === 'accessibilite_pmr' ? chooseMessage(t, lbl) : requiredMessage(t, lbl) })) return;
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'propose', field, value } }); setValue(''); setMessage(t('pro:structure.proposal_sent', 'Proposition envoyée : elle sera publiée après vérification par l’équipe ADA.')); await load(); }
    catch (err) { setProblem(msgOf(err, t('pro:structure.proposal_failed', 'La proposition n’a pas pu être enregistrée.'))); } finally { setBusy(false); }
  };
  const withdraw = async (id) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'withdraw', id } }); setMessage(t('pro:structure.proposal_withdrawn', 'Proposition retirée.')); await load(); }
    catch (err) { setProblem(msgOf(err, t('pro:structure.withdraw_failed', 'Impossible de retirer la proposition.'))); } finally { setBusy(false); }
  };
  const requestClosure = async (e) => {
    e.preventDefault();
    const why = closeReason.trim(); const lbl = t('pro:structure.raison_fermeture', 'Raison de la fermeture');
    if (!closureErr.check(why.length >= 10 ? {} : { 'structure-closure-reason': why ? minLengthMessage(t, lbl, 10) : requiredMessage(t, lbl) })) return;
    if (!window.confirm(t('pro:structure.closure_confirm', 'Demander la fermeture de l’espace de la structure ? Après examen par deux personnes d’ADA, les accès aux dossiers, les comptes des membres et les notes internes seront effacés. Les personnes gardent leurs dossiers.'))) return;
    setBusy(true); setMessage(''); setProblem('');
    try { await proRdvRequest('/api/pro/structure', { method: 'POST', body: { action: 'request_closure', reason: closeReason } }); setCloseReason(''); setMessage(t('pro:structure.closure_sent', 'Demande de fermeture envoyée : deux personnes de l’équipe ADA vont l’examiner.')); await load(); }
    catch (err) { setProblem(msgOf(err, t('pro:structure.closure_failed', 'La demande n’a pas pu être envoyée.'))); } finally { setBusy(false); }
  };
  const exportData = async () => {
    setProblem('');
    try {
      const out = await proRdvRequest('/api/pro/structure', { query: { export: '1' } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(out.export, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'export-structure.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);   // revoking at once can cancel the download
    } catch (err) { setProblem(msgOf(err, t('pro:structure.export_failed', 'Export impossible.'))); }
  };
  if (state.loading) return <div role="status">{t('pro:structure.chargement', 'Chargement…')}</div>;
  const s = state.structure;
  return (
    <div className="space-y-6" data-testid="pro-structure">
      <SEO title={t('pro:structure.structure', 'Ma structure')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('pro:structure.structure', 'Ma structure')}</h1>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {problem ? <p role="alert" data-testid="structure-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="structure-status">{busy ? <span className="sr-only">{t('common:form.status.saving', 'Enregistrement en cours…')}</span> : null}{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {s ? (
        <Card><CardHeader><CardTitle {...fr}>{s.nom}</CardTitle><CardDescription>{s.verification_status !== 'VERIFIED' ? t('pro:structure.record_unverified', 'Fiche publique telle que vérifiée par ADA (non vérifiée).') : s.date_verification ? t('pro:structure.record_verified_on', 'Fiche publique telle que vérifiée par ADA (vérifiée le {{date}}).', { date: formatDate(s.date_verification, { dateStyle: 'short' }) }) : t('pro:structure.record_verified', 'Fiche publique telle que vérifiée par ADA (vérifiée).')}</CardDescription></CardHeader>
          <CardContent><dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="structure-record">
            {Object.keys(STRUCTURE_FIELD_LABELS).map((f) => (
              <div key={f}><dt className="font-medium text-slate-700">{STRUCTURE_FIELD_LABELS[f]}</dt><dd className="whitespace-pre-wrap text-slate-900" {...(f === 'accessibilite_pmr' ? {} : fr)}>{shown(f, f === 'service_area' ? s.insee_codes : s[f], t)}</dd></div>
            ))}
          </dl></CardContent></Card>
      ) : null}
      {state.canPropose ? (
        <Card><CardHeader><CardTitle className="text-lg">{t('pro:structure.proposer_une_modification', 'Proposer une modification')}</CardTitle><CardDescription>{t('pro:structure.rien_est_publie_directement', 'Rien n’est publié directement : l’équipe ADA vérifie chaque proposition avant publication.')}</CardDescription></CardHeader>
          <CardContent><form onSubmit={submit} className="space-y-3" noValidate aria-busy={busy || undefined}>
            <ErrorSummary ref={proposeErr.summaryRef} errors={proposeErr.errors} order={['structure-value']} testid="structure-propose-errors" />
            <div><label htmlFor="structure-field" className="block text-sm font-medium">{t('pro:structure.information_modifier', 'Information à modifier')}</label>
              <select id="structure-field" data-testid="structure-field" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={field} onChange={(e) => { setField(e.target.value); setValue(''); proposeErr.reset(); }}>
                {state.fields.map((f) => <option key={f} value={f}>{STRUCTURE_FIELD_LABELS[f] || f}</option>)}
              </select></div>
            <div><label htmlFor="structure-value" className="block text-sm font-medium">{t('pro:structure.nouvelle_valeur', 'Nouvelle valeur')}</label>
              {field === 'accessibilite_pmr'
                ? <select id="structure-value" data-testid="structure-value" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={value} {...fieldA11y('structure-value', proposeErr.errors)} onChange={(e) => { setValue(e.target.value); proposeErr.clear('structure-value'); }} required><option value="">{t('pro:structure.choisir', 'Choisir…')}</option><option value="true">{t('pro:structure.oui', 'Oui')}</option><option value="false">{t('pro:structure.non', 'Non')}</option></select>
                : <textarea id="structure-value" data-testid="structure-value" {...fr} className="mt-1 w-full rounded-md border border-slate-300 p-2" rows={field === 'summary_falc' || field === 'horaires' || field === 'service_area' ? 4 : 1} value={value} onChange={(e) => { setValue(e.target.value); proposeErr.clear('structure-value'); }} required {...fieldA11y('structure-value', proposeErr.errors, field === 'service_area' ? 'structure-value-help' : '')} />}
              {field === 'service_area' ? <p id="structure-value-help" className="mt-1 text-xs text-slate-600">{t('pro:structure.codes_insee_separes_par', 'Codes INSEE séparés par des virgules (ex. 67482 pour Strasbourg).')}</p> : null}
              <FieldError field="structure-value" errors={proposeErr.errors} />
            </div>
            <Button type="submit" disabled={busy} data-testid="structure-propose">{t('pro:structure.envoyer_proposition', 'Envoyer la proposition')}</Button>
          </form></CardContent></Card>
      ) : <p className="text-sm text-slate-700">{t('pro:structure.seul_administrateur_rice_structure', 'Seul·e un·e administrateur·rice de la structure peut proposer une modification de la fiche.')}</p>}
      <Card><CardHeader><CardTitle className="text-lg">{t('pro:structure.propositions', 'Propositions')}</CardTitle></CardHeader><CardContent>
        {state.proposals.length ? <ul className="space-y-2">{state.proposals.map((p) => (
          <li key={p.id} data-testid="structure-proposal" className="rounded-md border border-slate-200 p-2 text-sm">
            <p><strong>{STRUCTURE_FIELD_LABELS[p.field] || p.field}</strong> : {shown(p.field, p.proposedValue, t)} — <span data-testid="structure-proposal-status">{PROPOSAL_STATUS_LABELS[p.status] || p.status}</span> <span className="text-slate-600">({when(p.createdAt)})</span></p>
            {p.reviewNote ? <p>{t('pro:structure.review_note', 'Commentaire ADA : « {{note}} »', { note: p.reviewNote })}</p> : null}
            {p.status === 'PENDING' && state.canPropose ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => withdraw(p.id)} data-testid="structure-withdraw">{t('pro:structure.retirer', 'Retirer')}</Button> : null}
          </li>
        ))}</ul> : <p className="text-sm text-slate-700" data-testid="structure-no-proposal">{t('pro:structure.aucune_proposition', 'Aucune proposition.')}</p>}
      </CardContent></Card>
      {state.canPropose ? <Button type="button" variant="outline" onClick={exportData} data-testid="structure-export">{t('pro:structure.exporter_les_donnees_structure', 'Exporter les données de la structure')}</Button> : null}
      {state.canPropose ? (
        <Card data-testid="structure-closure"><CardHeader><CardTitle className="text-lg">{t('pro:structure.fermer_espace_structure', 'Fermer l’espace de la structure')}</CardTitle>
          <CardDescription>{t('pro:structure.deux_personnes_equipe_ada', 'Deux personnes de l’équipe ADA examinent la demande. À l’exécution : les accès aux dossiers sont retirés (les personnes gardent leurs dossiers), les notes internes, les notifications et les comptes des membres sont effacés, les suivis et orientations en cours sont clos et les rendez-vous à venir annulés (les personnes sont prévenues). Exportez d’abord les données de la structure si vous en avez besoin.')}</CardDescription></CardHeader>
          <CardContent>
            {state.closure && ['IN_REVIEW', 'BLOCKED', 'EXECUTING'].includes(state.closure.status)
              ? <p data-testid="structure-closure-state">{t('pro:structure.closure_request', 'Demande du {{date}} : {{state}}.', { date: formatDate(state.closure.createdAt, { dateStyle: 'short' }), state: CLOSURE_STATE[state.closure.status] || state.closure.status })}</p>
              : (
                <form onSubmit={requestClosure} className="space-y-3" noValidate aria-busy={busy || undefined}>
                  <ErrorSummary ref={closureErr.summaryRef} errors={closureErr.errors} order={['structure-closure-reason']} testid="structure-closure-errors" />
                  {state.closure?.status === 'REJECTED' ? <p data-testid="structure-closure-state">{t('pro:structure.derniere_demande_refusee', 'Dernière demande refusée')}{state.closure.reason ? ` : « ${state.closure.reason} »` : ''}.</p> : null}
                  <div><label htmlFor="structure-closure-reason" className="block text-sm font-medium">{t('pro:structure.raison_fermeture', 'Raison de la fermeture')}</label>
                    <textarea id="structure-closure-reason" data-testid="structure-closure-reason" className="mt-1 w-full rounded-md border border-slate-300 p-2" rows={3} minLength={10} required value={closeReason} {...fieldA11y('structure-closure-reason', closureErr.errors)} onChange={(e) => { setCloseReason(e.target.value); closureErr.clear('structure-closure-reason'); }} /><FieldError field="structure-closure-reason" errors={closureErr.errors} /></div>
                  <Button type="submit" variant="outline" disabled={busy} data-testid="structure-closure-request">{t('pro:structure.demander_fermeture', 'Demander la fermeture')}</Button>
                </form>
              )}
          </CardContent></Card>
      ) : null}
    </div>
  );
}
