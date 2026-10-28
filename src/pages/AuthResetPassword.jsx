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
export default function AuthResetPassword() {
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
      setError('Lien invalide ou expiré.');
      return;
    }
    if (passwordProblems(password).length) {   // R18: the sign-up rule (the server applies it to the reset too)
      setError(passwordMessage(passwordProblems(password)));
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
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
        throw new Error(payload?.message || (response.status === 429 ? 'Trop de tentatives : réessayez dans quelques minutes.' : response.status === 403 ? 'La page a expiré : rechargez-la puis recommencez.' : 'Lien invalide ou expiré.'));
      }

      setMessage('Mot de passe mis à jour. Vous pouvez maintenant vous connecter.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title="Nouveau mot de passe"
        description="Définissez un nouveau mot de passe pour votre compte Particulier."
        path="/auth/reset"
        noindex={true}
      />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1">{choosing ? 'Choisissez votre mot de passe' : 'Réinitialiser mon mot de passe'}</CardTitle>
          <CardDescription>{choosing
            ? 'Votre adresse est confirmée. Choisissez maintenant le mot de passe de votre compte (le lien reçu par e-mail ne sert qu’une fois).'
            : 'Choisissez un nouveau mot de passe sécurisé.'}</CardDescription>
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
              <Label htmlFor="reset-password">Nouveau mot de passe</Label>
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
              <Label htmlFor="reset-password-confirm">Confirmer le mot de passe</Label>
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
              {loading ? 'Enregistrement...' : 'Mettre à jour'}
            </Button>
          </form>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-blue-700 hover:underline" to={appendNext('/auth/login', next)}>
              Retour à la connexion
            </Link>
            <Link className="text-slate-600 hover:underline" to={next}>
              Retour au parcours
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
