/**
 * Centralized environment access (server + node scripts).
 *
 * IMPORTANT:
 * - Never log secret values. Errors must mention variable names only.
 * - Frontend must NOT import this module. Frontend uses Vite `import.meta.env` via `src/config/env.js`.
 */

import { z } from 'zod';

const strictEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET est requis'),
  ADA_ENCRYPTION_KEY: z.string().min(1, 'ADA_ENCRYPTION_KEY est requis'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET est requis pour les routes cron').optional(),
  KV_REST_API_URL: z.string().min(1).optional(), 
  KV_REST_API_TOKEN: z.string().min(1).optional(),
}).passthrough();

export const envValidation = strictEnvSchema.safeParse(process.env);

if (!envValidation.success) {
  console.error("⚠️ ENVIRONNEMENT : Variables requises manquantes ou invalides.");
  console.error(envValidation.error.format());
  
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (isProd) {
    // In production, missing secrets/config is a fatal error. 
    // We prevent fallback by throwing here if critical secrets are missing.
    throw new Error(`[env] Fatal: Missing required environment variables in production: ${Object.keys(envValidation.error.format()).join(', ')}`);
  }
}

/**
 * @typedef {object} GetEnvOptions
 * @property {boolean=} required
 * @property {string=} default
 * @property {string[]=} aliases
 * @property {boolean=} redact
 * @property {boolean=} secret
 */

const warnedAliasConflicts = new Set();

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizeEnvValue(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value ? value : undefined;
}

/**
 * Parse a positive integer from env-like strings.
 *
 * @param {string | undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveInt(raw, fallback) {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read a single environment variable safely (trimmed).
 *
 * @param {string} name
 * @param {GetEnvOptions=} options
 * @returns {string | undefined}
 */
export function getEnv(name, options = {}) {
  const aliases = Array.isArray(options.aliases) ? options.aliases : [];
  const keys = aliases.length > 0 ? [name, ...aliases] : [name];

  /** @type {Array<[string, string]>} */
  const present = [];
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value != null) present.push([key, value]);
  }

  if (present.length > 1) {
    const firstValue = present[0][1];
    const allSame = present.every(([, value]) => value === firstValue);
    if (!allSame && !warnedAliasConflicts.has(name)) {
      warnedAliasConflicts.add(name);
      // Never log values. Names-only warning for misconfigured duplicates.
      console.warn(
        `[env] Multiple environment variables are set for ${name}: ${present.map(([k]) => k).join(', ')}.`,
      );
    }
  }

  const resolved = present.length > 0 ? present[0][1] : undefined;

  if (resolved != null) return resolved;

  if (Object.prototype.hasOwnProperty.call(options, 'default')) {
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    if (isProd && options.secret) {
      throw new Error(`[env] Fatal: Default fallbacks for secrets are forbidden in production: ${name}`);
    }
    return options.default;
  }

  if (options.required) {
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }

  return undefined;
}

/**
 * Read a single environment variable with aliases (optional).
 *
 * @param {string} name
 * @param {{ aliases?: string[] }=} options
 * @returns {string | undefined}
 */
export function getOptionalEnv(name, options = {}) {
  return getEnv(name, { aliases: options.aliases });
}

/**
 * Return the first defined value among a canonical name and its aliases.
 *
 * @param {string} name
 * @param {string[]} aliases
 * @returns {string | undefined}
 */
export function envAliases(name, aliases = []) {
  return getOptionalEnv(name, { aliases });
}

/**
 * Require a list of environment variables to exist.
 *
 * @param {string[]} names
 * @returns {Record<string, string>}
 */
export function requireEnv(names) {
  const missing = [];
  /** @type {Record<string, string>} */
  const out = {};

  for (const name of names) {
    const value = getEnv(name);
    if (!value) missing.push(name);
    else out[name] = value;
  }

  if (missing.length > 0) {
    throw new Error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  }

  return out;
}

// -----------------------------------------
// Normalized exports (names only, no values)
// -----------------------------------------

