// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { csrfFetch } from '@/lib/csrf';
import { Button } from '@/components/ui/button';
import { passwordProblems } from '@/lib/passwordPolicy';
import { passwordRuleText, passwordMessageText } from '@/lib/passwordPolicyText';
import { useT, formatDate, DATE_SHORT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { useCaseLabels } from '@/lib/caseLabelsI18n';
import { methodText } from '@/lib/observatoryMethodText';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { emailMessage, fieldA11y, looksLikeEmail, requiredMessage } from '@/lib/fieldErrors';
import { topicTone } from '@/design/categoryTone';

const KEY = 'institution_token';
const get = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const call = async (path, opts = {}) => {
  const r = await (opts.method && opts.method !== 'GET' ? csrfFetch : fetch)(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(get() ? { Authorization: `Bearer ${get()}` } : {}), ...(opts.headers || {}) } });
  const type = r.headers.get('content-type') || ''; const body = type.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw Object.assign(new Error('api'), { status: r.status, body });
  return body;
};
const n = (v) => (v === null || v === undefined ? '< 5' : v);
const mustChoosePassword = (e) => e?.status === 403 && e?.body?.error === 'PASSWORD_CHANGE_REQUIRED';
// owner decision G1 = b: an account without a defined authorised territory reads no statistic (the server refuses; this only says so)
const scopeUndefined = (e) => e?.status === 403 && e?.body?.error === 'TERRITORY_SCOPE_UNDEFINED';

/**
 * PKG-5 / I01 I03 I04 — institutional space (/institution): separate login, aggregate statistics only (observatoire with its methodology, territorial export when
 * ADA opens it). No dossier, person or organization is ever shown.
 * R21: « Mon mot de passe » (current password, shared rule, the other sessions end); a temporary password (initial or handed over by ADA) is replaced before
 * anything else is shown; « Se déconnecter » ends the sessions on the server; an ended session says so; a lost password is handed over again by ADA.
 * R24 (owner decision R21.1): « Mot de passe oublié » also sends a reset link to the registered address (Recuperation.jsx); ADA's hand-over stays the fallback.
 */
