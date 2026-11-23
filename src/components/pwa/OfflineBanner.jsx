import { useSyncExternalStore } from 'react';
import { useT } from '@/i18n';

/** @param {() => void} onChange */
function subscribe(onChange) {
    window.addEventListener('online', onChange); window.addEventListener('offline', onChange);
    return () => { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange); };
}
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * G14-LITE — says it when the device loses the Internet connection (and hides itself when it comes back): what is on screen may be out of date and
 * sending a form will not work until then. Polite live region, no timer, no button; nothing is stored. Mon Parcours, when kept on the device, adds its own
 * notice (src/components/parcours/ParcoursOffline.jsx).
 */
export default function OfflineBanner() {
    const { t } = useT('layout');
    const offline = useSyncExternalStore(subscribe, isOffline, () => false);
    return (
        <div role="status" aria-live="polite" className="print:hidden">
            {offline ? (
                <p data-testid="offline-banner" className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-950 shadow">
                    {t('layout:offline.banner', 'Vous n’êtes pas connecté à Internet. Ce qui s’affiche n’est peut-être pas à jour, et vos envois ne partiront pas.')}
                </p>
            ) : null}
        </div>
    );
}
