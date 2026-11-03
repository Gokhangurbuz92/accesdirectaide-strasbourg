import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

/**
 * PKG-11 / Q10 — the session of an administrator or a professional could not be CHECKED (server error, network): that is said as an outage. Before, any
 * failure of the check deleted the stored session and showed the sign-in page, so a short outage signed everyone out.
 * R40: the texts are in the interface language (namespace `common`); `area` comes translated from the caller.
 * @param {{ area?: string }} props
 */
export default function ServiceUnavailable({ area }) {
  const { t } = useT('common');
  return (
    // R41-K A6: rendered outside any page shell — it is the main landmark; only the sentence is announced (not the heading and the button)
    <main id="main-content" tabIndex={-1} className="flex min-h-[60vh] items-center justify-center p-6 outline-none" data-testid="service-unavailable">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-slate-900">{t('common:unavailable.title', '{{area}} est momentanément indisponible', { area: area || t('common:unavailable.default_area', 'Ce service') })}</h1>
        <p role="alert" className="text-slate-700">{t('common:unavailable.text', "Le serveur n'a pas répondu. Votre session est conservée : réessayez dans un instant.")}</p>
        <Button type="button" className="min-h-11" onClick={() => window.location.reload()}>{t('common:unavailable.retry', 'Réessayer')}</Button>
      </div>
    </main>
  );
}
