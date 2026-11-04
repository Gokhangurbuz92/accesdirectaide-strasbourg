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
import { useT } from '@/i18n';
// R44 (A5): field-level errors (aria-invalid, aria-describedby, focused summary) — the R43 pattern
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors.jsx';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { emailMessage, fieldA11y, looksLikeEmail, requiredMessage } from '@/lib/fieldErrors';
export default function AuthForgotPassword() {
  const { t } = useT('account');
  /** R44: the message helpers of src/lib/fieldErrors.js take (key, fallback, options) @type {import('@/lib/fieldErrors').TFn} */
  const msgT = (key, fallback, options) => String(t(key, { defaultValue: fallback, ...(options || {}) }));
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { errors, check, clear, summaryRef } = useFormErrors();

  const next = normalizeNextPath(searchParams.get('next'), '/annuaire');

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const label = t('account:fields.email', 'Adresse e-mail');
    if (!check(!email.trim() ? { 'forgot-email': requiredMessage(msgT, label) } : !looksLikeEmail(email) ? { 'forgot-email': emailMessage(msgT, label) } : {})) return;
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
        throw new Error(payload?.message || (response.status === 429 ? t('account:errors.too_many', 'Trop de demandes : réessayez dans quelques minutes.') : response.status === 403 ? t('account:errors.expired', 'La page a expiré : rechargez-la puis recommencez.') : t('account:errors.not_sent', 'La demande n’a pas pu être envoyée : réessayez dans quelques minutes.')));
      }

      // R12 (C01): the service says when no e-mail can leave it at all (same answer for every address)
      setMessage(payload?.emailDelivery === 'UNAVAILABLE' ? payload.message : t('account:forgot.sent', "Si l'adresse est valide, un lien de réinitialisation vient d'être envoyé."));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('account:errors.generic', 'Une erreur est survenue.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title={t('account:forgot.title', 'Mot de passe oublié')}
        description={t('account:forgot.seo_description', 'Réinitialisez le mot de passe de votre compte Particulier.')}
        path="/auth/forgot"
        noindex={true}
      />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1">{t('account:forgot.title', 'Mot de passe oublié')}</CardTitle>
          <CardDescription>
            {t('account:forgot.intro', 'Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.')}
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
          <ErrorSummary ref={summaryRef} errors={errors} order={['forgot-email']} testid="forgot-error-summary" />

          <form className="space-y-4" onSubmit={handleSubmit} noValidate aria-busy={loading || undefined}>
            <div className="space-y-2">
              <Label htmlFor="forgot-email">{t('account:fields.email', 'Adresse e-mail')}</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => { setEmail(event.target.value); clear('forgot-email'); }}
                {...fieldA11y('forgot-email', errors)}
              />
              <FieldError field="forgot-email" errors={errors} />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? t('account:forgot.sending', 'Envoi…') : t('account:forgot.send', 'Envoyer le lien')}
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
