// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * PKG-3 / B07 — VisioWindow: embeds the JWT-protected Jitsi deployment named by the SERVER (join = { domain, roomName, jwt, sandbox } from a successful join request).
 * The token is passed to the provider's External API in memory (never in a URL); recording, live streaming and invitations are not offered by the toolbar and are disabled in
 * the token. If the provider's script cannot load — the shipped Content-Security-Policy blocks every video origin until video is activated (docs/pkg3-video-activation.md),
 * and a LAB has no provider — the screen says so plainly; it never pretends a meeting is running.
 * @param {{ join: { domain: string, roomName: string, jwt: string, sandbox?: boolean }, onClose?: () => void }} props
 */
export default function VisioWindow({ join, onClose }) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  useEffect(() => {
    if (!containerRef.current || !join?.domain || !join?.jwt) { setStatus('error'); return undefined; }
    let disposed = false;
    const start = () => {
      if (disposed) return;
      try {
        const api = new window.JitsiMeetExternalAPI(join.domain, {
          roomName: join.roomName, jwt: join.jwt, parentNode: containerRef.current, width: '100%', height: '100%',
          configOverwrite: { startWithAudioMuted: true, disableDeepLinking: true, prejoinPageEnabled: true, enableWelcomePage: false, fileRecordingsEnabled: false,
            liveStreamingEnabled: false, transcribingEnabled: false, disableInviteFunctions: true, doNotStoreRoom: true, analytics: { disabled: true } },
          interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, TOOLBAR_BUTTONS: ['microphone', 'camera', 'closedcaptions', 'fullscreen', 'fodeviceselection', 'hangup', 'chat', 'settings', 'raisehand', 'tileview'] },
        });
        apiRef.current = api;
        api.addEventListener('videoConferenceJoined', () => setStatus('ready'));
        api.addEventListener('videoConferenceLeft', () => onClose && onClose());
      } catch { setStatus('error'); }
    };
    let script = null;
    if (window.JitsiMeetExternalAPI) start();
    else {
      script = document.createElement('script');
      script.src = `https://${join.domain}/external_api.js`;
      script.async = true;
      script.onload = start;
      script.onerror = () => { if (!disposed) setStatus('error'); };
      document.body.appendChild(script);
    }
    return () => {
      disposed = true;
      if (apiRef.current) { apiRef.current.dispose(); apiRef.current = null; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    };
  }, [join, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label="Rendez-vous en visio" data-testid="visio-window">
      <header className="flex shrink-0 items-center justify-between bg-slate-900 p-4">
        <h2 className="text-lg font-bold text-white">Rendez-vous en visio</h2>
        <button type="button" onClick={() => onClose && onClose()} className="rounded-lg border border-slate-600 px-4 py-2 text-white hover:bg-slate-800" data-testid="visio-close">Quitter</button>
      </header>
      {join?.sandbox ? <p className="bg-amber-100 p-2 text-center text-sm text-amber-950" data-testid="visio-sandbox">Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.</p> : null}
      {status === 'error' ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center" role="alert" data-testid="visio-unavailable">
          <AlertCircle size={40} className="mb-3 text-red-400" aria-hidden="true" />
          <p className="max-w-md text-white">Le service de visio n’a pas pu être chargé sur cet environnement. Votre rendez-vous n’est pas annulé : contactez la structure si besoin.</p>
        </div>
      ) : null}
      {status === 'loading' ? <p className="p-4 text-center text-sm text-slate-200" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Connexion au service de visio…</p> : null}
      <div ref={containerRef} className={status === 'error' ? 'hidden' : 'flex-1'} />
    </div>
  );
}
