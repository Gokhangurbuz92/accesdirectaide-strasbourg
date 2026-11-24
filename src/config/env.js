/**
 * Frontend-safe environment variables (Vite).
 *
 * Rules:
 * - Only read `import.meta.env.VITE_*` variables in the frontend.
 * - Never expose server secrets via `VITE_*`.
 */

export const frontendEnv = {
  sentry: {
    /** @type {string | undefined} */
    dsn: import.meta.env.VITE_SENTRY_DSN || undefined,
  },

  verification: {
    /** @type {string | undefined} */
    googleSiteVerification: import.meta.env.VITE_GOOGLE_SITE_VERIFICATION || undefined,
    /** @type {string | undefined} */
    bingSiteVerification: import.meta.env.VITE_BING_SITE_VERIFICATION || undefined,
  },

  runtime: {
    isDev: Boolean(import.meta.env.DEV),
    mode: import.meta.env.MODE,
    deployEnv: import.meta.env.VITE_DEPLOY_ENV || import.meta.env.MODE,
    /** @type {string | undefined} */
    gitCommitSha: import.meta.env.VITE_GIT_COMMIT_SHA || undefined,
    /** @type {string | undefined} */
    vercelEnv: import.meta.env.VITE_VERCEL_ENV || undefined,
  },

  flags: {
    devLoginEnabled: import.meta.env.VITE_DEV_LOGIN_ENABLED === 'true',
    publicDiagnostics: import.meta.env.VITE_PUBLIC_DIAGNOSTICS === 'true',
    publicEnableLogging: import.meta.env.VITE_PUBLIC_ENABLE_LOGGING === 'true',
    /** restricted public beta (owner directive 29/10/2026): banner + notice on account, booking and upload screens */
    publicBeta: import.meta.env.VITE_PUBLIC_BETA === 'true',
    /** ADR-022: no audience measurement by default; it loads only when explicitly switched on, never in the beta or in mock mode */
    audienceMeasurement: import.meta.env.VITE_AUDIENCE_MEASUREMENT === 'on' && import.meta.env.VITE_PUBLIC_BETA !== 'true' && import.meta.env.VITE_USE_MOCKS !== 'true',
    /** R5-S1: browser error tracking (Sentry EU, errors only) runs in this build — see errorTrackingActive() */
    get errorTracking() { return errorTrackingActive(); },
  },
};

/** the only Sentry ingest origin the CSP allows (vercel.json connect-src https://*.ingest.de.sentry.io) */
export const SENTRY_EU_INGEST_HOST = /^o\d+\.ingest\.de\.sentry\.io$/;

/**
 * R5-S1 (Sentry EU, errors only): is browser error tracking active in THIS build? True only when
 *  - VITE_SENTRY_DSN is set and points to the EU region (o<id>.ingest.de.sentry.io), AND
 *  - the build is a production build (VITE_DEPLOY_ENV, else Vite MODE — `vite build` is 'production'), AND
 *  - it is a Vercel PRODUCTION deployment: Vercel Preview builds also run `vite build` in production mode, so VERCEL_ENV (set by Vercel at build
 *    time, injected by vite.config.js as __ADA_PRODUCTION_BUILD__) must be 'production'. Outside Vite (tests, scripts): process.env.VERCEL_ENV.
 * The legal pages (privacy, cookies, legal notice, beta notice) say « active » exactly when this is true. Facts can be passed for tests.
 * @param {{ dsn?: string, deployEnv?: string, vercelProduction?: boolean }} [facts]
 */
export function errorTrackingActive(facts) {
  const f = facts || errorTrackingBuildFacts();
  let host = '';
  try { host = f.dsn ? new URL(f.dsn).hostname : ''; } catch { host = ''; }
  return SENTRY_EU_INGEST_HOST.test(host) && f.deployEnv === 'production' && f.vercelProduction === true;
}

/** @returns {{ dsn?: string, deployEnv?: string, vercelProduction: boolean }} */
function errorTrackingBuildFacts() {
  const nodeEnv = globalThis.process?.env || {};
  let dsn; let deployEnv;
  try {
    dsn = import.meta.env.VITE_SENTRY_DSN;
    deployEnv = import.meta.env.VITE_DEPLOY_ENV || import.meta.env.MODE;
  } catch { /* not under Vite */ }
  // eslint-disable-next-line no-undef
  const injected = typeof __ADA_PRODUCTION_BUILD__ !== 'undefined' ? __ADA_PRODUCTION_BUILD__ : undefined;
  return {
    dsn: dsn || undefined,
    deployEnv: deployEnv || undefined,
    vercelProduction: injected !== undefined ? Boolean(injected) : nodeEnv.VERCEL_ENV === 'production',
  };
}
