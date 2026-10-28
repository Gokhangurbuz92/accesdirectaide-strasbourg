// Gate for /rdv/:slug/booking: citizens must hold a verified session (GET /api/auth/me); signed capability links stay available.
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PublicBooking from './PublicBooking.jsx';
import {
  hasBookingManagementCapability,
  classifyCitizenBookingAccess,
  citizenBookingLoginUrl,
} from '@/lib/rdvBookingAccess';

export default function PublicBookingAccessGate() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;
  const managementKey = useRef('');
  const [result, setResult] = useState({ key: '', status: 'checking' });

  useEffect(() => {
    // Existing one-time, signed capability flow stays available without a login.
    // The booking backend validates the token before returning personal details.
    if (hasBookingManagementCapability(location.search, location.hash)) {
      managementKey.current = key;
    }
    if (managementKey.current === key) {
      setResult({ key, status: 'allowed' });
      return;
    }

    const controller = new AbortController();
    setResult({ key, status: 'checking' });

    (async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;

        const status = classifyCitizenBookingAccess(response.status, body);
        if (status === 'login') {
          window.location.replace(citizenBookingLoginUrl(location.pathname, location.search));
          return;
        }
        setResult({ key, status });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, status: 'unavailable' });
      }
    })();

    return () => controller.abort();
  }, [key, location.pathname, location.search, location.hash]);

  const status = result.key === key ? result.status : 'checking';
  if (status === 'allowed') return <PublicBooking />;

  return (
    <section className="mx-auto max-w-xl px-6 py-16 text-center" aria-live="polite">
      {status === 'checking' ? (
        <p role="status">Vérification de votre session...</p>
      ) : status === 'verify-email' ? (
        <>
          <h1 className="text-xl font-semibold text-slate-900">Adresse e-mail à vérifier</h1>
          <p className="mt-3 text-slate-700">Vérifiez votre adresse e-mail avant de réserver un rendez-vous.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-slate-900">Réservation temporairement indisponible</h1>
          <p className="mt-3 text-slate-700">Votre session ne peut pas être vérifiée. Réessayez sans désactiver les protections.</p>
          <button type="button" className="mt-5 rounded bg-slate-900 px-4 py-2 text-white" onClick={() => window.location.reload()}>
            Réessayer
          </button>
        </>
      )}
    </section>
  );
}
