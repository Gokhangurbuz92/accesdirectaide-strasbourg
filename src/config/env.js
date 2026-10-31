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
  },
};
