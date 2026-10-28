/**
 * R11 / N04 — « Notifications sur cet appareil » (Web Push): the reminders of Mon Parcours shown by this browser. Every state is said in words: the browser cannot
 * (no service worker / Push API), the service does not offer it (no VAPID keys: the server says so), not asked yet, refused in the browser (how to change it),
 * on (this device receives them), and errors. Switching on asks the person's consent (recorded) BEFORE the browser's permission; switching off removes the
 * subscription on the server and in the browser. Nothing is promised: « reçu par le service de notification du navigateur » is all the site can know.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';

const fromB64u = (/** @type {string} */ s) => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(p + '='.repeat((4 - (p.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export default function DevicePush() {
  const [state, setState] = useState(/** @type {{ phase: string, message?: string, server?: any }} */ ({ phase: 'loading' }));
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported()) { setState({ phase: 'unsupported' }); return; }
    try {
      const server = await citizenApi.pushStatus();
      if (!server.available) { setState({ phase: 'unavailable', server }); return; }
      if (Notification.permission === 'denied') { setState({ phase: 'denied', server }); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState({ phase: sub && server.subscriptions > 0 && server.reminders ? 'on' : 'off', server });
    } catch (e) { setState({ phase: 'error', message: /** @type {Error} */ (e).message }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      await citizenApi.setPreference({ channel: 'push', category: 'reminder', enabled: true, consentGiven: true });
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState((s) => ({ ...s, phase: permission === 'denied' ? 'denied' : 'off' })); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(state.server.publicKey) });
      await citizenApi.pushSubscribe(sub.toJSON());
      await refresh();
    } catch (e) { setState((s) => ({ ...s, phase: 'error', message: /** @type {Error} */ (e).message })); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      await citizenApi.pushUnsubscribe(sub ? sub.endpoint : null);
      if (sub) await sub.unsubscribe();
      await citizenApi.setPreference({ channel: 'push', category: 'reminder', enabled: false });
      await refresh();
    } catch (e) { setState((s) => ({ ...s, phase: 'error', message: /** @type {Error} */ (e).message })); } finally { setBusy(false); }
  };

  const TEXT = {
    loading: 'Vérification…',
    unsupported: 'Ce navigateur ne permet pas de recevoir des notifications. Les rappels restent disponibles par e-mail.',
    unavailable: 'Les notifications sur appareil ne sont pas encore proposées par ce service. Les rappels restent disponibles par e-mail.',
    denied: 'Les notifications sont bloquées pour ce site dans votre navigateur. Pour les recevoir, autorisez-les dans les réglages du site de votre navigateur, puis revenez ici.',
    off: 'Recevez sur cet appareil les rappels des étapes de Mon Parcours (sans détail personnel dans la notification). Vous pouvez arrêter à tout moment.',
    on: 'Cet appareil reçoit les rappels de Mon Parcours. Le site sait seulement que le service de notification de votre navigateur a reçu le message, pas que vous l’avez vu.',
    error: 'La demande n’a pas abouti.',
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Notifications sur cet appareil</CardTitle></CardHeader>
      <CardContent className="space-y-3" data-testid="device-push">
        <p role="status" aria-live="polite" className="text-slate-700">{TEXT[/** @type {keyof typeof TEXT} */ (state.phase)]}{state.phase === 'error' && state.message ? ` ${state.message}` : ''}</p>
        {state.phase === 'off' && <Button type="button" onClick={enable} disabled={busy}>J’accepte de recevoir les rappels sur cet appareil</Button>}
        {state.phase === 'on' && <Button type="button" variant="outline" onClick={disable} disabled={busy}>Arrêter les notifications sur cet appareil</Button>}
        {state.phase === 'error' && <Button type="button" variant="outline" onClick={refresh} disabled={busy}>Réessayer</Button>}
      </CardContent>
    </Card>
  );
}
