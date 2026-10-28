import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { getCsrfHeaders } from '@/lib/csrf';
/**
 * @param {string} status
 */
function getStatusCopy(status) {
  switch (status) {
    case 'success':
      return {
        title: 'Email vérifié',
        description: 'Votre compte est actif. Vous pouvez continuer votre parcours.',
      };
    case 'expired':
      return {
        title: 'Lien expiré',
        description: 'Le lien de vérification n’est plus valide. Demandez un nouvel email.',
      };
    case 'invalid':
      return {
        title: 'Lien invalide',
        description: 'Ce lien est invalide. Demandez un nouvel email de vérification.',
      };
    case 'error':
      return {
        title: 'Vérification indisponible',
        description: 'Une erreur est survenue. Réessayez dans quelques instants.',
      };
    default:
      return {
        title: 'Vérification de votre email',
        description: 'Consultez votre boîte mail et cliquez sur le lien de vérification.',
      };
  }
}

export default function AuthVerifyEmail() {
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const status = String(searchParams.get('status') || 'pending').trim().toLowerCase();
  const emailUnavailable = (() => { try { return sessionStorage.getItem('ada_email_unavailable') === '1'; } catch { return false; } })();   // R12 (C01)
  const next = normalizeNextPath(searchParams.get('next'), '/annuaire');
  const email = (() => { try { return String(sessionStorage.getItem('ada_pending_verify_email') || '').trim(); } catch { return ''; } })() || String(searchParams.get('email') || '').trim();   // older links still carry it
  const copy = useMemo(() => getStatusCopy(status), [status]);

  async function handleResend() {
    if (!email) {
      setMessage('Renseignez votre email depuis la page de connexion pour renvoyer le lien.');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ email, next }),
      });
      // PKG-11 audit: « sent » only when the server accepted the request (a 429, 403 or 500 used to read as sent)
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (res.ok && body?.emailDelivery === 'UNAVAILABLE') setMessage("L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé.");   // R12 (C01)
      else if (res.ok) setMessage("Si l'email est valide, un nouveau lien vient d'être envoyé.");
      else if (res.status === 429) setMessage('Trop de demandes : réessayez dans quelques minutes.');
      else setMessage("Impossible d'envoyer le lien pour le moment.");
    } catch {
      setMessage("Impossible d'envoyer le lien pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title="Vérification email"
        description="Activez votre compte Particulier Acces Direct Aide."
        path="/auth/verify-email"
        noindex={true}
      />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'pending' && emailUnavailable ? (
            <Alert data-testid="verify-email-unavailable">
              <AlertDescription>L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien de confirmation n’a pu vous être envoyé. Votre demande est enregistrée ; réessayez plus tard avec « Renvoyer un email de vérification ».</AlertDescription>
            </Alert>
          ) : null}
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          {status === 'success' ? (
            <Link
              to={next}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Continuer
            </Link>
          ) : (
            <Button type="button" onClick={handleResend} disabled={loading}>
              {loading ? 'Envoi...' : 'Renvoyer un email de vérification'}
            </Button>
          )}

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
