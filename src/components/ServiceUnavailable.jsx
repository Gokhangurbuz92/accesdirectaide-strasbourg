import { Button } from '@/components/ui/button';

/**
 * PKG-11 / Q10 — the session of an administrator or a professional could not be CHECKED (server error, network): that is said as an outage. Before, any
 * failure of the check deleted the stored session and showed the sign-in page, so a short outage signed everyone out.
 * @param {{ area?: string }} props
 */
export default function ServiceUnavailable({ area = 'Ce service' }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert" data-testid="service-unavailable">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-slate-900">{area} est momentanément indisponible</h1>
        <p className="text-slate-700">Le serveur n&apos;a pas répondu. Votre session est conservée : réessayez dans un instant.</p>
        <Button type="button" className="min-h-11" onClick={() => window.location.reload()}>Réessayer</Button>
      </div>
    </div>
  );
}
