import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
/**
 * @param {string} status @param {(key: string, fallback: string) => string} t
 */
function getStatusCopy(status, t) {
  switch (status) {
    case 'success':
      return {
        title: t('account:verify.success.title', 'Adresse e-mail vérifiée'),
        description: t('account:verify.success.text', 'Votre compte est actif. Vous pouvez continuer votre parcours.'),
      };
    case 'expired':
      return {
        title: t('account:verify.expired.title', 'Lien expiré'),
        description: t('account:verify.expired.text', 'Le lien de vérification n’est plus valide. Demandez un nouvel e-mail.'),
      };
    case 'invalid':
      return {
        title: t('account:verify.invalid.title', 'Lien invalide'),
        description: t('account:verify.invalid.text', 'Ce lien est invalide. Demandez un nouvel e-mail de vérification.'),
      };
    case 'error':
      return {
        title: t('account:verify.error.title', 'Vérification indisponible'),
        description: t('account:verify.error.text', 'Une erreur est survenue. Réessayez dans quelques instants.'),
      };
    default:
      return {
        title: t('account:verify.pending.title', 'Vérification de votre adresse e-mail'),
        description: t('account:verify.pending.text', 'Consultez votre boîte mail et cliquez sur le lien de vérification.'),
      };
  }
}

export default function AuthVerifyEmail() {
  const { t } = useT('account');
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const status = String(searchParams.get('status') || 'pending').trim().toLowerCase();
  const emailUnavailable = (() => { try { return sessionStorage.getItem('ada_email_unavailable') === '1'; } catch { return false; } })();   // R12 (C01)
  const next = normalizeNextPath(searchParams.get('next'), '/annuaire');
  const email = (() => { try { return String(sessionStorage.getItem('ada_pending_verify_email') || '').trim(); } catch { return ''; } })() || String(searchParams.get('email') || '').trim();   // older links still carry it
  const copy = useMemo(() => getStatusCopy(status, t), [status, t]);

  async function handleResend() {
    if (!email) {
      setMessage(t('account:verify.need_email', 'Renseignez votre adresse e-mail depuis la page de connexion pour renvoyer le lien.'));
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
      if (res.ok && body?.emailDelivery === 'UNAVAILABLE') setMessage(t('account:verify.mail_unavailable', 'L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé.'));   // R12 (C01)
      else if (res.ok) setMessage(t('account:verify.resent', "Si l'adresse est valide, un nouveau lien vient d'être envoyé."));
      else if (res.status === 429) setMessage(t('account:errors.too_many', 'Trop de demandes : réessayez dans quelques minutes.'));
      else setMessage(t('account:verify.cannot_send', "Impossible d'envoyer le lien pour le moment."));
    } catch {
      setMessage(t('account:verify.cannot_send', "Impossible d'envoyer le lien pour le moment."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title={t('account:verify.seo_title', 'Vérification de l’adresse e-mail')}
        description={t('account:verify.seo_description', 'Activez votre compte Particulier AccesDirectAide.')}
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
              <AlertDescription>{t('account:verify.unavailable_notice', 'L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien de confirmation n’a pu vous être envoyé. Votre demande est enregistrée ; réessayez plus tard avec « Renvoyer un e-mail de vérification ».')}</AlertDescription>
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
              {t('account:nav.continue', 'Continuer')}
            </Link>
          ) : (
            <Button type="button" onClick={handleResend} disabled={loading}>
              {loading ? t('account:forgot.sending', 'Envoi…') : t('account:verify.resend', 'Renvoyer un e-mail de vérification')}
            </Button>
          )}

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
