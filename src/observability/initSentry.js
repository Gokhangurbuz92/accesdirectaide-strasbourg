import { sentryRef } from "./sentryRef";
import { errorTrackingActive, frontendEnv } from "@/config/env";
import { SENTRY_DENY_URLS, isBrowserNetworkNoise, keptDefaultIntegrations, scrubBreadcrumb, scrubEvent } from "./sentryScrub";

/**
 * Browser error tracking (Sentry, EU region — ingest host *.ingest.de.sentry.io, the only Sentry origin the CSP allows).
 * Runs only when errorTrackingActive(): VITE_SENTRY_DSN set (EU host; the build maps the Production SENTRY_DSN into it, vite.config.js sentryDsnDefine) AND a production build (VITE_DEPLOY_ENV / MODE) AND a Vercel Production
 * deployment (VERCEL_ENV=production at build time, injected by vite.config.js as __ADA_PRODUCTION_BUILD__) — a Preview build never sends.
 * ERRORS ONLY (data minimisation, R5-S1): no browserTracingIntegration, no tracesSampleRate (omitted = tracing disabled), no trace headers on any
 * request, no release-health session, sendDefaultPii false, every event and breadcrumb scrubbed (./sentryScrub.js).
 */
export async function initSentry() {
  if (!errorTrackingActive()) return;
  const dsn = frontendEnv.sentry.dsn;

  try {
    const Sentry = await import("@sentry/react");

    // Session Replay STAYS OFF (R5-S1: « errors only, no replay »). It writes to the visitor's device (sessionStorage `sentryReplaySession`) and
    // records the page, which is not strictly necessary for the service: enabling it requires a consent decision and a consent-gated banner first
    // (STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/03_COOKIES_TRACEURS.md, decision C1 option B), a new AIPD line and an update of the /cookies and privacy
    // pages; the release preflight FAILS when VITE_SENTRY_REPLAY=true (observability.no_session_replay). Opt-in flag kept only for that future decision.
    const replayEnabled = import.meta.env.VITE_SENTRY_REPLAY === 'true';

    /** @type {any[]} */
    const integrations = [];
    if (replayEnabled) integrations.push(Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }));

    Sentry.init({
      dsn,
      release: frontendEnv.runtime.gitCommitSha,
      environment: 'production',
      sendDefaultPii: false,

      // the SDK defaults minus the release-health session, plus nothing else (no tracing)
      integrations: (defaults) => [...keptDefaultIntegrations(defaults), ...integrations],

      // no tracing: tracesSampleRate deliberately absent; no request carries a sentry-trace / baggage header
      tracePropagationTargets: [],
      replaysSessionSampleRate: replayEnabled ? 0.01 : 0,
      replaysOnErrorSampleRate: replayEnabled ? 0.1 : 0,

      denyUrls: SENTRY_DENY_URLS,
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      // a request that never reached the server (« TypeError: Load failed » on Safari …) is the visitor's network, not an error of the site: not sent
      beforeSend: (event) => (isBrowserNetworkNoise(event) ? null : scrubEvent(event)),
    });

    /** @type {{ current: typeof import("@sentry/react") | null }} */ (sentryRef).current = Sentry;
  } catch (error) {
    if (import.meta.env.DEV) console.error("Failed to load Sentry", error);
  }
}
