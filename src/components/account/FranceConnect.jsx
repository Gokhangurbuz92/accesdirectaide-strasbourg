import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useT } from '@/i18n';

/**
 * R46 / N08 (C26) — FranceConnect in the citizen interface. The adapter is NOT LIVE: FranceConnect needs the controller's habilitation; until then the status
 * endpoint answers « unavailable » and the interface says so honestly (provider-status line) instead of offering a button that cannot work.
 * The official FranceConnect button artwork must replace the plain button at activation (FranceConnect's graphic charter).
 */
function useFranceConnectStatus() {
  const [status, setStatus] = useState(/** @type {any} */ (null));
  const load = useCallback(() => Promise.resolve().then(() => citizenApi.franceConnectStatus()).then(setStatus, () => setStatus({ available: false, reason: 'UNREACHABLE' })), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** @param {(k: string, d: string) => string} t @returns {Record<string, string>} */
const franceConnectMessages = (t) => ({
  not_linked: t('compte:fc.error.not_linked', 'Cette identité FranceConnect n’est liée à aucun compte. Connectez-vous avec votre adresse et votre mot de passe, puis liez FranceConnect depuis « Mon profil ».'),
  linked_elsewhere: t('compte:fc.error.linked_elsewhere', 'Cette identité FranceConnect est déjà liée à un autre compte.'),
  session_required: t('compte:fc.error.session_required', 'Connectez-vous d’abord à votre compte pour lier FranceConnect.'),
  cancelled: t('compte:fc.error.cancelled', 'La connexion avec FranceConnect a été annulée.'),
  unavailable: t('compte:fc.error.unavailable', 'FranceConnect n’est pas disponible sur ce service pour le moment.'),
  provider_unavailable: t('compte:fc.error.provider_unavailable', 'FranceConnect ne répond pas pour le moment. Réessayez plus tard ou connectez-vous avec votre adresse.'),
  state_invalid: t('compte:fc.error.expired', 'La demande de connexion a expiré. Recommencez.'),
  code_missing: t('compte:fc.error.expired', 'La demande de connexion a expiré. Recommencez.'),
  verification_failed: t('compte:fc.error.verification_failed', 'La réponse de FranceConnect n’a pas pu être vérifiée. Aucune connexion n’a été ouverte.'),
});

/** the sign-in page part: a button only when FranceConnect is available, and the message of a returned error */
export function FranceConnectSignIn({ next = '/compte', errorCode = '' }) {
  const { t } = useT('compte');
  const { status } = useFranceConnectStatus();
  const message = errorCode ? franceConnectMessages(t)[errorCode] || franceConnectMessages(t).verification_failed : '';
  return (
    <div className="space-y-2" data-testid="fc-signin">
      {message ? <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="fc-error">{message}</p> : null}
      {status?.available ? (
        <>
          <Button asChild variant="outline" className="w-full"><a href={`/api/auth/franceconnect/login?next=${encodeURIComponent(next)}`} data-testid="fc-login">{t('compte:fc.sign_in', 'S’identifier avec FranceConnect')}</a></Button>
          <p className="text-xs text-slate-700">{t('compte:fc.sign_in_hint', 'Pour un compte déjà lié à FranceConnect. Aucun compte n’est créé par FranceConnect.')}</p>
        </>
      ) : null}
    </div>
  );
}
FranceConnectSignIn.propTypes = { next: PropTypes.string, errorCode: PropTypes.string };

/** the profile card: link / unlink, and the honest provider-status line when it is not available */
export function FranceConnectLink() {
  const { t } = useT('compte');
  const { status, reload } = useFranceConnectStatus();
  const [note, setNote] = useState(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fc') === 'linked'
    ? t('compte:fc.linked', 'Votre compte est maintenant lié à FranceConnect.') : ''));
  if (!status) return null;
  const unlink = async () => {
    setNote('');
    try { await citizenApi.franceConnectUnlink(); await reload(); setNote(t('compte:fc.unlinked', 'FranceConnect n’est plus lié à votre compte.')); }
    catch (e) { setNote(/** @type {any} */ (e)?.message || t('compte:fc.failed', 'Action impossible pour le moment.')); }
  };
  return (
    <Card data-testid="fc-link">
      <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:fc.title', 'FranceConnect')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-800">
        {!status.available ? (
          <p data-testid="fc-status-unavailable">{t('compte:fc.status_unavailable', 'Statut : la connexion avec FranceConnect n’est pas encore disponible sur ce service. Votre adresse et votre mot de passe restent le moyen de vous connecter.')}</p>
        ) : status.linked ? (
          <>
            <p data-testid="fc-status-linked">{t('compte:fc.status_linked', 'Votre compte est lié à FranceConnect : vous pouvez aussi vous connecter avec FranceConnect.')}</p>
            <Button variant="outline" onClick={unlink} data-testid="fc-unlink">{t('compte:fc.unlink', 'Retirer le lien avec FranceConnect')}</Button>
          </>
        ) : (
          <>
            <p data-testid="fc-status-not-linked">{t('compte:fc.status_not_linked', 'Vous pouvez lier votre compte à FranceConnect pour vous connecter sans mot de passe. ADA ne reçoit que l’identifiant FranceConnect et votre adresse e-mail.')}</p>
            <Button asChild><a href="/api/auth/franceconnect/link?next=/compte/profil" data-testid="fc-link-start">{t('compte:fc.link', 'Lier mon compte à FranceConnect')}</a></Button>
          </>
        )}
        {note ? <p role="status">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