export const env = {
  kv: {
    get url() {
      return envAliases('KV_REST_API_URL', [
        // Preferred Upstash aliases
        'UPSTASH_KV_REST_API_URL',
        // Legacy (double "KV") aliases
        'UPSTASH_KV_KV_REST_API_URL',
        // Common Upstash REST aliases
        'UPSTASH_REDIS_REST_URL',
      ]);
    },
    get token() {
      return envAliases('KV_REST_API_TOKEN', [
        'UPSTASH_KV_REST_API_TOKEN',
        'UPSTASH_KV_KV_REST_API_TOKEN',
        'UPSTASH_REDIS_REST_TOKEN',
      ]);
    },
  },

  storage: {
    get localDir() {
      return getEnv('ADA_LOCAL_STORAGE_DIR');
    },
    get endpoint() {
      return getEnv('STORAGE_ENDPOINT');
    },
    get bucket() {
      return getEnv('STORAGE_BUCKET');
    },
    get region() {
      return getEnv('STORAGE_REGION') || 'auto';
    },
    get accessKeyId() {
      return getEnv('STORAGE_ACCESS_KEY_ID');
    },
    get secretAccessKey() {
      return getEnv('STORAGE_SECRET_ACCESS_KEY');
    },
  },

  sentry: {
    // DSN is public (not a secret), but still treated as config.
    get dsn() {
      return envAliases('SENTRY_DSN', ['VITE_SENTRY_DSN']);
    },
    get environment() {
      return envAliases('VERCEL_ENV', ['VITE_ENV']) || 'development';
    },
    get release() {
      return envAliases('VERCEL_GIT_COMMIT_SHA', ['VITE_GIT_COMMIT_SHA']) || 'dev';
    },
  },

  db: {
    get databaseUrl() {
      return getEnv('DATABASE_URL');
    },
    /** @deprecated Legacy Neon/Vercel env var name. Use databaseUrl instead. */
    get pooledUrl() {
      return getEnv('POSTGRES_PRISMA_URL');
    },
    get directUrl() {
      return getEnv('POSTGRES_URL_NON_POOLING', { aliases: ['DATABASE_URL_UNPOOLED'] });
    },
    get directUrlLegacy() {
      return getEnv('DATABASE_URL_UNPOOLED');
    },
    get databaseUrlTest() {
      return getEnv('DATABASE_URL_TEST');
    },
  },

  secrets: {
    get jwtSecret() {
      return getEnv('JWT_SECRET');
    },
    get adaEncryptionKey() {
      return getEnv('ADA_ENCRYPTION_KEY');
    },
    get cronSecret() {
      return getEnv('CRON_SECRET');
    },
    get adminToken() {
      return getEnv('ADMIN_TOKEN');
    },
    get adminEmail() {
      return getEnv('ADMIN_EMAIL');
    },
    get adminPassword() {
      return getEnv('ADMIN_PASSWORD');
    },
    get adminPasswordHash() {
      return getEnv('ADMIN_PASSWORD_HASH');
    },
    get bypassSecret() {
      return getEnv('BYPASS_SECRET');
    },
    get debugToken() {
      return getEnv('DEBUG_TOKEN');
    },
  },

  auth: {
    get mode() {
      return getEnv('AUTH_MODE', { default: 'token' }) || 'token';
    },
    get secret() {
      return envAliases('AUTH_SECRET', ['AUTH_JWT_SECRET']);
    },
    get magiclinkEnabled() {
      return getEnv('AUTH_MAGICLINK_ENABLED', { default: '0' }) === '1';
    },
  },

  mailer: {
    get provider() {
      return getEnv('MAILER_PROVIDER', { default: 'noop' }) || 'noop';
    },
    get from() {
      return getEnv('MAILER_FROM');
    },
    get apiKey() {
      return getEnv('MAILER_API_KEY');
    },
  },

  mailjet: {
    get apiKey() {
      return getEnv('MAILJET_API_KEY');
    },
    get secretKey() {
      return getEnv('MAILJET_SECRET_KEY');
    },
  },  ai: {
    get geminiKey() {
      return envAliases('GEMINI_API_KEY', ['GOOGLE_API_KEY']);
    },
    get embeddingProvider() {
      return getEnv('AI_EMBEDDING_PROVIDER') || 'gemini';
    },
    get ollamaUrl() {
      return getEnv('OLLAMA_URL') || 'http://127.0.0.1:11434/api/embeddings';
    },
    get ollamaModel() {
      return getEnv('OLLAMA_MODEL') || 'nomic-embed-text';
    },
  },

  twilio: {
    get sid() {
      return getEnv('TWILIO_SID');
    },
    get authToken() {
      return getEnv('TWILIO_AUTH_TOKEN');
    },
    get from() {
      return getEnv('TWILIO_FROM');
    },
  },

  cron: {
    get actualitesStaleMinutes() {
      return toPositiveInt(getEnv('CRON_ACTUALITES_STALE_MINUTES', { default: '540' }), 540);
    },
    get actualitesFailMinutes() {
      return toPositiveInt(getEnv('CRON_ACTUALITES_FAIL_MINUTES', { default: '1440' }), 1440);
    },
  },

  dataQuality: {
    get aidesStaleDays() {
      return toPositiveInt(getEnv('DATA_AIDES_STALE_DAYS', { default: '365' }), 365);
    },
    get demarchesStaleDays() {
      return toPositiveInt(getEnv('DATA_DEMARCHES_STALE_DAYS', { default: '365' }), 365);
    },
    get structuresStaleDays() {
      return toPositiveInt(getEnv('DATA_STRUCTURES_STALE_DAYS', { default: '365' }), 365);
    },
    get reviewScanLimitPerType() {
      return toPositiveInt(getEnv('DATA_REVIEW_SCAN_LIMIT_PER_TYPE', { default: '200' }), 200);
    },
    get reviewScanCronLimitPerType() {
      const fallback = String(env.dataQuality.reviewScanLimitPerType);
      return toPositiveInt(
        getEnv('DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE', { default: fallback }),
        env.dataQuality.reviewScanLimitPerType,
      );
    },
    get reviewScanCronEnabled() {
      return getEnv('DATA_REVIEW_SCAN_CRON_ENABLED', { default: '1' }) !== '0';
    },
  },

  ingestion: {
    get parserVersion() {
      return getEnv('INGESTION_PARSER_VERSION', { default: 'v1' }) || 'v1';
    },
    get dryRun() {
      return getEnv('INGESTION_DRY_RUN', { default: '0' }) === '1';
    },
    get maxItemsPerRun() {
      return toPositiveInt(getEnv('INGESTION_MAX_ITEMS_PER_RUN', { default: '200' }), 200);
    },
  },

  monitor: {
    get reviewQueueOpenTotalMax() {
      return toPositiveInt(getEnv('MONITOR_DQ_OPEN_TOTAL_MAX', { default: '500' }), 500);
    },
    get reviewQueueOpenP0Max() {
      return toPositiveInt(getEnv('MONITOR_DQ_OPEN_P0_MAX', { default: '25' }), 25);
    },
    get ingestionFreshnessMaxAgeHours() {
      return toPositiveInt(getEnv('MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS', { default: '48' }), 48);
    },
  },

  proRdv: {
    get readPerMinute() {
      return toPositiveInt(getEnv('PRO_RDV_RATE_LIMIT_READ_PER_MIN', { default: '60' }), 60);
    },
    get writePerMinute() {
      return toPositiveInt(getEnv('PRO_RDV_RATE_LIMIT_WRITE_PER_MIN', { default: '20' }), 20);
    },
    get writePerDay() {
      return toPositiveInt(getEnv('PRO_RDV_RATE_LIMIT_WRITE_PER_DAY', { default: '300' }), 300);
    },
  },

  outlook: {
    get enabled() {
      return getEnv('OUTLOOK_ENABLED') === 'true';
    },
    get clientId() {
      return getEnv('OUTLOOK_CLIENT_ID');
    },
    get clientSecret() {
      return getEnv('OUTLOOK_CLIENT_SECRET');
    },
    get redirectUri() {
      return getEnv('OUTLOOK_REDIRECT_URI');
    },
    // the vault of the MFA (TOTP) secrets of administrators and professionals, and of the Outlook tokens: ADA_VAULT_KEY; OUTLOOK_TOKEN_ENCRYPTION_KEY is its
    // former name, still read (launch-readiness item 42: without it MFA enrolment cannot work, so the release preflight requires it)
    get tokenEncryptionKey() {
      return envAliases('ADA_VAULT_KEY', ['OUTLOOK_TOKEN_ENCRYPTION_KEY']);
    },
  },

  siao: {
    get enabled() {
      return getEnv('SIAO_ENABLED') === 'true';
    },
    get apiUrl() {
      return getEnv('SIAO_API_URL');
    },
    get apiKey() {
      return getEnv('SIAO_API_KEY');
    },
  },

  flags: {
    get devLoginEnabled() {
      return getEnv('VITE_DEV_LOGIN_ENABLED') === 'true';
    },
    get allowDevTools() {
      return getEnv('ALLOW_DEV_TOOLS') === 'true';
    },
    get publicDiagnostics() {
      return getEnv('VITE_PUBLIC_DIAGNOSTICS') === 'true';
    },
  },

  runtime: {
    get nodeEnv() {
      return getEnv('NODE_ENV') || 'development';
    },
    get vercelEnv() {
      return envAliases('VERCEL_ENV', ['VITE_ENV']) || 'development';
    },
    get logLevel() {
      return getEnv('LOG_LEVEL') || 'info';
    },
    get publicBaseUrl() {
      return getEnv('PUBLIC_BASE_URL');
    },
    get appBaseUrl() {
      return envAliases('APP_BASE_URL', ['PUBLIC_BASE_URL', 'VITE_BASE_URL']);
    },
  },
};
