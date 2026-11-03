import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { applyAccountAccessibility } from '@/lib/accountAccessibility';
import { getCsrfHeaders } from '@/lib/csrf';
import { PASSWORD_RULE, passwordMessage, passwordProblems } from '@/lib/passwordPolicy';
import { useT } from '@/i18n';
/**
 * @param {{ mode?: 'login' | 'signup' }} props
 */
export default function AuthRdvAccess({ mode = 'login' }) {
  const { t } = useT('booking');
  const isSignupMode = mode === 'signup';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  const canSubmit = useMemo(() => {
    if (!email || !password) return false;
    if (!isSignupMode) return true;
    return confirmPassword.length > 0;
  }, [confirmPassword.length, email, isSignupMode, password]);

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setInfo('');

    if (isSignupMode && password !== confirmPassword) {
      setError(t('booking:auth.les_mots_de_passe_ne', "Les mots de passe ne correspondent pas."));
      return;
    }
    if (password.length < 8) {
      setError(t('booking:auth.le_mot_de_passe_doit', "Le mot de passe doit contenir au moins 8 caractères."));
      return;
    }
    // R18: the sign-up rule is checked here too (the same rule as the server), so a refusal never reaches the person as « Une erreur est survenue »
    if (isSignupMode && passwordProblems(password).length) {
      setError(passwordMessage(passwordProblems(password)));
      return;
    }

    setLoading(true);
    try {
      const endpoint = isSignupMode ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ email, password, next }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
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

      // K0 / C04: the account's saved accessibility preferences follow the person to this device (best effort; never blocks the sign-in)
      try {
        const prof = await fetch('/api/citizen/profile', { credentials: 'include' });
        if (prof.ok) applyAccountAccessibility((await prof.json())?.account?.profile?.accessibilityPrefs);
      } catch { /* the preferences are applied again on the profile screen */ }

      if (typeof window !== 'undefined') {
        window.location.assign(next);
        return;
      }
      navigate(next, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('booking:auth.une_erreur_est_survenue', "Une erreur est survenue."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!email) {
      setError("Renseignez votre email pour renvoyer le lien de vérification.");
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
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auth-email">{t('booking:auth.email', "Email")}</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth-password">{t('booking:auth.mot_de_passe', "Mot de passe")}</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isSignupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                aria-describedby={isSignupMode ? 'auth-password-rule' : undefined}
              />
              {isSignupMode ? <p id="auth-password-rule" className="text-xs text-slate-700">{PASSWORD_RULE}</p> : null}
            </div>

            {isSignupMode && (
              <div className="space-y-2">
                <Label htmlFor="auth-password-confirm">{t('booking:auth.confirmer_le_mot_de_passe', "Confirmer le mot de passe")}</Label>
                <Input
                  id="auth-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!canSubmit || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isSignupMode ? t('booking:auth.creer_mon_compte', "Créer mon compte") : t('booking:auth.se_connecter', "Se connecter")}
            </Button>
          </form>

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
