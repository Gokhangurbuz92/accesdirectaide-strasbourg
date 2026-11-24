// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';
import { useLegalProtectionLabels } from '@/lib/legalProtectionLabels';

const EMPTY = { personEmail: '', representativeKind: 'FAMILLE', mjpmForm: '', siret: '', measure: '', mode: '', scopePerson: false, scopeAssets: false, courtName: '',
  decisionDate: '', measureEndsOn: '', decisionRef: '', truthful: false, password: '' };
const BOTH_MODES = ['HABILITATION_FAMILIALE_GENERALE', 'HABILITATION_FAMILIALE_SPECIALE', 'SAUVEGARDE_MANDAT_SPECIAL'];
const NO_TERM = ['HABILITATION_FAMILIALE_SPECIALE'];
const FAMILY_ONLY = ['HABILITATION_FAMILIALE_GENERALE', 'HABILITATION_FAMILIALE_SPECIALE'];

/**
 * G14-R3G — « Protection juridique » (/compte/protection-juridique). FALC first for the protected person: who protects me, what they can do, until when,
 * what they did; « je ne reconnais pas cette personne ». Then the representative's side: declare a court decision (nothing is opened before the
 * administrator examined it), view the covered parts, act or ask, the helper code, renounce. Legal terms stay in French in every language.
 */
