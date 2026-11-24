// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';

const AREAS = ['RDV', 'PARCOURS', 'PROFIL', 'COFFRE'];
const ROLES = ['PROCHE', 'TRAVAILLEUR_SOCIAL', 'CONSEILLER_FRANCE_SERVICES', 'BENEVOLE', 'AUTRE', 'REPRESENTANT_LEGAL'];   // G14-R3G: the verified representative (code of the link)
const MINUTES = [30, 60, 120];
const PRO_FORBIDDEN = ['COFFRE'];

/** the person-facing labels of the « mode accompagnant » @param {(k: string, d: string, o?: any) => string} t */
function assistLabels(t) {
  return {
    role: {
      PROCHE: t('compte:assist.role.proche', 'Un proche (famille, ami)'),
      TRAVAILLEUR_SOCIAL: t('compte:assist.role.travailleur_social', 'Un travailleur social'),
      CONSEILLER_FRANCE_SERVICES: t('compte:assist.role.france_services', 'Un conseiller France Services'),
      BENEVOLE: t('compte:assist.role.benevole', 'Un bénévole d’association'),
      AUTRE: t('compte:assist.role.autre', 'Une autre personne'),
      REPRESENTANT_LEGAL: t('legalprotection:assist.role', 'Mon tuteur, curateur ou représentant désigné par le juge'),
    },
    area: {
      RDV: t('compte:assist.area.rdv', 'Mes rendez-vous : les voir, en prendre, les déplacer ou les annuler, et les messages'),
      PARCOURS: t('compte:assist.area.parcours', 'Mon Parcours : voir et mettre à jour mes démarches'),
      PROFIL: t('compte:assist.area.profil', 'Mon profil : voir et corriger mes informations'),
      COFFRE: t('compte:assist.area.coffre', 'Mon Coffre : voir et télécharger mes documents'),
    },
    areaShort: {
      RDV: t('compte:assist.area_short.rdv', 'mes rendez-vous'),
      PARCOURS: t('compte:assist.area_short.parcours', 'Mon Parcours'),
      PROFIL: t('compte:assist.area_short.profil', 'mon profil'),
      COFFRE: t('compte:assist.area_short.coffre', 'Mon Coffre'),
    },
    action: {
      RDV_BOOKED: t('compte:assist.action.rdv_booked', 'Rendez-vous pris'),
      RDV_CANCELLED: t('compte:assist.action.rdv_cancelled', 'Rendez-vous annulé'),
      RDV_MOVED: t('compte:assist.action.rdv_moved', 'Rendez-vous déplacé'),
      RDV_OTHER: t('compte:assist.action.rdv_other', 'Action sur un rendez-vous'),
      MESSAGE_SENT: t('compte:assist.action.message_sent', 'Message envoyé'),
      PARCOURS_CHANGED: t('compte:assist.action.parcours_changed', 'Mon Parcours modifié'),
      PROFILE_CHANGED: t('compte:assist.action.profile_changed', 'Profil modifié'),
      OTHER: t('compte:assist.action.other', 'Autre action'),
    },
    ended: {
      PERSON: t('compte:assist.ended.person', 'arrêté par vous'),
      PERSON_CONTINUED_ALONE: t('compte:assist.ended.alone', 'arrêté par vous (vous avez continué seul ou seule)'),
      PERSON_OTHER_DEVICE: t('compte:assist.ended.other_device', 'arrêté par vous depuis un autre appareil'),
      SIGN_OUT: t('compte:assist.ended.sign_out', 'arrêté par la déconnexion'),
    },
  };
}

/**
 * G14-AID — « Mode accompagnant » (/compte/accompagnement): someone helps the person on the person's OWN account, next to them. The person chooses who
 * (name, role, structure; an ADA Pro member proves it with a code), what (areas), how long (2 h at most), reads what the helper can never do, gives consent
 * and confirms with their password. The server enforces everything (api/_services/assisted-mode.js); this page explains it in plain words (FALC).
 */