function PasswordForm({ temporary, onChanged }) {
  const { t } = useT('institution');
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [error, setError] = useState(''); const [done, setDone] = useState(''); const [busy, setBusy] = useState(false);
  // R43 (A5): each field says its own problem (the three were one banner); the summary receives the focus; the server's refusal stays a banner
  const pwErr = useFormErrors();
  // a weak password keeps the R21 contract: the shared rule's message is the alert banner (institution-password-error), the field is marked invalid, keeps
  // its description « pw-rule » (the rule it fails) and receives the focus
  const [weak, setWeak] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError(''); setDone(''); setWeak(false);
    const errs = {};
    if (!cur) errs['pw-cur'] = requiredMessage(t, t('institution:space.mot_passe_actuel', 'Mot de passe actuel'));
    const problems = passwordProblems(next);
    if (!next) errs['pw-new'] = requiredMessage(t, t('institution:space.nouveau_mot_passe', 'Nouveau mot de passe'));
    if (!errs['pw-new'] && !errs['pw-cur'] && problems.length) {
      pwErr.reset(); setWeak(true); setError(passwordMessageText(problems));
      document.getElementById('pw-new')?.focus();
      return;
    }
    if (!errs['pw-new'] && !problems.length && next !== again) errs['pw-again'] = t('institution:space.pw_mismatch', 'Les deux saisies du nouveau mot de passe sont différentes.');
    if (!pwErr.check(errs)) return;
    setBusy(true);
    try {
      const out = await call('/api/institution/password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: next }) });
      sessionStorage.setItem(KEY, out.token); setCur(''); setNext(''); setAgain(''); setDone(out.message || t('institution:space.pw_changed', 'Mot de passe modifié.')); onChanged();
    } catch (x) { if (x.status === 401) onChanged(x); else setError(x.body?.message || t('institution:space.pw_failed', 'Modification impossible pour le moment. Réessayez.')); }
    finally { setBusy(false); }
  };
  return (
    <section className="max-w-md space-y-3 rounded border p-3" aria-labelledby="pw-h" data-testid="institution-password">
      <h2 id="pw-h" className="text-xl font-semibold">{temporary ? t('institution:space.pw_choose', 'Choisissez votre mot de passe') : t('institution:space.pw_mine', 'Mon mot de passe')}</h2>
      {temporary ? <p className="text-sm" data-testid="institution-temporary">{t('institution:space.vous_etes_connecte_avec', 'Vous êtes connecté avec un mot de passe provisoire remis par ADA. Choisissez votre propre mot de passe pour accéder aux statistiques.')}</p> : null}
      {error ? <p role="alert" className="text-red-800" data-testid="institution-password-error">{error}</p> : null}
      <p role="status" className="text-green-800" data-testid="institution-password-done">{busy ? t('common:form.status.saving', 'Enregistrement en cours…') : done}</p>
      <form onSubmit={submit} className="space-y-3" noValidate aria-busy={busy || undefined}>
        <ErrorSummary ref={pwErr.summaryRef} errors={pwErr.errors} order={['pw-cur', 'pw-new', 'pw-again']} testid="institution-password-errors" />
        <div><label htmlFor="pw-cur" className="block">{t('institution:space.mot_passe_actuel', 'Mot de passe actuel')}</label><input id="pw-cur" type="password" autoComplete="current-password" className="w-full rounded border p-2" value={cur} {...fieldA11y('pw-cur', pwErr.errors)} onChange={(e) => { setCur(e.target.value); pwErr.clear('pw-cur'); }} aria-required="true" /><FieldError field="pw-cur" errors={pwErr.errors} /></div>
        <div><label htmlFor="pw-new" className="block">{t('institution:space.nouveau_mot_passe', 'Nouveau mot de passe')}</label><input id="pw-new" type="password" autoComplete="new-password" className="w-full rounded border p-2" value={next} {...fieldA11y('pw-new', pwErr.errors, 'pw-rule')} {...(weak ? { 'aria-invalid': true } : {})} onChange={(e) => { setNext(e.target.value); pwErr.clear('pw-new'); setWeak(false); }} aria-required="true" />
          <p id="pw-rule" className="text-sm">{passwordRuleText()}</p><FieldError field="pw-new" errors={pwErr.errors} /></div>
        <div><label htmlFor="pw-again" className="block">{t('institution:space.confirmer_nouveau_mot_passe', 'Confirmer le nouveau mot de passe')}</label><input id="pw-again" type="password" autoComplete="new-password" className="w-full rounded border p-2" value={again} {...fieldA11y('pw-again', pwErr.errors)} onChange={(e) => { setAgain(e.target.value); pwErr.clear('pw-again'); }} aria-required="true" /><FieldError field="pw-again" errors={pwErr.errors} /></div>
        <Button type="submit" disabled={busy}>{t('institution:space.changer_mot_passe', 'Changer le mot de passe')}</Button>
        <p className="text-sm">{t('institution:space.vos_autres_sessions_seront', 'Vos autres sessions seront fermées.')}</p>
      </form>
    </section>
  );
}


