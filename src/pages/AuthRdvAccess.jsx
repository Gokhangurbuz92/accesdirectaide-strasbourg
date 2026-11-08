import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FranceConnectSignIn } from '@/components/account/FranceConnect';
import { AlertCircle, Loader2 } from 'lucide-react';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { getCsrfHeaders } from '@/lib/csrf';
import { passwordProblems } from '@/lib/passwordPolicy';
import { passwordRuleText, passwordMessageText } from '@/lib/passwordPolicyText';
import { useT } from '@/i18n';
import { emailMessage, looksLikeEmail, requiredMessage } from '@/lib/fieldErrors';
import socialReference from '../../data/reference/social-domains.v1.json';

/** R42-A07: official numbers shown to a minor (verified reference labels, as in the footer) */
const MINOR_HELP = [
  { n: '119', label: socialReference.emergency['119'] },
  { n: '112', label: socialReference.emergency['112'] },
];
/**
 * @param {{ mode?: 'login' | 'signup' }} props
 */
export default function AuthRdvAccess({ mode = 'login' }) {
  const { t } = useT('booking');
  /** R44: the message helpers of src/lib/fieldErrors.js take (key, fallback, options) @type {import('@/lib/fieldErrors').TFn} */
  const msgT = (key, fallback, options) => String(t(key, { defaultValue: fallback, ...(options || {}) }));
  const isSignupMode = mode === 'signup';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adultDeclaration, setAdultDeclaration] = useState(false);   // R42-A07: never pre-ticked
  const [siteWeb, setSiteWeb] = useState('');   // R42 bot protection: hidden from people, must stay empty
  /** A5: the field each error belongs to (aria-invalid / aria-describedby + the error summary that takes the focus) */
  const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [errorSeq, setErrorSeq] = useState(0);
  const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resendHint, setResendHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  // owner usefulness pass (2026-10-25): without a « next », a person who signs in lands in their own space (it was the directory)
  const next = normalizeNextPath(searchParams.get('next'), '/compte');

  const pageTitle = isSignupMode ? t('booking:auth.creer_un_compte_particulier', "Créer un compte Particulier") : t('booking:auth.connexion_particulier', "Connexion Particulier");
  // launch-readiness item 66: the outcome of the confirmation link of an e-mail address change
  /** @type {Record<string, string>} */
  const EMAIL_CHANGE_TEXT = {
    changed: t('booking:auth.votre_nouvelle_adresse_e_mail', "Votre nouvelle adresse e-mail est confirmée. Connectez-vous avec elle."),
    expired: t('booking:auth.ce_lien_de_changement_d', "Ce lien de changement d’adresse a expiré ou a déjà servi : votre adresse n’a pas changé. Refaites la demande depuis votre compte."),
    invalid: t('booking:auth.ce_lien_de_changement_d_2', "Ce lien de changement d’adresse n’est pas valable : votre adresse n’a pas changé."),
    taken: t('booking:auth.cette_adresse_est_deja_utilisee', "Cette adresse est déjà utilisée par un autre compte : votre adresse n’a pas changé."),
    error: t('booking:auth.le_changement_d_adresse_n', "Le changement d’adresse n’a pas pu être fait : votre adresse n’a pas changé. Réessayez plus tard."),
  };
  const emailChange = EMAIL_CHANGE_TEXT[String(searchParams.get('email_change') || '')] || '';
  const altPath = isSignupMode ? appendNext('/auth/login', next) : appendNext('/auth/signup', next);
  const forgotPath = appendNext('/auth/forgot', next);
  const proLoginPath = appendNext('/pro/login', next);

  useEffect(() => { if (errorSeq > 0) summaryRef.current?.focus(); }, [errorSeq]);

  /** @param {Record<string, string>} errs */
  function showFieldErrors(errs) {
    setFieldErrors(errs);
    setError(Object.values(errs)[0] || '');
    setErrorSeq((n) => n + 1);
  }
  /** @param {string} message */
  function showError(message) {
    setFieldErrors({});
    setError(message);
    setErrorSeq((n) => n + 1);
  }
  /** @param {string} field @param {string} describedBy */
  const fieldA11y = (field, describedBy = '') => ({
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': [describedBy, fieldErrors[field] ? `auth-${field}-error` : ''].filter(Boolean).join(' ') || undefined,
  });

  /** R44 (A5): the field each error key belongs to (the summary's links move the focus there) */
  const FIELD_ID = useMemo(() => ({ email: 'auth-email', password: 'auth-password', confirm: 'auth-password-confirm', adult: 'auth-adult' }), []);
  /** @param {string} field */
  const clearField = (field) => {
    if (!fieldErrors[field]) return;
    const rest = { ...fieldErrors };
    delete rest[field];
    setFieldErrors(rest);
    if (!Object.keys(rest).length) setError('');
  };

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setInfo('');

    // R44 (A5): every field is checked here (the form is noValidate: the browser's bubbles are not announced reliably and stopped this summary)
    /** @type {Record<string, string>} */
    const base = {};
    const emailLabel = t('booking:auth.email', 'Email');
    if (!email.trim()) base.email = requiredMessage(msgT, emailLabel);
    else if (!looksLikeEmail(email)) base.email = emailMessage(msgT, emailLabel);
    if (!password) base.password = requiredMessage(msgT, t('booking:auth.mot_de_passe', 'Mot de passe'));
    if (isSignupMode) {
      /** @type {Record<string, string>} */
      const errs = { ...base };
      // R18: the sign-up rule is checked here too (the same rule as the server), so a refusal never reaches the person as « Une erreur est survenue »
      if (!errs.password && password.length < 8) errs.password = t('booking:auth.le_mot_de_passe_doit', "Le mot de passe doit contenir au moins 8 caractères.");
      else if (!errs.password && passwordProblems(password).length) errs.password = passwordMessageText(passwordProblems(password));
      if (!confirmPassword) errs.confirm = requiredMessage(msgT, t('booking:auth.confirmer_le_mot_de_passe', 'Confirmer le mot de passe'));
      else if (password !== confirmPassword) errs.confirm = t('booking:auth.les_mots_de_passe_ne', "Les mots de passe ne correspondent pas.");
      if (!adultDeclaration) errs.adult = t('booking:auth.adult_required', "Cochez la déclaration « J’ai 18 ans ou plus » pour créer un compte. Si vous avez moins de 18 ans, lisez les informations ci-dessous.");
      if (Object.keys(errs).length) { showFieldErrors(errs); return; }
    } else if (Object.keys(base).length || password.length < 8) {
      showFieldErrors({ ...base, ...(base.password || password.length >= 8 ? {} : { password: t('booking:auth.le_mot_de_passe_doit', "Le mot de passe doit contenir au moins 8 caractères.") }) });
      return;
    }

    setLoading(true);
    try {
      const endpoint = isSignupMode ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify(isSignupMode ? { email, password, next, adultDeclaration, termsAccepted: true, site_web: siteWeb } : { email, password, next }),   // Release B: pressing « Créer mon compte » under the terms sentence accepts them
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // R42-A07: the server refuses an account without the adult declaration (the same rule, enforced there)
        if (isSignupMode && payload?.code === 'ADULT_DECLARATION_REQUIRED') {
          showFieldErrors({ adult: t('booking:auth.adult_required', "Cochez la déclaration « J’ai 18 ans ou plus » pour créer un compte. Si vous avez moins de 18 ans, lisez les informations ci-dessous.") });
          return;
        }
        if (!isSignupMode && response.status === 403 && payload?.code === 'EMAIL_NOT_VERIFIED') {   // older servers
          setInfo(t('booking:auth.votre_email_doit_etre_verifie', "Votre email doit être vérifié avant la connexion."));
          return;
        }
        if (!isSignupMode && response.status === 401) {
          // R2-7: one answer whatever the cause (no account-existence oracle); the person who has not confirmed the address yet gets the way to a new link
          try { sessionStorage.setItem('ada_pending_verify_email', email); } catch { /* the resend page will ask for it */ }
          setResendHint(true);
        }
        throw new Error(payload?.message || (response.status === 401 ? t('booking:auth.adresse_ou_mot_de_passe', "Adresse ou mot de passe incorrect.") : t('booking:auth.une_erreur_est_survenue_2', "Une erreur est survenue.")));   // the French message, never the English code
      }

      if (isSignupMode) {
        // PKG-11 audit: the address stays in this tab (sessionStorage) — never in the page address, where history, logs and referrers keep it
        try { sessionStorage.setItem('ada_pending_verify_email', email); } catch { /* the resend button will ask for it */ }
        // R12 (C01): the service said no e-mail can be sent at all — the next page says so instead of « check your inbox »
        try { if (payload?.emailDelivery === 'UNAVAILABLE') sessionStorage.setItem('ada_email_unavailable', '1'); else sessionStorage.removeItem('ada_email_unavailable'); } catch { /* notice only */ }
        navigate(
          `/auth/verify-email?status=pending&next=${encodeURIComponent(next)}`,
          { replace: true },
        );
        return;
      }

      // P2b (owner decision 08/11/2026): the display preferences are kept on this device only — nothing is fetched from the account at sign-in

      if (typeof window !== 'undefined') {
        window.location.assign(next);
        return;
      }
      navigate(next, { replace: true });
    } catch (submitError) {
      showError(submitError instanceof Error ? submitError.message : t('booking:auth.une_erreur_est_survenue', "Une erreur est survenue."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!email) {
      showFieldErrors({ email: t('booking:auth.email_required_resend', "Renseignez votre email pour renvoyer le lien de vérification.") });
      return;
    }
    setError('');
    setInfo('');
    setResendLoading(true);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ email, next }),
      });
      // R18: « renvoyé » only when the server accepted the request, as on the verification page (a 429, 403 or 500 read as sent)
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (res.ok && body?.emailDelivery === 'UNAVAILABLE') setError("L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé.");
      else if (res.ok) setInfo("Si l'email est valide, un lien de vérification vient d'être renvoyé.");
      else if (res.status === 429) setError(t('booking:auth.trop_de_demandes_reessayez_dans', "Trop de demandes : réessayez dans quelques minutes."));
      else setError(t('booking:auth.impossible_de_renvoyer_le_lien', "Impossible de renvoyer le lien pour le moment."));
    } catch {
      setError(t('booking:auth.impossible_de_renvoyer_le_lien', "Impossible de renvoyer le lien pour le moment."));
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <SEO
        title={pageTitle}
        description={t('booking:auth.connexion_au_compte_particulier_pour', "Connexion au compte Particulier pour finaliser une demande de rendez-vous.")}
        path={isSignupMode ? '/auth/signup' : '/auth/login'}
        noindex={true}
      />

      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">{pageTitle}</CardTitle>
          <CardDescription className="text-slate-700">
            {t('booking:auth.connectez_vous_pour_poursuivre_votre', "Connectez-vous pour poursuivre votre demande de rendez-vous.")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {emailChange ? (
            <p role="status" data-testid="email-change-outcome" className="rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900">{emailChange}</p>
          ) : null}
          {error && (
            // A5: one error summary that takes the focus; each entry leads to its field
            <div ref={summaryRef} tabIndex={-1} id="auth-error-summary" data-testid="auth-error-summary" className="outline-none">
              <Alert variant="destructive" role="alert">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>
                  {Object.keys(fieldErrors).length ? (
                    <>
                      <p className="font-semibold">{t('booking:auth.error_summary_title', "Le formulaire contient des erreurs :")}</p>
                      <ul className="mt-1 list-disc ps-5">
                        {['email', 'password', 'confirm', 'adult'].filter((field) => fieldErrors[field]).map((field) => (
                          <li key={field}><a className="underline" href={`#${FIELD_ID[/** @type {'email'} */ (field)]}`}
                            onClick={(e) => { const el = document.getElementById(FIELD_ID[/** @type {'email'} */ (field)]); if (el) { e.preventDefault(); el.focus(); } }}>{fieldErrors[field]}</a></li>
                        ))}
                      </ul>
                    </>
                  ) : error}
                </AlertDescription>
              </Alert>
            </div>
          )}
          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}
          {resendHint && (
            <p className="text-sm text-slate-700" data-testid="auth-resend-hint">
              {t('booking:auth.vous_venez_de_creer_votre', "Vous venez de créer votre compte ?")}{' '}
              <Link className="text-blue-700 underline underline-offset-2" to={`/auth/verify-email?status=pending&next=${encodeURIComponent(next)}`}>{t('booking:auth.recevoir_un_nouveau_lien_de', "Recevoir un nouveau lien de confirmation")}</Link>
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-busy={loading || undefined}>
            <div className="space-y-2">
              <Label htmlFor="auth-email">{t('booking:auth.email', "Email")}</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); clearField('email'); }}
                required
                {...fieldA11y('email')}
              />
              {fieldErrors.email ? <p id="auth-email-error" className="text-sm font-medium text-red-800">{fieldErrors.email}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth-password">{t('booking:auth.mot_de_passe', "Mot de passe")}</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isSignupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => { setPassword(event.target.value); clearField('password'); }}
                required
                minLength={8}
                {...fieldA11y('password', isSignupMode ? 'auth-password-rule' : '')}
              />
              {isSignupMode ? <p id="auth-password-rule" className="text-xs text-slate-700">{passwordRuleText()}</p> : null}
              {fieldErrors.password ? <p id="auth-password-error" className="text-sm font-medium text-red-800">{fieldErrors.password}</p> : null}
            </div>

            {isSignupMode && (
              <div className="space-y-2">
                <Label htmlFor="auth-password-confirm">{t('booking:auth.confirmer_le_mot_de_passe', "Confirmer le mot de passe")}</Label>
                <Input
                  id="auth-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => { setConfirmPassword(event.target.value); clearField('confirm'); }}
                  required
                  minLength={8}
                  {...fieldA11y('confirm')}
                />
                {fieldErrors.confirm ? <p id="auth-confirm-error" className="text-sm font-medium text-red-800">{fieldErrors.confirm}</p> : null}
              </div>
            )}

            {isSignupMode && (
              <>
                {/* R42 bot protection: a field people never see or reach (a bot that fills it gets the ordinary answer and nothing is created) */}
                <div className="sr-only" aria-hidden="true">
                  <label htmlFor="auth-site-web">{t('booking:auth.honeypot_label', "Ne remplissez pas ce champ")}</label>
                  <input id="auth-site-web" name="site_web" type="text" tabIndex={-1} autoComplete="off" value={siteWeb} onChange={(event) => setSiteWeb(event.target.value)} />
                </div>

                {/* R42-A07: an independent account is for adults; a declaration, never a date of birth */}
                <div className="space-y-2 rounded-md border border-slate-300 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <input
                      id="auth-adult"
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={adultDeclaration}
                      onChange={(event) => { setAdultDeclaration(event.target.checked); if (event.target.checked) clearField('adult'); }}
                      aria-required="true"
                      data-testid="auth-adult-declaration"
                      {...fieldA11y('adult', 'auth-adult-hint')}
                    />
                    <Label htmlFor="auth-adult" className="font-semibold">{t('booking:auth.adult_label', "J’ai 18 ans ou plus")}</Label>
                  </div>
                  <p id="auth-adult-hint" className="text-sm text-slate-700">
                    {t('booking:auth.adult_hint', "La création d’un compte personnel est réservée aux personnes de 18 ans ou plus. Nous ne demandons ni date de naissance ni pièce d’identité : cette déclaration engage la personne qui crée le compte.")}
                  </p>
                  {fieldErrors.adult ? <p id="auth-adult-error" className="text-sm font-medium text-red-800">{fieldErrors.adult}</p> : null}
                </div>

                <section aria-labelledby="auth-minors-title" data-testid="auth-minors-info" className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
                  <h2 id="auth-minors-title" className="font-semibold text-slate-900">{t('booking:auth.minors_title', "Vous avez moins de 18 ans ?")}</h2>
                  <p>{t('booking:auth.minors_text', "Vous ne pouvez pas encore créer un compte personnel ni prendre rendez-vous seul·e en ligne. Les informations publiques (aides, démarches, annuaire) restent accessibles sans compte. Un parent, votre représentant légal ou un professionnel peut vous accompagner.")}</p>
                  <p>{t('booking:auth.minors_help', "Si vous êtes en danger, ou si un enfant est en danger, appelez :")}</p>
                  <ul className="space-y-1">
                    {MINOR_HELP.map(({ n, label }) => (
                      <li key={n} className="flex items-center gap-2">
                        <a href={`tel:${n}`} className="font-bold text-blue-900 underline" dir="ltr">{n}</a>
                        <span lang="fr">{label}</span>
                      </li>
                    ))}
                  </ul>
                  <Link className="text-blue-900 underline" to="/besoins">{t('booking:auth.minors_all_numbers', "Tous les numéros d’urgence et d’aide")}</Link>
                </section>
              </>
            )}

            {/* Release B / D2 V2: the terms of use are accepted by creating the account (a contract acceptance recorded with its version, not a GDPR consent);
                the privacy notice is information; optional processing is offered separately later — never bundled here */}
            {isSignupMode ? (
              <div className="space-y-1 text-sm text-slate-800" data-testid="auth-terms-statement">
                <p id="auth-terms">
                  {t('booking:auth.terms_before', 'En créant mon compte, j’accepte les')}{' '}
                  <Link className="text-blue-900 underline" to="/cgu/citoyen">{t('booking:auth.terms_link', 'conditions d’utilisation')}</Link>
                  {t('booking:auth.terms_after', '.')}
                </p>
                <p>
                  {t('booking:auth.privacy_before', 'Mes données sont traitées comme expliqué dans la')}{' '}
                  <Link className="text-blue-900 underline" to="/confidentialite/notice">{t('booking:auth.privacy_link', 'notice de confidentialité')}</Link>
                  {t('booking:auth.privacy_after', '.')}{' '}
                  {t('booking:auth.optional_separate', 'Les options facultatives (message, rappels, notifications) me seront proposées à part.')}
                </p>
              </div>
            ) : null}

            {/* R44 (A5): never disabled for a missing field (a disabled button gave no reason): the summary says what is missing */}
            <Button type="submit" className="w-full" disabled={loading} aria-describedby={isSignupMode ? 'auth-terms' : undefined}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isSignupMode ? t('booking:auth.creer_mon_compte', "Créer mon compte") : t('booking:auth.se_connecter', "Se connecter")}
            </Button>
          </form>

          {!isSignupMode && <FranceConnectSignIn next={next} errorCode={String(searchParams.get('fc') || '')} />}

          {!isSignupMode && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Link className="text-blue-900 hover:underline" to={forgotPath}>
                {t('booking:auth.mot_de_passe_oublie', "Mot de passe oublié ?")}
              </Link>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendLoading}
                className="text-blue-900 hover:underline disabled:opacity-60"
              >
                {resendLoading ? t('booking:auth.envoi', 'Envoi...') : t('booking:auth.renvoyer_un_email_de_verification', "Renvoyer un email de vérification")}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-blue-900 hover:underline" to={altPath}>
              {isSignupMode ? t('booking:auth.j_ai_deja_un_compte', "J'ai deja un compte") : t('booking:auth.je_n_ai_pas_de', "Je n'ai pas de compte")}
            </Link>
            <Link className="text-slate-700 hover:underline" to={proLoginPath}>
              {t('booking:auth.je_suis_une_structure_un', "Je suis une structure / un pro")}
            </Link>
            <Link className="text-slate-700 hover:underline" to={next}>
              {t('booking:auth.retour_au_parcours', "Retour au parcours")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
