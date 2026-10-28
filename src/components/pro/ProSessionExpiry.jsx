// @ts-nocheck
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { csrfFetch } from '@/lib/csrf';
import { proTokenExpiry } from '@/lib/proToken';

const WARN_BEFORE_MS = 10 * 60 * 1000;
const paris = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

/**
 * R12 (R01) — the professional session lasts 8 h and was never extended: the person was signed out in the middle of their work without warning. Ten minutes
 * before the end, a notice says when the session ends and offers to extend it. The extension is only on request (POST /api/pro/auth/refresh, re-checked
 * against the database), so a forgotten open tab still ends.
 */
export default function ProSessionExpiry({ onExpired }) {
  const [expiresAt, setExpiresAt] = useState(() => proTokenExpiry(window.localStorage.getItem('pro_token')));
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState('idle');   // idle | extending | failed

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (expiresAt && now >= expiresAt) onExpired?.();
  }, [expiresAt, now, onExpired]);

  if (!expiresAt || now < expiresAt - WARN_BEFORE_MS || now >= expiresAt) return null;

  const extend = async () => {
    setState('extending');
    try {
      const res = await csrfFetch('/api/pro/auth/refresh', { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${window.localStorage.getItem('pro_token')}` } });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!data?.token) { setState('failed'); return; }
      window.localStorage.setItem('pro_token', data.token);
      setExpiresAt(proTokenExpiry(data.token));
      setState('idle');
    } catch { setState('failed'); }
  };

  return (
    <div role="status" data-testid="pro-session-expiry" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 flex flex-wrap items-center gap-3">
      <span>Votre session se termine à {paris(expiresAt)}. Enregistrez votre travail ou prolongez la session.</span>
      <Button type="button" size="sm" variant="outline" onClick={extend} disabled={state === 'extending'}>Prolonger la session</Button>
      {state === 'failed' && <span role="alert">La session n’a pas pu être prolongée : enregistrez votre travail puis reconnectez-vous.</span>}
    </div>
  );
}
