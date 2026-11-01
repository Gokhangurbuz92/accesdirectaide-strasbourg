import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary.jsx'
import '@/styles/tokens.css'
import '@/index.css'
import { initSentry } from '@/observability/initSentry'

import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { FalcProvider } from '@/contexts/FalcContext.jsx'
import UpdatePrompt from '@/components/pwa/UpdatePrompt.jsx'
import { storage } from '@/lib/storage'
import { bootLanguage } from '@/i18n'

// Initialize Sentry asynchronously (non-blocking)
void initSentry();

// launch-readiness item 63: questionnaire answers older than 24 hours are removed at the next visit of any page
storage.purgeExpired();

// R32: the interface language (address ?lang=, else the visitor's stored choice, else French) is ready before the first render — no flash of French
void bootLanguage().finally(() => {
    ReactDOM.createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
        <ErrorBoundary>
            <ThemeProvider>
                <FalcProvider>
                    <App />
                    <UpdatePrompt />
                </FalcProvider>
            </ThemeProvider>
        </ErrorBoundary>
    )
})

// WS5_STATIC_PWA_REGISTRATION_BEGIN
// Production-only registration. The worker itself caches static shell assets only.
if (
  typeof window !== 'undefined' &&
  'serviceWorker' in window.navigator &&
  import.meta.env.PROD
) {
  const registerStaticServiceWorker = () => {
    window.navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // PKG-9 / M01: announce a waiting new version (only when a version is already in control: the first install is silent)
        const announce = (/** @type {ServiceWorker | null | undefined} */ worker) => { if (worker && window.navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent('ada:sw-update', { detail: worker })); };
        announce(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => { if (worker.state === 'installed') announce(worker); });
        });
      })
      .catch(() => undefined);
  };

  if (document.readyState === 'complete') {
    registerStaticServiceWorker();
  } else {
    window.addEventListener('load', registerStaticServiceWorker, { once: true });
  }
}
// WS5_STATIC_PWA_REGISTRATION_END
