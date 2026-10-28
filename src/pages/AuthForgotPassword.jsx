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
export default function AuthForgotPassword() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const next = normalizeNextPath(searchParams.get('next'), '/annuaire');

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ email }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // R18: a French sentence whatever the refusal (the screen showed « Too many attempts », « Forbidden », « Internal error »)
        throw new Error(payload?.message || (response.status === 429 ? 'Trop de demandes : réessayez dans quelques minutes.' : response.status === 403 ? 'La page a expiré : rechargez-la puis recommencez.' : 'La demande n’a pas pu être envoyée : réessayez dans quelques minutes.'));
      }

      // R12 (C01): the service says when no e-mail can leave it at all (same answer for every address)
      setMessage(payload?.emailDelivery === 'UNAVAILABLE' ? payload.message : "Si l'email est valide, un lien de réinitialisation vient d'être envoyé.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title="Mot de passe oublié"
        description="Réinitialisez le mot de passe de votre compte Particulier."
        path="/auth/forgot"
        noindex={true}
      />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1">Mot de passe oublié</CardTitle>
          <CardDescription>
            Entrez votre adresse email pour recevoir un lien de reinitialisation.
          </CardDescription>
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
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? 'Envoi...' : 'Envoyer le lien'}
            </Button>
          </form>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-blue-700 hover:underline" to={appendNext('/auth/login', next)}>
              Retour a la connexion
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