export default function InstitutionEspace() {
  const { t } = useT('institution');
  const needLabel = useCaseLabels().reason;   // audit A17: the table printed the raw reason code (ACCESS_TO_RIGHTS…); an unknown code stays as it is
  const fr = useFrAttrs();   // R47: the organisation's name and territory stay French (lang="fr" outside French)
  const [logged, setLogged] = useState(Boolean(get())); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [me, setMe] = useState(null); const [obs, setObs] = useState(null); const [noScope, setNoScope] = useState(false); const [problem, setProblem] = useState(''); const [notice, setNotice] = useState(''); const period = 'quarter';
  const ended = useCallback(() => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } setLogged(false); setMe(null); setObs(null);
    setNotice(t('institution:space.session_ended', 'Votre session a pris fin (déconnexion, changement de mot de passe, fin de convention ou 8 heures écoulées). Reconnectez-vous.')); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- t: the message follows the language when it is shown
  // the server refuses everything but « me » and the password change to a temporary password (403 PASSWORD_CHANGE_REQUIRED): show the form, not an error
  const passwordRequired = useCallback(() => { setObs(null); setMe((m) => ({ ...(m || {}), temporaryPassword: true })); }, []);
  const load = useCallback(async () => {
    try { const m = await call('/api/institution/me'); setMe(m); setNoScope(m.territoryScope?.defined === false); setObs(m.temporaryPassword || m.territoryScope?.defined === false ? null : await call('/api/institution/observatoire')); }
    catch (e) { if (e.status === 401) ended(); else if (mustChoosePassword(e)) passwordRequired(); else if (scopeUndefined(e)) { setObs(null); setNoScope(true); } else setProblem(t('institution:space.load_failed', 'Chargement impossible.')); }
  }, [ended, passwordRequired]);   // eslint-disable-line react-hooks/exhaustive-deps -- t: the message follows the language when it is shown
  useEffect(() => { if (logged) load(); }, [logged, load]);
  const loginErr = useFormErrors();
  const login = async (e) => {
    e.preventDefault(); setProblem(''); setNotice('');
    // R43 (A5): an empty or malformed field is said on the field; a refused sign-in stays one banner (it does not say which field is wrong, on purpose)
    const errs = {};
    if (!email.trim()) errs['inst-email'] = requiredMessage(t, t('institution:space.adresse_mail', 'Adresse e-mail'));
    else if (!looksLikeEmail(email)) errs['inst-email'] = emailMessage(t, t('institution:space.adresse_mail', 'Adresse e-mail'));
    if (!password) errs['inst-pass'] = requiredMessage(t, t('institution:space.mot_passe', 'Mot de passe'));
    if (!loginErr.check(errs)) return;
    try { const out = await call('/api/institution/login', { method: 'POST', body: JSON.stringify({ email, password }) }); sessionStorage.setItem(KEY, out.token); setPassword(''); setLogged(true); }
    catch (x) { setProblem(x.body?.message || t('institution:space.login_failed', 'Connexion impossible : vérifiez vos identifiants.')); }
  };
  const exportCsv = async () => {
    setProblem('');
    try {
      const csv = await call(`/api/institution/export?period=${period}`);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = `territoire-${period}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (x) { if (x.status === 401) ended(); else if (mustChoosePassword(x)) passwordRequired(); else if (scopeUndefined(x)) { setObs(null); setNoScope(true); } else setProblem(x.body?.message || t('institution:space.export_failed', 'Export impossible.')); }
  };
  const logout = async () => {
    setProblem('');
    let failed = false;
    try { await call('/api/institution/logout', { method: 'POST', body: '{}' }); } catch (x) { failed = x.status !== 401; }
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setLogged(false); setMe(null); setObs(null);
    setNotice(failed ? t('institution:space.logout_partial', 'Déconnecté de ce navigateur, mais la déconnexion des autres appareils a échoué : fermez votre navigateur.') : t('institution:space.logout_done', 'Vous êtes déconnecté sur tous vos appareils.'));
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="institution-space">
      <SEO title={t('institution:space.espace_institutionnel', 'Espace institutionnel')} description={t('institution:space.statistiques_territoriales_agregees', 'Statistiques territoriales agrégées')} path="/institution" noindex={true} />
      <h1 className="text-2xl font-bold">{t('institution:space.espace_institutionnel', 'Espace institutionnel')}</h1>
      {problem ? <p role="alert" className="text-red-800" data-testid="institution-problem">{problem}</p> : null}
      <p role="status" data-testid="institution-notice">{notice}</p>
      {!logged ? (
        <form onSubmit={login} className="max-w-md space-y-3" noValidate>
          <p className="text-sm">{t('institution:space.reserve_aux_partenaires_ayant', 'Réservé aux partenaires ayant signé une convention avec Accès Direct Aide. Cet espace montre seulement des statistiques agrégées.')}</p>
          <ErrorSummary ref={loginErr.summaryRef} errors={loginErr.errors} order={['inst-email', 'inst-pass']} testid="institution-login-errors" />
          <div><label htmlFor="inst-email" className="block">{t('institution:space.adresse_mail', 'Adresse e-mail')}</label><input id="inst-email" type="email" autoComplete="username" className="w-full rounded border p-2" value={email} {...fieldA11y('inst-email', loginErr.errors)} onChange={(e) => { setEmail(e.target.value); loginErr.clear('inst-email'); }} aria-required="true" /><FieldError field="inst-email" errors={loginErr.errors} /></div>
          <div><label htmlFor="inst-pass" className="block">{t('institution:space.mot_passe', 'Mot de passe')}</label><input id="inst-pass" type="password" autoComplete="current-password" className="w-full rounded border p-2" value={password} {...fieldA11y('inst-pass', loginErr.errors)} onChange={(e) => { setPassword(e.target.value); loginErr.clear('inst-pass'); }} aria-required="true" /><FieldError field="inst-pass" errors={loginErr.errors} /></div>
          <Button type="submit">{t('institution:space.connecter', 'Se connecter')}</Button>
          <p className="text-sm" data-testid="institution-forgot">{t('institution:space.mot_passe_oublie_compte', 'Mot de passe oublié ou compte verrouillé ?')} <Link to="/institution/mot-de-passe-oublie" className="underline" data-testid="institution-forgot-link">{t('institution:space.recevoir_lien_par_mail', 'Recevoir un lien par e-mail')}</Link>{t('institution:space.sans_acces_cette_adresse', '. Sans accès à cette adresse, écrivez à l’équipe ADA depuis la page')} <Link to="/contact" className="underline">{t('institution:space.contact', 'Contact')}</Link> {t('institution:space.apres_verification_administrateur_vous', ': après vérification, un administrateur vous remet un mot de passe provisoire par un canal séparé.')}</p>
        </form>
      ) : (
        <>
          {me ? <p data-testid="institution-me"><span {...fr}>{me.organisation}</span> {t('institution:space.territoire', '— territoire :')} <span {...fr}>{me.territory}</span></p> : null}
          {me?.temporaryPassword ? <PasswordForm temporary onChanged={(x) => (x ? ended() : load())} /> : null}
          {me?.temporaryPassword ? null : noScope ? <p role="alert" data-testid="institution-no-scope">{t('institution:space.scope_undefined', 'Le territoire autorisé de votre compte n’est pas défini : aucune statistique ne peut être affichée. Contactez ADA.')}</p> : obs ? (
            <section className="space-y-3" aria-labelledby="obs-h">
              <h2 id="obs-h" className="text-xl font-semibold">{t('institution:space.observatoire_orientations', 'Observatoire des orientations')}</h2>
              {obs.window?.withheld ? <p role="status" className="text-sm" data-testid="institution-quarter-withheld">{t('institution:space.quarter_withheld', 'Le dernier trimestre clos n’est pas encore figé : aucune de ses valeurs n’est publiée avant son gel.')}</p> : null}
              <p className="text-sm">{t('institution:space.period_totals_v3', 'Période : du {{from}} au {{to}} (exclu). Orientations envoyées : {{sent}} ; orientations refusées faute de capacité : {{unmet}} ; orientations hors périmètre : {{outOfScope}} ({{note}}).', { from: formatDate(obs.window.from, DATE_SHORT) || obs.window.from, to: formatDate(obs.window.to, DATE_SHORT) || obs.window.to, sent: n(obs.totals.sent), unmet: n(obs.totals.unmet), outOfScope: n(obs.totals.outOfScope), note: obs.totals.note === 'somme des cellules publiées seulement' ? t('institution:space.totals_note', 'somme des cellules publiées seulement') : obs.scope?.totalsBasis === 'byCommune' ? t('institution:space.totals_note_commune', 'somme des cellules publiées du tableau par commune seulement') : obs.totals.note })}</p>
              {obs.scope?.byNeed === 'NONE' ? <p className="text-sm" data-testid="institution-by-need-withheld">{t('institution:space.by_need_withheld', 'Votre territoire est plus petit que son intercommunalité : le tableau par besoin n’est pas publié à cette échelle, car la différence entre deux territoires emboîtés donnerait des valeurs masquées.')}</p> : null}
              {obs.scope?.byNeed === 'PARTIAL' ? <p className="text-sm" data-testid="institution-by-need-partial">{t('institution:space.by_need_partial', 'Le tableau par besoin compte seulement les intercommunalités entièrement situées dans votre territoire.')}</p> : null}
              <table className="text-sm" data-testid="institution-by-need"><caption className="text-start font-medium">{t('institution:space.par_besoin', 'Par besoin')}</caption>
                <thead><tr><th scope="col" className="pe-4 text-start">{t('institution:space.besoin', 'Besoin')}</th><th scope="col" className="pe-4 text-start">{t('institution:space.orientations', 'Orientations')}</th><th scope="col" className="pe-4 text-start">{t('institution:space.refusees_capacite', 'Refusées faute de capacité')}</th><th scope="col" className="text-start">{t('institution:space.hors_perimetre', 'Hors périmètre')}</th></tr></thead>
                <tbody>{obs.byNeed.map((r) => <tr key={r.need}><th scope="row" className="pe-4 text-start font-normal" data-need={r.need}><span aria-hidden="true" className={`me-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${topicTone(r.need).dot}`} />{needLabel[r.need] || r.need}</th><td className="pe-4">{n(r.sent)}</td><td className="pe-4">{n(r.unmet)}</td><td>{n(r.outOfScope)}</td></tr>)}</tbody></table>
              <table className="text-sm" data-testid="institution-by-commune"><caption className="text-start font-medium">{t('institution:space.par_commune_moins_3', 'Par commune (au moins 3 structures vérifiées)')}</caption>
                <thead><tr><th scope="col" className="pe-4 text-start">{t('institution:space.commune', 'Commune')}</th><th scope="col" className="pe-4 text-start">{t('institution:space.orientations', 'Orientations')}</th><th scope="col" className="pe-4 text-start">{t('institution:space.refusees_capacite', 'Refusées faute de capacité')}</th><th scope="col" className="text-start">{t('institution:space.hors_perimetre', 'Hors périmètre')}</th></tr></thead>
                <tbody>{obs.byCommune.map((r) => <tr key={r.commune}><th scope="row" className="pe-4 text-start font-normal">{r.commune}</th><td className="pe-4">{n(r.sent)}</td><td className="pe-4">{n(r.unmet)}</td><td>{n(r.outOfScope)}</td></tr>)}</tbody></table>
              <h3 className="font-semibold">{t('institution:space.methode', 'Méthode')}</h3>
              <ul className="list-disc ps-5 text-sm" data-testid="institution-method">{Object.entries(obs.methodology).map(([k, v]) => <li key={k}>{methodText(t)[k] || v}</li>)}</ul>
            </section>
          ) : <p role="status">{t('institution:space.chargement', 'Chargement…')}</p>}
          {me?.temporaryPassword || noScope ? null : <section className="space-y-2" aria-labelledby="exp-h">
            <h2 id="exp-h" className="text-xl font-semibold">{t('institution:space.export_territorial', 'Export territorial')}</h2>
            <p className="text-sm">{t('institution:space.periode_dernier_trimestre_civil', 'Période : le dernier trimestre civil complet (seule période publiée, pour qu’aucune valeur masquée ne se déduise de deux périodes emboîtées).')}</p>
            <Button size="sm" variant="outline" onClick={exportCsv}>{t('institution:space.telecharger_csv', 'Télécharger (CSV)')}</Button>
          </section>}
          {me && !me.temporaryPassword ? <PasswordForm onChanged={(x) => (x ? ended() : null)} /> : null}
          <Button variant="outline" onClick={logout}>{t('institution:space.deconnecter', 'Se déconnecter')}</Button>
        </>
      )}
    </div>
  );
}
