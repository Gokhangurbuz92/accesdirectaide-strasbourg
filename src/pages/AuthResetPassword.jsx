import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { getCsrfHeaders } from '@/lib/csrf';
import { PASSWORD_RULE, passwordMessage, passwordProblems } from '@/lib/passwordPolicy';
import { useT } from '@/i18n';
export default function AuthResetPassword() {
  const { t } = useT('account');
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const token = String(searchParams.get('token') || '').trim();
  const next = normalizeNextPath(searchParams.get('next'), '/annuaire');
  // PKG-11 audit pass 2: after a contested sign-up (or an ownership recovery) the verification link leads here so that the mailbox holder chooses the password
  const choosing = searchParams.get('choose') === '1';

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError(t('account:reset.invalid_link', 'Lien invalide ou expiré.'));
      return;
    }
    if (passwordProblems(password).length) {   // R18: the sign-up rule (the server applies it to the reset too)
      setError(passwordMessage(passwordProblems(password)));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('account:reset.mismatch', 'Les mots de passe ne correspondent pas.'));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ token, password }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // R18: the French sentence of the server, never its English code (« Invalid or expired token »)
        throw new Error(payload?.message || (response.status === 429 ? t('account:errors.too_many_attempts', 'Trop de tentatives : réessayez dans quelques minutes.') : response.status === 403 ? t('account:errors.expired', 'La page a expiré : rechargez-la puis recommencez.') : t('account:reset.invalid_link', 'Lien invalide ou expiré.')));
      }

      setMessage(t('account:reset.done', 'Mot de passe mis à jour. Vous pouvez maintenant vous connecter.'));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('account:errors.generic', 'Une erreur est survenue.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title={t('account:reset.seo_title', 'Nouveau mot de passe')}
        description={t('account:reset.seo_description', 'Définissez un nouveau mot de passe pour votre compte Particulier.')}
        path="/auth/reset"
        noindex={true}
      />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1">{choosing ? t('account:reset.choose_title', 'Choisissez votre mot de passe') : t('account:reset.title', 'Réinitialiser mon mot de passe')}</CardTitle>
          <CardDescription>{choosing
            ? t('account:reset.choose_intro', 'Votre adresse est confirmée. Choisissez maintenant le mot de passe de votre compte (le lien reçu par e-mail ne sert qu’une fois).')
            : t('account:reset.intro', 'Choisissez un nouveau mot de passe sécurisé.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reset-password">{t('account:fields.new_password', 'Nouveau mot de passe')}</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="reset-password-rule"
              />
              <p id="reset-password-rule" className="text-xs text-slate-700">{PASSWORD_RULE}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reset-password-confirm">{t('account:fields.confirm_password', 'Confirmer le mot de passe')}</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? t('account:reset.saving', 'Enregistrement…') : t('account:reset.submit', 'Mettre à jour')}
            </Button>
          </form>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-blue-700 hover:underline" to={appendNext('/auth/login', next)}>
              {t('account:nav.back_login', 'Retour à la connexion')}
            </Link>
            <Link className="text-slate-600 hover:underline" to={next}>
              {t('account:nav.back_journey', 'Retour au parcours')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