export default function CompteAccompagnement() {
  const { t } = useT('compte');
  const L = assistLabels(t);
  const [state, setState] = useState({ loading: true, error: '', unauth: false, current: null, sessions: [] });
  const [form, setForm] = useState({ helperName: '', helperRole: 'PROCHE', structureName: '', isPro: false, proEmail: '', proCode: '', representativeCode: '', areas: ['RDV'], minutes: 60, consent: false, password: '' });
  const [endPw, setEndPw] = useState('');
  const [problem, setProblem] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await citizenApi.assistOverview(); setState({ loading: false, error: '', unauth: false, current: d.current, sessions: d.sessions || [] }); }
    catch (err) {
      setState({ loading: false, unauth: err.status === 401, current: null, sessions: [],
        error: err.status === 401 ? t('compte:assist.login_required', 'Connectez-vous pour utiliser le mode accompagnant.') : err.status === 503 ? t('compte:assist.not_open', 'Le mode accompagnant n’est pas encore ouvert sur ce service.') : err.message });
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; messages follow the language at load time
  useEffect(() => { load(); }, [load]);
  const areasAllowed = AREAS.filter((a) => !(form.isPro && PRO_FORBIDDEN.includes(a)));
  const toggleArea = (a) => setForm((f) => ({ ...f, areas: f.areas.includes(a) ? f.areas.filter((x) => x !== a) : [...f.areas, a] }));
  const start = async (e) => {
    e.preventDefault(); setProblem(''); setMessage(''); setBusy(true);
    try {
      const body = { helperName: form.helperName, helperRole: form.helperRole, structureName: form.structureName || undefined, areas: form.areas.filter((a) => areasAllowed.includes(a)),
        minutes: form.minutes, consent: form.consent, password: form.password, ...(form.helperRole === 'REPRESENTANT_LEGAL' ? { representativeCode: form.representativeCode } : form.isPro ? { proEmail: form.proEmail, proCode: form.proCode } : {}) };
      await citizenApi.startAssist(body);
      window.location.assign('/compte');   // a fresh page: the header and the banner read the new (assisted) session
    } catch (err) { setProblem(err.message); setForm((f) => ({ ...f, password: '' })); } finally { setBusy(false); }
  };
  const endNow = async () => {
    setProblem(''); setBusy(true);
    try { await citizenApi.endAssist(); window.location.assign('/'); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const continueAlone = async (e) => {
    e.preventDefault(); setProblem(''); setBusy(true);
    try { await citizenApi.endAssist({ continueAlone: true, password: endPw }); window.location.assign('/compte'); } catch (err) { setProblem(err.message); setEndPw(''); } finally { setBusy(false); }
  };
  const stopOther = async (sid) => {
    setProblem(''); setMessage('');
    try { await citizenApi.endAssistSession(sid); setMessage(t('compte:assist.stopped', 'Le mode accompagnant est arrêté sur cet autre appareil.')); await load(); } catch (err) { setProblem(err.message); }
  };
  const helperLine = (h) => [h.name, L.role[h.role] || h.role, h.structureName].filter(Boolean).join(' — ') + (h.verifiedPro ? ` (${t('compte:assist.verified_pro', 'membre ADA Pro vérifié')})` : '');
  const eventLine = (s, e) => {
    if (e.kind === 'ACTION') return t('compte:assist.event_action', '{{label}} — fait avec l’aide de {{name}}', { label: L.action[e.label] || L.action.OTHER, name: s.helper.name });
    if (e.kind === 'VIEW') return t('compte:assist.event_view', 'Consultation : {{area}}', { area: L.areaShort[e.area] || e.area });
    return t('compte:assist.event_refused', 'Tentative refusée : une partie non ouverte du compte');
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:assist.loading', 'Chargement…')}</div>;
  const field = 'mt-1 w-full rounded-md border border-slate-300 p-2';
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-accompagnement">
      <SEO title={t('compte:assist.title', 'Mode accompagnant')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:assist.title', 'Mode accompagnant')}</h1>
      <div className="space-y-2 text-slate-800">
        <p>{t('compte:assist.intro1', 'Une personne peut vous aider à utiliser votre compte. Elle est à côté de vous, sur votre téléphone ou votre ordinateur.')}</p>
        <p>{t('compte:assist.intro2', 'Vous choisissez ce qu’elle peut faire. Vous pouvez arrêter quand vous voulez. Cela s’arrête tout seul au bout de 2 heures au plus.')}</p>
        <p>{t('compte:assist.intro3', 'Pour une aide à distance, utilisez plutôt les « Personnes de confiance ».')} <Link className="text-blue-800 underline" to="/compte/delegations">{t('compte:assist.trusted_link', 'Personnes de confiance')}</Link></p>
        <p className="text-sm text-slate-700">{t('compte:assist.not_mandate', 'Ce mode ne remplace pas une tutelle, une curatelle ou un mandat. Il n’est pas prévu pour les mineurs.')}</p>
      </div>
      {state.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{state.error}</p>
          {state.unauth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=%2Fcompte%2Faccompagnement">{t('compte:assist.sign_in', 'Se connecter')}</Link></Button> : null}
        </div>
      ) : null}
      {problem ? <p role="alert" data-testid="assist-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>

      {state.error ? null : state.current ? (
        <Card data-testid="assist-current">
          <CardHeader><CardTitle className="text-lg">{t('compte:assist.current_title', 'Le mode accompagnant est en cours')}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-800">
            <p>{t('compte:assist.current_who', '{{name}} vous aide jusqu’à {{time}}.', { name: state.current.helper.name, time: formatDate(state.current.until, { timeStyle: 'short' }) })}</p>
            <p>{t('compte:assist.current_areas', 'Ce qui est ouvert :')} {state.current.areas.map((a) => L.areaShort[a] || a).join(', ')}</p>
            <Button type="button" onClick={endNow} disabled={busy} className="w-full sm:w-auto" data-testid="assist-end-now">{t('compte:assist.end_now', 'Arrêter maintenant (déconnexion)')}</Button>
            <form onSubmit={continueAlone} className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="assist-continue-form">
              <p>{t('compte:assist.continue_help', 'Pour continuer seul ou seule sans vous déconnecter, tapez votre mot de passe. La personne qui vous aide ne doit pas le voir.')}</p>
              <label htmlFor="assist-end-pw" className="block">{t('compte:assist.password', 'Votre mot de passe')}</label>
              <input id="assist-end-pw" type="password" required autoComplete="current-password" className={field} value={endPw} onChange={(e) => setEndPw(e.target.value)} data-testid="assist-continue-password" />
              <Button type="submit" variant="outline" disabled={busy} className="w-full sm:w-auto" data-testid="assist-continue">{t('compte:assist.continue', 'Continuer seul ou seule')}</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-lg">{t('compte:assist.start_title', 'Commencer avec une personne qui m’aide')}</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={start} data-testid="assist-form">
              <div><label htmlFor="assist-name" className="block text-sm text-slate-800">{t('compte:assist.helper_name', 'Nom de la personne qui vous aide')}</label>
                <input id="assist-name" required minLength={2} maxLength={80} autoComplete="off" className={field} value={form.helperName} onChange={(e) => setForm({ ...form, helperName: e.target.value })} data-testid="assist-helper-name" /></div>
              <div><label htmlFor="assist-role" className="block text-sm text-slate-800">{t('compte:assist.helper_role', 'Qui est cette personne ?')}</label>
                <select id="assist-role" className={field} value={form.helperRole} onChange={(e) => setForm({ ...form, helperRole: e.target.value })} data-testid="assist-helper-role">
                  {ROLES.map((r) => <option key={r} value={r}>{L.role[r]}</option>)}
                </select></div>
              {form.helperRole === 'REPRESENTANT_LEGAL' ? (
                <div><label htmlFor="assist-rep-code" className="block text-sm text-slate-800">{t('legalprotection:assist.code', 'Le code à 8 chiffres qu’il ou elle vous montre (page « Protection juridique » de son compte)')}</label>
                  <input id="assist-rep-code" required inputMode="numeric" autoComplete="one-time-code" dir="ltr" className={field} value={form.representativeCode} onChange={(e) => setForm({ ...form, representativeCode: e.target.value })} data-testid="assist-rep-code" /></div>
              ) : null}
              {form.helperRole !== 'PROCHE' && form.helperRole !== 'REPRESENTANT_LEGAL' && !form.isPro ? (
                <div><label htmlFor="assist-structure" className="block text-sm text-slate-800">{t('compte:assist.structure', 'Sa structure (facultatif)')}</label>
                  <input id="assist-structure" maxLength={120} autoComplete="off" className={field} value={form.structureName} onChange={(e) => setForm({ ...form, structureName: e.target.value })} data-testid="assist-structure" /></div>
              ) : null}
              {form.helperRole === 'REPRESENTANT_LEGAL' ? null : <div className="rounded-md border border-slate-200 p-3">
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.isPro} onChange={(e) => setForm({ ...form, isPro: e.target.checked })} data-testid="assist-is-pro" />
                  <span>{t('compte:assist.is_pro', 'Cette personne travaille avec ADA Pro : elle me donne un code')}</span></label>
                {form.isPro ? (
                  <div className="mt-2 space-y-2">
                    <div><label htmlFor="assist-pro-email" className="block text-sm text-slate-800">{t('compte:assist.pro_email', 'Son adresse e-mail professionnelle')}</label>
                      <input id="assist-pro-email" type="email" required autoComplete="off" className={field} value={form.proEmail} onChange={(e) => setForm({ ...form, proEmail: e.target.value })} data-testid="assist-pro-email" /></div>
                    <div><label htmlFor="assist-pro-code" className="block text-sm text-slate-800">{t('compte:assist.pro_code', 'Le code à 8 chiffres qu’elle vous montre')}</label>
                      <input id="assist-pro-code" required inputMode="numeric" autoComplete="one-time-code" dir="ltr" className={field} value={form.proCode} onChange={(e) => setForm({ ...form, proCode: e.target.value })} data-testid="assist-pro-code" /></div>
                    <p className="text-sm text-slate-700">{t('compte:assist.pro_no_coffre', 'Un professionnel ne peut jamais ouvrir Mon Coffre dans ce mode.')}</p>
                  </div>
                ) : null}
              </div>}
              <fieldset><legend className="text-sm font-medium text-slate-800">{t('compte:assist.areas', 'Ce qu’elle pourra faire avec vous')}</legend>
                {areasAllowed.map((a) => (
                  <label key={a} className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.areas.includes(a)} onChange={() => toggleArea(a)} data-testid={`assist-area-${a}`} /><span>{L.area[a]}</span></label>
                ))}
              </fieldset>
              <fieldset><legend className="text-sm font-medium text-slate-800">{t('compte:assist.duration', 'Pendant combien de temps ?')}</legend>
                <div className="mt-1 flex flex-wrap gap-4">
                  {MINUTES.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm"><input type="radio" name="assist-minutes" checked={form.minutes === m} onChange={() => setForm({ ...form, minutes: m })} data-testid={`assist-minutes-${m}`} />
                      {m === 120 ? t('compte:assist.m120', '2 heures') : m === 60 ? t('compte:assist.m60', '1 heure') : t('compte:assist.m30', '30 minutes')}</label>
                  ))}
                </div>
              </fieldset>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="assist-never">
                <p className="font-medium">{t('compte:assist.never_title', 'Elle ne pourra jamais :')}</p>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  <li>{t('compte:assist.never_password', 'changer votre mot de passe, votre adresse e-mail ou votre numéro de téléphone ;')}</li>
                  <li>{t('compte:assist.never_delete', 'supprimer votre compte ou télécharger toutes vos données ;')}</li>
                  <li>{t('compte:assist.never_share', 'donner un accès à une autre personne ;')}</li>
                  <li>{t('compte:assist.never_coffre', 'ouvrir Mon Coffre, sauf si vous le cochez (jamais pour un professionnel).')}</li>
                </ul>
                <p className="mt-2">{t('compte:assist.logged', 'Tout ce qu’elle consulte ou fait est noté dans votre historique, avec son nom.')}</p>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} data-testid="assist-consent" />
                <span>{t('compte:assist.consent', 'J’accepte que cette personne m’aide sur mon compte, pour ce que j’ai choisi et pendant la durée choisie.')}</span></label>
              <div><label htmlFor="assist-pw" className="block text-sm text-slate-800">{t('compte:assist.password_start', 'Votre mot de passe (pour confirmer que c’est bien vous)')}</label>
                <input id="assist-pw" type="password" required autoComplete="current-password" className={field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="assist-password" />
                <p className="mt-1 text-xs text-slate-700">{t('compte:assist.password_private', 'Tapez-le vous-même. Ne le donnez pas à la personne qui vous aide.')}</p></div>
              <Button type="submit" disabled={busy || !form.consent || !form.areas.some((a) => areasAllowed.includes(a))} className="w-full sm:w-auto" data-testid="assist-start">{t('compte:assist.start', 'Commencer')}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {state.error ? null : (
        <Card>
          <CardHeader><CardTitle className="text-lg">{t('compte:assist.history_title', 'Historique de l’aide reçue')}</CardTitle></CardHeader>
          <CardContent>
            {state.sessions.length ? (
              <ul className="space-y-3" data-testid="assist-history">
                {state.sessions.map((s) => (
                  <li key={s.sid} className="space-y-1 rounded-md border border-slate-200 p-2 text-sm" data-testid="assist-history-item">
                    <p><strong>{helperLine(s.helper)}</strong></p>
                    <p className="text-slate-700">{t('compte:assist.history_when', 'Le {{date}}', { date: formatDate(s.startedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}
                      {s.endedAt ? ` — ${L.ended[s.endedBy] || t('compte:assist.ended.done', 'terminé')}` : s.live ? ` — ${t('compte:assist.live', 'en cours')}` : ` — ${t('compte:assist.ended.expired', 'terminé à l’heure prévue')}`}</p>
                    {s.live && !state.current ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={() => stopOther(s.sid)} data-testid="assist-stop-other">{t('compte:assist.stop_other', 'Arrêter maintenant')}</Button> : null}
                    {s.events.length ? <ol className="list-inside list-disc text-slate-800" data-testid="assist-events">{s.events.map((e, i) => <li key={i} data-testid="assist-event">{formatDate(e.at, { timeStyle: 'short' })} — {eventLine(s, e)}</li>)}</ol>
                      : <p className="text-slate-700">{t('compte:assist.no_event', 'Rien n’a été consulté ni fait.')}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-700" data-testid="assist-history-empty">{t('compte:assist.history_empty', 'Personne ne vous a encore aidé avec ce mode.')}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
