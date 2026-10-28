import { sentryRef } from "./sentryRef";
import { frontendEnv } from "@/config/env";

export async function initSentry() {
  const dsn = frontendEnv.sentry.dsn;
  if (!dsn) return;

  // STRICT: Prod only (Vercel Preview builds are technically "production" mode in Vite)
  // We rely on VITE_DEPLOY_ENV (injected) or fallback to MODE.
  const DEPLOY_ENV = frontendEnv.runtime.deployEnv;

  if (DEPLOY_ENV !== 'production') return;

  try {
    const Sentry = await import("@sentry/react");

    // Session Replay is OFF by default. It writes to the visitor's device (sessionStorage `sentryReplaySession`) and
    // records the page, which is not strictly necessary for the service: enabling it requires a consent decision and a
    // consent-gated banner first (STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/03_COOKIES_TRACEURS.md, decision C1 option B),
    // plus an update of the /cookies and privacy pages. Opt-in only via VITE_SENTRY_REPLAY === 'true'.
    const replayEnabled = import.meta.env.VITE_SENTRY_REPLAY === 'true';

    /** @type {any[]} */
    const integrations = [Sentry.browserTracingIntegration()];
    if (replayEnabled) integrations.push(Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }));

    Sentry.init({
      dsn,
      release: frontendEnv.runtime.gitCommitSha,
      environment: DEPLOY_ENV,

      integrations,

      // Conservative defaults for Prod
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: replayEnabled ? 0.01 : 0,
      replaysOnErrorSampleRate: replayEnabled ? 0.1 : 0,

      tracePropagationTargets: [
        "accesdirectaide.fr",
        "www.accesdirectaide.fr",
      ],

      // PII scrubbing before sending an event (e-mail, IP, query string, cookies, authorization headers)
      beforeSend(event) {
        // 1. Anonymisation stricte de l'identité du citoyen/pro
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
          if (event.user.id) event.user.id = "[MASQUÉ-RGPD]";
        }
        
        // 2. Nettoyage absolu de la requête HTTP
        if (event.request) {
          if (event.request.url && event.request.url.includes('?')) {
            event.request.url = event.request.url.split('?')[0] + '?pii=scrubbed';
          }
          if (event.request.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
            delete event.request.headers['x-forwarded-for'];
          }
        }

        // 3. Sécurité Back-end : Empêcher la fuite des variables d'environnement
        if (event.contexts && event.contexts.runtime) {
          delete event.contexts.runtime.env;
        }

        return event;
      },
    });

    /** @type {{ current: typeof import("@sentry/react") | null }} */ (sentryRef).current = Sentry;
  } catch (error) {
    if (import.meta.env.DEV) console.error("Failed to load Sentry", error);
  }
}
