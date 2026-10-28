import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from "@/lib/queryClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazy, Suspense } from 'react';

// Lazy-load analytics — not critical for first paint
const Analytics = lazy(() =>
  import('@vercel/analytics/react').then((mod) => ({ default: mod.Analytics }))
);
const SpeedInsights = lazy(() =>
  import('@vercel/speed-insights/react').then((mod) => ({ default: mod.SpeedInsights }))
);
const CookieBanner = lazy(() => import('@/components/CookieBanner'));

import { MotionConfig } from 'framer-motion';
import { dropIfObjected, hasObjectedToAudience } from '@/lib/audienceObjection';   // PKG-11 / C21: self-service objection to audience measurement

// RC3 harness (decision pending, see docs/release): no third-party analytics in mock/offline mode.
const ANALYTICS_ENABLED = import.meta.env.VITE_USE_MOCKS !== 'true';

function App(/** @type {Record<string, string | number | boolean | null | undefined>} */ { url }) {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <HelmetProvider>
            <Pages url={url} />
            {ANALYTICS_ENABLED && !hasObjectedToAudience() && (
              <Suspense fallback={null}>
                <Analytics mode={'production'} beforeSend={dropIfObjected} />
                <SpeedInsights beforeSend={dropIfObjected} />
              </Suspense>
            )}
            <Toaster />
            {/* R8: the messages of the pages that use sonner (team management, content report, feedback) were never shown: no sonner toaster was mounted */}
            <SonnerToaster position="top-center" closeButton />
            <Suspense fallback={null}>
              <CookieBanner />
            </Suspense>
          </HelmetProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  )
}

export default App

