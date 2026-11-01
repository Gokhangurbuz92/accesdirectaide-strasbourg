// @ts-nocheck
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';

/**
 * PKG-9 / M01 — « a new version is available ». The service worker registration (src/main.jsx) announces a waiting worker with the window event
 * `ada:sw-update`; nothing changes until the person chooses « Mettre à jour » (so a form being filled is never reloaded under them). Then the waiting worker
 * takes over (SKIP_WAITING) and the page reloads once, on `controllerchange`. Polite live region, keyboard reachable, no timer.
 */
export default function UpdatePrompt() {
    const { t } = useT('layout');
    const [waiting, setWaiting] = useState(/** @type {ServiceWorker|null} */ (null));
    useEffect(() => {
        const onUpdate = (e) => setWaiting(e.detail || null);
        window.addEventListener('ada:sw-update', onUpdate);
        return () => window.removeEventListener('ada:sw-update', onUpdate);
    }, []);
    if (!waiting) return null;
    const apply = () => {
        let reloaded = false;
        window.navigator.serviceWorker?.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; window.location.reload(); } });
        waiting.postMessage({ type: 'SKIP_WAITING' });
    };
    return (
        <div role="status" aria-live="polite" data-testid="pwa-update" className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-300 bg-white p-4 shadow-lg print:hidden">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-900">{t('layout:update.text', "Une nouvelle version d'AccesDirectAide est disponible. Pensez à terminer ce que vous êtes en train de saisir.")}</p>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setWaiting(null)} className="min-h-11 rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('layout:update.later', 'Plus tard')}</button>
                    <button type="button" onClick={apply} data-testid="pwa-update-apply" className="min-h-11 rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('layout:update.apply', 'Mettre à jour')}</button>
                </div>
            </div>
        </div>
    );
}
