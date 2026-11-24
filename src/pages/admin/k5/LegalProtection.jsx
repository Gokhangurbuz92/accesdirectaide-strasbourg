// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useT, formatDate } from '@/i18n';
import { explain } from './helpers.js';
import { useLegalProtectionLabels } from '@/lib/legalProtectionLabels';

/**
 * G14-R3G — « Protection juridique : vérification » (/admin/protection-juridique), POST /api/admin/legal-protection (named administrator session with MFA).
 * The administrator examines the court decision OUTSIDE the platform (original shown, certified copy, confirmation by the registry) and records here only
 * the facts it confirms, the areas it covers, the method and a short note — never the decision itself, its text or a medical certificate. Contested links
 * (the protected person said they do not recognise the representative) are reviewed here too: reinstated with a note the person reads, or ended.
 */
export default function AdminLegalProtection() {
  const { t } = useT('legalprotection');
  const L = useLegalProtectionLabels();
  const uid = useId();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [forms, setForms] = useState({});
  const [done, setDone] = useState(''); const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', data: await apiClient.admin.k5('legal-protection', { action: 'list' }) }); }
    catch (e) { setState({ loading: false, error: explain(e), data: null }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const f = (m) => forms[m.id] || { method: '', note: '', areas: [], measureEndsOn: m.measureEndsOn || '', scopePerson: m.scopePerson, scopeAssets: m.scopeAssets, mode: m.mode, reason: '' };
  const setF = (m, k, v) => setForms((x) => ({ ...x, [m.id]: { ...f(m), [k]: v } }));
  const post = async (body, ok) => {
    setDone(''); setProblem('');
    try { await apiClient.admin.k5('legal-protection', body); setDone(ok); await load(); }
    catch (e) { setProblem(e?.payload?.message || explain(e)); }
  };
  const day = (d) => (d ? formatDate(d, { dateStyle: 'long' }) : '—');
  const data = state.data;
  const item = (m, contested) => {
    const v = f(m); const id = (k) => `${uid}-${m.id}-${k}`;
    return (
      <li key={m.id} className="space-y-2 rounded border border-slate-200 p-3 text-sm" data-testid="admin-lp-item">
        <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <dt className="font-medium">{t('legalprotection:admin.person', 'Personne protégée')}</dt><dd><bdi>{m.personEmail}</bdi></dd>
          <dt className="font-medium">{t('legalprotection:admin.rep', 'Représentant déclaré')}</dt><dd><bdi>{m.representativeEmail}</bdi> — {L.kind[m.representativeKind]}{m.mjpmForm ? ` (${L.form[m.mjpmForm]})` : ''}{m.siret ? ` — SIRET ${m.siret}` : ''}{m.structureName ? ` — ${m.structureName}` : ''}</dd>
          <dt className="font-medium">{t('legalprotection:admin.measure', 'Mesure déclarée')}</dt><dd>{L.measure[m.measure]} ({m.mode})</dd>
          <dt className="font-medium">{t('legalprotection:admin.court', 'Tribunal et date')}</dt><dd>{m.courtName} — {day(m.decisionDate)}</dd>
          <dt className="font-medium">{t('legalprotection:admin.end', 'Fin de la mesure')}</dt><dd>{day(m.measureEndsOn)}</dd>
          <dt className="font-medium">{t('legalprotection:admin.state', 'État')}</dt><dd>{L.state[m.state]}{m.contested ? ` — ${t('legalprotection:admin.contested', 'contesté par la personne')}` : ''}{m.duplicateRef ? ` — ${t('legalprotection:admin.duplicate', 'même numéro de dossier déclaré plusieurs fois')}` : ''}</dd>
        </dl>
        {contested ? (
          <div className="space-y-2">
            <label htmlFor={id('note')} className="block font-medium">{t('legalprotection:admin.note', 'Note (10 à 500 caractères, sans recopier la décision) — la personne la lit')}</label>
            <textarea id={id('note')} rows={3} value={v.note} onChange={(e) => setF(m, 'note', e.target.value)} className="w-full rounded border border-slate-300 p-2" />
            <div className="flex flex-wrap gap-2">
              {m.state === 'SUSPENDED' ? <Button type="button" size="sm" onClick={() => post({ action: 'reinstate', id: m.id, note: v.note }, t('legalprotection:admin.reinstated', 'Lien rétabli.'))}>{t('legalprotection:admin.reinstate', 'Rétablir (la décision est confirmée)')}</Button> : null}
              <Button type="button" size="sm" variant="destructive" onClick={() => post({ action: 'end', id: m.id, reason: 'CONTEST_UPHELD', note: v.note }, t('legalprotection:admin.ended', 'Lien terminé.'))}>{t('legalprotection:admin.uphold', 'Terminer le lien (signalement fondé)')}</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); post({ action: 'verify', id: m.id, method: v.method, note: v.note, measure: m.measure, mode: v.mode, representativeKind: m.representativeKind,
            mjpmForm: m.mjpmForm, siret: m.siret, scopePerson: v.scopePerson, scopeAssets: v.scopeAssets, areas: v.areas, courtName: m.courtName, decisionDate: m.decisionDate, measureEndsOn: v.measureEndsOn || undefined },
            t('legalprotection:admin.verified', 'Décision vérifiée : le lien est actif jusqu’à sa date de fin.')); }}>
            <p>{t('legalprotection:admin.examine', 'Examinez la décision hors de la plateforme (originale, copie certifiée ou confirmation du greffe). Ne la recevez pas par ce service. Corrigez ci-dessous ce qui diffère de la déclaration.')}</p>
            <label htmlFor={id('method')} className="block font-medium">{t('legalprotection:admin.method', 'Comment la décision a été examinée')}</label>
            <select id={id('method')} required value={v.method} onChange={(e) => setF(m, 'method', e.target.value)} className="min-h-11 w-full rounded border border-slate-300 bg-white px-2">
              <option value="">{t('legalprotection:choose', '— Choisir —')}</option>
              {Object.entries(L.method).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
            </select>
            <fieldset><legend className="font-medium">{t('legalprotection:admin.scope', 'La décision porte sur')}</legend>
              <label className="me-4 inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={v.scopePerson} onChange={(e) => setF(m, 'scopePerson', e.target.checked)} />{t('legalprotection:declare.scope_person', 'la protection de la personne')}</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={v.scopeAssets} onChange={(e) => setF(m, 'scopeAssets', e.target.checked)} />{t('legalprotection:declare.scope_assets', 'ses biens (patrimoine, ressources)')}</label>
            </fieldset>
            <fieldset><legend className="font-medium">{t('legalprotection:admin.areas', 'Parties de la plateforme couvertes')}</legend>
              {['RDV', 'PARCOURS'].map((a) => <label key={a} className="me-4 inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={v.areas.includes(a)} onChange={(e) => setF(m, 'areas', e.target.checked ? [...v.areas, a] : v.areas.filter((x) => x !== a))} />{L.area[a]}</label>)}
            </fieldset>
            {m.measure !== 'HABILITATION_FAMILIALE_SPECIALE' ? (<>
              <label htmlFor={id('end')} className="block font-medium">{t('legalprotection:admin.end', 'Fin de la mesure')}</label>
              <input id={id('end')} type="date" value={v.measureEndsOn} onChange={(e) => setF(m, 'measureEndsOn', e.target.value)} className="min-h-11 rounded border border-slate-300 px-2" />
            </>) : <p>{t('legalprotection:admin.special', 'Sans date de fin : le lien vaudra {{days}} jours, puis une nouvelle vérification sera nécessaire (durée proposée, à approuver).', { days: data?.limits?.specialReviewDays || 365 })}</p>}
            <label htmlFor={id('vnote')} className="block font-medium">{t('legalprotection:admin.note', 'Note (10 à 500 caractères, sans recopier la décision) — la personne la lit')}</label>
            <textarea id={id('vnote')} rows={3} value={v.note} onChange={(e) => setF(m, 'note', e.target.value)} className="w-full rounded border border-slate-300 p-2" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" data-testid="admin-lp-verify">{t('legalprotection:admin.verify', 'Enregistrer la vérification')}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => post({ action: 'reject', id: m.id, note: v.note }, t('legalprotection:admin.rejected', 'Déclaration refusée.'))}>{t('legalprotection:admin.reject', 'Refuser (décision non vérifiable)')}</Button>
            </div>
          </form>
        )}
      </li>
    );
  };
  return (
    <div className="max-w-3xl space-y-6 p-4" data-testid="admin-legal-protection">
      <h1 className="text-2xl font-bold">{t('legalprotection:admin.title', 'Protection juridique : vérification des décisions')}</h1>
      <p className="text-sm text-slate-700">{t('legalprotection:admin.intro', 'Un représentant (tuteur, curateur, personne habilitée, mandataire) a déclaré une décision du juge. Rien n’est ouvert avant votre vérification. La décision n’est jamais reçue ni gardée par la plateforme, et ne passe par aucune IA.')}</p>
      {state.loading ? <p role="status">{t('legalprotection:loading', 'Chargement…')}</p> : null}
      {state.error ? <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{state.error}</p> : null}
      <div aria-live="polite" role="status">{done ? <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p> : null}</div>
      {problem ? <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{problem}</p> : null}
      {data ? (<>
        <section aria-labelledby={`${uid}-p`} className="space-y-2">
          <h2 id={`${uid}-p`} className="font-semibold">{t('legalprotection:admin.pending', 'Déclarations à vérifier')}</h2>
          {data.pending?.length ? <ul className="space-y-3">{data.pending.map((m) => item(m, false))}</ul> : <p className="text-sm">{t('legalprotection:admin.none', 'Aucune.')}</p>}
        </section>
        <section aria-labelledby={`${uid}-c`} className="space-y-2">
          <h2 id={`${uid}-c`} className="font-semibold">{t('legalprotection:admin.contested_title', 'Liens signalés par la personne')}</h2>
          {data.contested?.length ? <ul className="space-y-3">{data.contested.map((m) => item(m, true))}</ul> : <p className="text-sm">{t('legalprotection:admin.none', 'Aucune.')}</p>}
        </section>
      </>) : null}
    </div>
  );
}