export default function CompteProtectionJuridique() {
  const { t } = useT('legalprotection');
  const L = useLegalProtectionLabels();
  const M = useMonEspaceLabels();
  const uid = useId();
  const [state, setState] = useState({ loading: true, error: '', data: null, unauth: false });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [logs, setLogs] = useState({}); const [views, setViews] = useState({}); const [codes, setCodes] = useState({});
  const [confirmContest, setConfirmContest] = useState('');
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', data: await citizenApi.legalProtection(), unauth: false }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('legalprotection:login_required', 'Connectez-vous pour voir cette page.') : err.message, data: null, unauth: err.status === 401 }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { const out = await fn(); if (ok) setMessage(ok); await load(); return out; } catch (err) { setProblem(err.message); return null; } };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const day = (d) => (d ? formatDate(d, { dateStyle: 'long' }) : '');
  const describe = (type, target) => (type === 'RDV_CANCEL'
    ? t('legalprotection:req.rdv_cancel', 'annuler le rendez-vous du {{date}} ({{structure}})', { date: formatDate(target?.startAt, { dateStyle: 'medium', timeStyle: 'short' }), structure: target?.structure || '' })
    : t('legalprotection:req.parcours_status', 'mettre l’étape « {{title}} » à l’état « {{status}} »', { title: target?.title || '', status: M.parcoursStatus?.[target?.status] || target?.status || '' }));
  const showLog = async (id) => { try { const d = await citizenApi.legalProtectionLog(id); setLogs((l) => ({ ...l, [id]: d.events || [] })); } catch (err) { setProblem(err.message); } };
  const showView = async (id, what) => { try { const d = await citizenApi.legalProtectionView(id, what); setViews((v) => ({ ...v, [`${id}:${what}`]: d })); } catch (err) { setProblem(err.message); } };
  const act = async (id, body, what) => {
    const out = await run(() => citizenApi.legalProtectionAction({ action: 'act', id, ...body }), '');
    if (out) { setMessage(out.executed ? t('legalprotection:act.done', 'C’est fait. La personne est prévenue.') : t('legalprotection:act.asked', 'Demande envoyée : la personne doit la confirmer dans les 48 heures. Rien n’est fait avant.')); await showView(id, what); }
  };
  const declare = async (e) => {
    e.preventDefault();
    const body = { action: 'declare', ...form, mode: BOTH_MODES.includes(form.measure) ? form.mode : undefined, measureEndsOn: NO_TERM.includes(form.measure) ? undefined : form.measureEndsOn };
    const out = await run(() => citizenApi.legalProtectionAction(body), '');
    if (out) { setMessage(t('legalprotection:declare.done', 'Déclaration enregistrée. Si l’adresse est celle du compte de la personne protégée, elle la verra. L’administrateur vous contactera pour examiner la décision. Aucun accès n’est ouvert avant.')); setForm(EMPTY); }
  };
  const getCode = async (id) => { const out = await run(() => citizenApi.legalProtectionAction({ action: 'helper-code', id }), ''); if (out) setCodes((c) => ({ ...c, [id]: out })); };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('legalprotection:loading', 'Chargement…')}</div>;
  const d = state.data;
  const asPerson = d?.asPerson || []; const asRep = d?.asRepresentative || []; const requests = d?.requests || [];
  const ids = (k) => `${uid}-${k}`;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-protection-juridique">
      <SEO title={t('legalprotection:title', 'Protection juridique')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('legalprotection:title', 'Protection juridique')}</h1>
      {/* FALC: short sentences, one idea each, for the protected person first */}
      <div className="space-y-2 rounded-md border border-slate-200 bg-white p-4 text-base text-slate-800" data-testid="lp-falc-intro">
        <p>{t('legalprotection:falc.1', 'Un juge peut choisir une personne pour vous protéger.')}</p>
        <p>{t('legalprotection:falc.2', 'Cette personne s’appelle : tuteur, curateur, personne habilitée ou mandataire.')}</p>
        <p>{t('legalprotection:falc.3', 'Ici, vous voyez qui vous protège, ce que cette personne peut faire pour vous, et jusqu’à quand.')}</p>
        <p>{t('legalprotection:falc.4', 'Vous gardez toujours votre compte. Vous pouvez toujours l’utiliser vous-même.')}</p>
        <p>{t('legalprotection:falc.5', 'Tout ce que cette personne fait ici est écrit. Vous pouvez le lire.')}</p>
        <p>{t('legalprotection:falc.6', 'Rien ne s’ouvre avant que l’administrateur ait vérifié la décision du juge.')}</p>
      </div>
      {state.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{state.error}</p>
          {state.unauth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/protection-juridique">{t('legalprotection:sign_in', 'Se connecter')}</Link></Button> : null}
        </div>
      ) : null}
      {d && d.installed === false ? <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900" data-testid="lp-not-installed">{t('legalprotection:err.not_installed', 'La protection juridique n’est pas encore disponible sur ce service. Rien n’a été enregistré.')}</p> : null}
      {problem ? <p role="alert" data-testid="lp-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="lp-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>

      {d && d.installed !== false ? (<>
        <Card data-testid="lp-as-person">
          <CardHeader><CardTitle className="text-lg">{t('legalprotection:person.title', 'Les personnes qui me protègent')}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-800">
            {asPerson.length ? asPerson.map((m) => (
              <div key={m.id} className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="lp-person-item" data-state={m.state}>
                <p className="font-semibold"><bdi>{m.representativeEmail}</bdi>{m.structureName ? <> — <bdi>{m.structureName}</bdi></> : null}</p>
                <p>{L.measure[m.measure] || m.measure} · {L.kind[m.representativeKind]}</p>
                <p><strong>{L.state[m.state] || m.state}</strong></p>
                {m.powers ? (<>
                  <p>{L.mode[m.powers.mode]}</p>
                  <p>{t('legalprotection:person.areas', 'Ce que la décision couvre ici : {{areas}}.', { areas: m.powers.areas.map((a) => L.area[a]).join(', ') })}</p>
                  <p>{t('legalprotection:person.until', 'Jusqu’au {{date}}.', { date: day(m.validUntil) })}</p>
                </>) : null}
                {m.verificationNote && ['VERIFIED', 'SUSPENDED', 'REJECTED', 'ENDED', 'EXPIRED'].includes(m.state) ? <p className="text-slate-700">{t('legalprotection:person.note', 'Message de l’administrateur : {{note}}', { note: m.verificationNote })}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => showLog(m.id)}>{t('legalprotection:person.history', 'Voir ce qui a été fait')}</Button>
                  {['DECLARED', 'VERIFIED'].includes(m.state) && !m.contested ? (
                    confirmContest === m.id ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{t('legalprotection:person.contest_confirm', 'L’administrateur va vérifier. Pendant ce temps, cette personne ne peut plus rien faire ici. Continuer ?')}</span>
                        <Button type="button" size="sm" variant="destructive" data-testid="lp-contest-yes" onClick={() => { setConfirmContest(''); run(() => citizenApi.legalProtectionAction({ action: 'contest', id: m.id }), t('legalprotection:person.contested', 'C’est noté. L’administrateur va vérifier.')); }}>{t('legalprotection:yes', 'Oui')}</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmContest('')}>{t('legalprotection:no', 'Non')}</Button>
                      </span>
                    ) : <Button type="button" variant="outline" size="sm" data-testid="lp-contest" onClick={() => setConfirmContest(m.id)}>{t('legalprotection:person.contest', 'Je ne reconnais pas cette personne, ou je ne suis pas d’accord')}</Button>
                  ) : null}
                  {m.contested ? <span className="text-slate-700">{t('legalprotection:person.contest_sent', 'Votre signalement est envoyé à l’administrateur.')}</span> : null}
                </div>
                {logs[m.id] ? <History events={logs[m.id]} L={L} describe={describe} t={t} /> : null}
              </div>
            )) : <p>{t('legalprotection:person.none', 'Personne n’est enregistré comme votre tuteur, curateur ou représentant.')}</p>}
          </CardContent>
        </Card>

        {requests.length ? (
          <Card data-testid="lp-requests">
            <CardHeader><CardTitle className="text-lg">{t('legalprotection:requests.title', 'Demandes à confirmer')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-800">
              {requests.map((r) => (
                <div key={r.id} className="space-y-2 rounded-md border border-slate-200 p-3">
                  <p>{t('legalprotection:requests.line', '{{who}} vous demande de {{what}}.', { who: r.representativeEmail, what: describe(r.type, r.target) })}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" data-testid="lp-request-accept" onClick={() => run(() => citizenApi.legalProtectionAction({ action: 'resolve-request', requestId: r.id, accept: true }), t('legalprotection:requests.done', 'C’est fait.'))}>{t('legalprotection:requests.accept', 'Oui, je suis d’accord')}</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => run(() => citizenApi.legalProtectionAction({ action: 'resolve-request', requestId: r.id, accept: false }), t('legalprotection:requests.declined', 'Refusé : rien n’a été fait.'))}>{t('legalprotection:requests.refuse', 'Non')}</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card data-testid="lp-as-representative">
          <CardHeader><CardTitle className="text-lg">{t('legalprotection:rep.title', 'Je protège une personne')}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-800">
            <p>{t('legalprotection:rep.intro', 'Vous êtes tuteur, curateur, personne habilitée ou mandataire spécial, désigné par un juge. Vous agissez depuis VOTRE compte : vous ne vous connectez jamais au compte de la personne. Elle voit tout ce que vous regardez et faites.')}</p>
            {asRep.map((m) => (
              <div key={m.id} className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="lp-rep-item" data-state={m.state}>
                <p className="font-semibold"><bdi>{m.personEmail}</bdi></p>
                <p>{L.measure[m.measure] || m.measure} · <strong>{L.state[m.state] || m.state}</strong></p>
                {m.powers ? (<>
                  <p>{m.powers.mode === 'ACT' ? t('legalprotection:rep.act', 'Vous pouvez agir dans les parties couvertes ; la personne est prévenue de chaque action.') : t('legalprotection:rep.confirm', 'Vous pouvez regarder et demander ; la personne confirme chaque action.')}</p>
                  <p>{t('legalprotection:person.until', 'Jusqu’au {{date}}.', { date: day(m.validUntil) })}</p>
                  <div className="flex flex-wrap gap-2">
                    {m.powers.areas.includes('RDV') ? <Button type="button" size="sm" variant="outline" data-testid="lp-view-rdv" onClick={() => showView(m.id, 'rdv')}>{t('legalprotection:rep.view_rdv', 'Voir ses rendez-vous')}</Button> : null}
                    {m.powers.areas.includes('PARCOURS') ? <Button type="button" size="sm" variant="outline" data-testid="lp-view-parcours" onClick={() => showView(m.id, 'parcours')}>{t('legalprotection:rep.view_parcours', 'Voir Mon Parcours')}</Button> : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => getCode(m.id)}>{t('legalprotection:rep.code', 'Code pour le mode accompagnant')}</Button>
                  </div>
                  {codes[m.id] ? <p data-testid="lp-code">{t('legalprotection:rep.code_value', 'Code à donner à la personne, à côté d’elle : {{code}} (valable jusqu’à {{time}}).', { code: codes[m.id].code, time: formatDate(codes[m.id].validUntil, { timeStyle: 'short' }) })}</p> : null}
                  {views[`${m.id}:rdv`] ? (
                    <ul className="space-y-1" aria-label={t('legalprotection:rep.view_rdv', 'Voir ses rendez-vous')}>
                      {(views[`${m.id}:rdv`].appointments || []).map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                          <span>{formatDate(a.startAt, { dateStyle: 'medium', timeStyle: 'short' })} — <bdi>{a.structure}</bdi></span>
                          <Button type="button" size="sm" variant="outline" onClick={() => act(m.id, { type: 'RDV_CANCEL', appointmentId: a.id }, 'rdv')}>{m.powers.mode === 'ACT' ? t('legalprotection:rep.cancel', 'Annuler') : t('legalprotection:rep.ask_cancel', 'Demander l’annulation')}</Button>
                        </li>
                      ))}
                      {(views[`${m.id}:rdv`].appointments || []).length ? null : <li>{t('legalprotection:rep.no_rdv', 'Aucun rendez-vous à venir.')}</li>}
                    </ul>
                  ) : null}
                  {views[`${m.id}:parcours`] ? (
                    <ul className="space-y-1" aria-label={t('legalprotection:rep.view_parcours', 'Voir Mon Parcours')}>
                      {(views[`${m.id}:parcours`].items || []).map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2">
                          <span>{i.title} — {M.parcoursStatus?.[i.status] || i.status}</span>
                          <label className="sr-only" htmlFor={ids(`st-${i.id}`)}>{t('legalprotection:rep.new_status', 'Nouvel état')}</label>
                          <select id={ids(`st-${i.id}`)} defaultValue="" className="min-h-11 rounded-md border border-slate-300 bg-white px-2"
                            onChange={(e) => { if (e.target.value) act(m.id, { type: 'PARCOURS_STATUS', itemId: i.id, status: e.target.value }, 'parcours'); }}>
                            <option value="">{t('legalprotection:rep.new_status', 'Nouvel état')}</option>
                            {Object.entries(M.parcoursStatus || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </li>
                      ))}
                      {views[`${m.id}:parcours`].hiddenSensitive ? <li className="text-slate-700">{t('legalprotection:rep.hidden', 'Certaines étapes sensibles ne vous sont pas montrées.')}</li> : null}
                    </ul>
                  ) : null}
                </>) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => showLog(m.id)}>{t('legalprotection:person.history', 'Voir ce qui a été fait')}</Button>
                  {['DECLARED', 'VERIFIED', 'SUSPENDED'].includes(m.state) ? <Button type="button" size="sm" variant="outline" onClick={() => run(() => citizenApi.legalProtectionAction({ action: 'renounce', id: m.id }), t('legalprotection:rep.renounced', 'Lien terminé sur ce service. La mesure elle-même ne prend fin que par décision du juge.'))}>{t('legalprotection:rep.renounce', 'Terminer ce lien')}</Button> : null}
                </div>
                {logs[m.id] ? <History events={logs[m.id]} L={L} describe={describe} t={t} /> : null}
              </div>
            ))}

            <form onSubmit={declare} className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="lp-declare" aria-labelledby={ids('declare')}>
              <h2 id={ids('declare')} className="text-base font-semibold">{t('legalprotection:declare.title', 'Déclarer une décision du juge')}</h2>
              <p>{t('legalprotection:declare.no_file', 'N’envoyez pas la décision ici. L’administrateur vous contactera pour l’examiner. Seules les informations ci-dessous sont gardées.')}</p>
              <Field id={ids('email')} label={t('legalprotection:declare.email', 'Adresse e-mail du compte de la personne protégée')}><input id={ids('email')} type="email" required autoComplete="off" value={form.personEmail} onChange={(e) => set('personEmail', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></Field>
              <fieldset className="space-y-1"><legend className="font-medium">{t('legalprotection:declare.kind', 'Vous êtes')}</legend>
                {['FAMILLE', 'MJPM'].map((k) => <label key={k} className="flex min-h-11 items-center gap-2"><input type="radio" name={ids('kind')} value={k} checked={form.representativeKind === k} onChange={() => set('representativeKind', k)} />{L.kind[k]}</label>)}
              </fieldset>
              {form.representativeKind === 'MJPM' ? (<>
                <Field id={ids('form')} label={t('legalprotection:declare.form', 'Vous exercez comme')}>
                  <select id={ids('form')} required value={form.mjpmForm} onChange={(e) => set('mjpmForm', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3">
                    <option value="">{t('legalprotection:choose', '— Choisir —')}</option>
                    {Object.entries(L.form).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field id={ids('siret')} label={t('legalprotection:declare.siret', 'SIRET de votre service ou de votre activité (facultatif)')}><input id={ids('siret')} inputMode="numeric" value={form.siret} onChange={(e) => set('siret', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></Field>
              </>) : null}
              <Field id={ids('measure')} label={t('legalprotection:declare.measure', 'Mesure prononcée')}>
                <select id={ids('measure')} required value={form.measure} onChange={(e) => set('measure', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3">
                  <option value="">{t('legalprotection:choose', '— Choisir —')}</option>
                  {Object.entries(L.measure).filter(([k]) => form.representativeKind === 'FAMILLE' || !FAMILY_ONLY.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              {BOTH_MODES.includes(form.measure) ? (
                <fieldset className="space-y-1"><legend className="font-medium">{t('legalprotection:declare.mode', 'La décision vous charge de')}</legend>
                  <label className="flex min-h-11 items-center gap-2"><input type="radio" name={ids('mode')} checked={form.mode === 'REPRESENTATION'} onChange={() => set('mode', 'REPRESENTATION')} />{t('legalprotection:declare.representation', 'représenter la personne (agir à sa place)')}</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="radio" name={ids('mode')} checked={form.mode === 'ASSISTANCE'} onChange={() => set('mode', 'ASSISTANCE')} />{t('legalprotection:declare.assistance', 'assister la personne (agir avec elle)')}</label>
                </fieldset>
              ) : null}
              <fieldset className="space-y-1"><legend className="font-medium">{t('legalprotection:declare.scope', 'La mesure porte sur')}</legend>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={form.scopePerson} onChange={(e) => set('scopePerson', e.target.checked)} />{t('legalprotection:declare.scope_person', 'la protection de la personne')}</label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={form.scopeAssets} onChange={(e) => set('scopeAssets', e.target.checked)} />{t('legalprotection:declare.scope_assets', 'ses biens (patrimoine, ressources)')}</label>
              </fieldset>
              <Field id={ids('court')} label={t('legalprotection:declare.court', 'Tribunal (par exemple : tribunal judiciaire de Strasbourg)')}><input id={ids('court')} required maxLength={120} value={form.courtName} onChange={(e) => set('courtName', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></Field>
              <Field id={ids('ddate')} label={t('legalprotection:declare.date', 'Date de la décision')}><input id={ids('ddate')} type="date" required value={form.decisionDate} onChange={(e) => set('decisionDate', e.target.value)} className="min-h-11 rounded-md border border-slate-300 px-3" /></Field>
              {NO_TERM.includes(form.measure) ? null : <Field id={ids('end')} label={t('legalprotection:declare.end', 'Date de fin de la mesure (écrite dans la décision)')}><input id={ids('end')} type="date" required value={form.measureEndsOn} onChange={(e) => set('measureEndsOn', e.target.value)} className="min-h-11 rounded-md border border-slate-300 px-3" /></Field>}
              <Field id={ids('ref')} label={t('legalprotection:declare.ref', 'Numéro du dossier au tribunal (facultatif — il n’est pas gardé en clair)')}><input id={ids('ref')} autoComplete="off" maxLength={40} value={form.decisionRef} onChange={(e) => set('decisionRef', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></Field>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={form.truthful} onChange={(e) => set('truthful', e.target.checked)} />{t('legalprotection:declare.truthful', 'Je certifie que cette décision existe, qu’elle me désigne et qu’elle est en cours. Une fausse déclaration met fin au lien et peut entraîner la suspension de mon compte.')}</label>
              <Field id={ids('pw')} label={t('legalprotection:declare.password', 'Votre mot de passe (pour confirmer que c’est vous)')}><input id={ids('pw')} type="password" required autoComplete="current-password" value={form.password} onChange={(e) => set('password', e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" /></Field>
              <Button type="submit" data-testid="lp-declare-submit">{t('legalprotection:declare.submit', 'Déclarer')}</Button>
            </form>
          </CardContent>
        </Card>
      </>) : null}
    </div>
  );
}

function Field({ id, label, children }) {
  return <div className="space-y-1"><label htmlFor={id} className="block font-medium">{label}</label>{children}</div>;
}

function History({ events, L, describe, t }) {
  if (!events.length) return <p>{t('legalprotection:history.none', 'Rien pour le moment.')}</p>;
  return (
    <ul className="space-y-1 border-s-2 border-slate-200 ps-3" data-testid="lp-history">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          {formatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' })} — {L.event[e.event] || e.event}{e.type ? ` : ${describe(e.type, e.target)}` : ''}
        </li>
      ))}
    </ul>
  );
}
