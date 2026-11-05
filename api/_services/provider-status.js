// @ts-nocheck
/**
 * R46 / N10 — the integration status of every provider adapter of the product, for the administrator « Fournisseurs » page (GET /api/admin/provider-status).
 * Computed from the PRESENCE of environment variables and the adapters' own pure readiness rules only: no network call, and never a value (no key, no URL,
 * no address) — each row lists the variable NAMES it looks at and which of them are set.
 *
 * States (honest by construction):
 *   CONNECTED       the adapter has a complete configuration for a real provider. It does NOT mean the provider answered: this page never calls it
 *                   (the live checks are the provider's own verification scripts, listed in `verify`).
 *   SIMULATED       the adapter runs against a stand-in: in-memory store, sandbox / test mode, simulation mode, public prototype endpoint.
 *   NOT_CONFIGURED  nothing (or not enough) is configured; the feature stays off / fails closed. `adapter: 'ABSENT'` = the product has no adapter yet.
 */
import { evaluateMailerConfig } from '../_utils/mailer.js';
import { pushConfig } from './web-push.js';
import { outlookStatus } from './calendar-outlook.js';
import { videoStatus } from '../lib/video-provider.js';

export const PROVIDER_STATES = Object.freeze(['CONNECTED', 'SIMULATED', 'NOT_CONFIGURED']);
/** every reasonCode a row can carry (the page translates them; `reason` is the operator's French detail) */
export const PROVIDER_REASON_CODES = Object.freeze(['NOOP', 'TEST_OUTBOX', 'SANDBOX', 'COMPLETE', 'INCOMPLETE_CONFIGURATION', 'OTHER_PROVIDER_SELECTED', 'NOT_CONFIGURED', 'INVALID_KEYS',
  'INVALID_SUBJECT', 'MISSING_ENCRYPTION_KEY', 'PRODUCTION_ACTIVATION_PENDING', 'UNKNOWN_PROVIDER', 'SANDBOX_IN_PRODUCTION', 'SIMULATION_MODE', 'PUBLIC_PROTOTYPE', 'NO_ADAPTER',
  'PUBLIC_NO_CREDENTIAL', 'MEMORY_STORE', 'VERCEL', 'LOCAL_SERVER']);

const KV_URL_NAMES = ['KV_REST_API_URL', 'UPSTASH_KV_REST_API_URL', 'UPSTASH_KV_KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];
const KV_TOKEN_NAMES = ['KV_REST_API_TOKEN', 'UPSTASH_KV_REST_API_TOKEN', 'UPSTASH_KV_KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];

/** @param {Record<string, string | undefined>} env @param {string} n */
const has = (env, n) => String(env[n] ?? '').trim() !== '';
/** @param {Record<string, string | undefined>} env @param {string[]} names */
const presence = (env, names) => names.map((name) => ({ name, set: has(env, name) }));
const truthy = (/** @type {unknown} */ v) => ['1', 'true', 'on', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ id: string, category: string, label: string, adapter: 'PRESENT' | 'ABSENT', state: 'CONNECTED' | 'SIMULATED' | 'NOT_CONFIGURED', reasonCode: string, reason: string,
 *   variables: { name: string, set: boolean }[], verify: string | null }[]}
 */
export function providerStatuses(env = process.env) {
  const production = String(env.VERCEL_ENV || '').trim() === 'production';
  const rows = [];
  const row = (/** @type {any} */ r) => rows.push({ adapter: 'PRESENT', verify: null, ...r });

  // e-mail (Mailjet / Resend / Microsoft Graph behind one adapter, api/_utils/mailer.js)
  const provider = String(env.MAILER_PROVIDER || 'noop').trim().toLowerCase() || 'noop';
  const mail = evaluateMailerConfig({ provider, from: env.MAILER_FROM, apiKey: env.MAILER_API_KEY, mailjetSandbox: env.MAILER_MAILJET_SANDBOX,
    msgraph: { tenantId: env.MAILER_MSGRAPH_TENANT_ID, clientId: env.MAILER_MSGRAPH_CLIENT_ID, sender: env.MAILER_MSGRAPH_SENDER, certPrivateKey: env.MAILER_MSGRAPH_CERT_PRIVATE_KEY,
      certPem: env.MAILER_MSGRAPH_CERT_PEM, clientSecret: env.MAILER_MSGRAPH_CLIENT_SECRET } });
  const mailSimulated = provider === 'test' || (provider === 'mailjet' && truthy(env.MAILER_MAILJET_SANDBOX) && String(env.MAILER_API_KEY || '').includes(':') && has(env, 'MAILER_FROM'));
  row({ id: 'mail', category: 'communication', label: 'E-mail transactionnel', state: mail.deliverable && provider !== 'test' ? 'CONNECTED' : mailSimulated ? 'SIMULATED' : 'NOT_CONFIGURED',
    reasonCode: provider === 'noop' ? 'NOOP' : provider === 'test' ? 'TEST_OUTBOX' : mailSimulated ? 'SANDBOX' : mail.deliverable ? 'COMPLETE' : 'INCOMPLETE_CONFIGURATION',
    reason: provider === 'noop' ? 'MAILER_PROVIDER=noop (aucun envoi)' : `${provider} — ${mail.reason}`,
    variables: presence(env, ['MAILER_PROVIDER', 'MAILER_FROM', 'MAILER_API_KEY', 'MAILER_MAILJET_SANDBOX', 'MAILER_EVENTS_ENABLED']), verify: 'scripts/mail-provider-check.mjs' });
  row({ id: 'graph-mail', category: 'communication', label: 'Microsoft Graph (envoi d’e-mail)', state: provider === 'msgraph' && mail.deliverable ? 'CONNECTED' : 'NOT_CONFIGURED',
    reasonCode: provider !== 'msgraph' ? 'OTHER_PROVIDER_SELECTED' : mail.deliverable ? 'COMPLETE' : 'INCOMPLETE_CONFIGURATION',
    reason: provider === 'msgraph' ? mail.reason : 'MAILER_PROVIDER n’est pas msgraph',
    variables: presence(env, ['MAILER_MSGRAPH_TENANT_ID', 'MAILER_MSGRAPH_CLIENT_ID', 'MAILER_MSGRAPH_SENDER', 'MAILER_MSGRAPH_CERT_PRIVATE_KEY', 'MAILER_MSGRAPH_CERT_PEM', 'MAILER_MSGRAPH_CLIENT_SECRET']) });

  // SMS (Twilio, api/_utils/twilio-sms.js)
  const sms = ['TWILIO_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'].filter((n) => has(env, n)).length;
  row({ id: 'sms', category: 'communication', label: 'SMS (Twilio)', state: sms === 3 ? 'CONNECTED' : 'NOT_CONFIGURED',
    reasonCode: sms === 3 ? 'COMPLETE' : sms ? 'INCOMPLETE_CONFIGURATION' : 'NOT_CONFIGURED',
    reason: sms === 3 ? 'compte, jeton et expéditeur présents' : sms ? 'configuration incomplète' : 'non configuré : aucun SMS n’est envoyé',
    variables: presence(env, ['TWILIO_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SMS_INBOUND_URL']) });

  // Web Push (VAPID, api/_services/web-push.js)
  const push = pushConfig(env);
  row({ id: 'push', category: 'communication', label: 'Notifications push (Web Push / VAPID)', state: push.ok ? 'CONNECTED' : 'NOT_CONFIGURED', reasonCode: push.ok ? 'COMPLETE' : push.reason, reason: push.ok ? 'clés VAPID valides' : push.reason,
    variables: presence(env, ['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_SUBJECT']) });

  // Outlook calendar (free/busy through Microsoft Graph, api/_services/calendar-outlook.js)
  const ol = outlookStatus(env);
  row({ id: 'outlook', category: 'calendar', label: 'Agenda Outlook (Microsoft Graph, disponibilités)', state: ol.enabled ? 'CONNECTED' : 'NOT_CONFIGURED', reasonCode: ol.enabled ? 'COMPLETE' : ol.reason, reason: ol.enabled ? 'application et clé de chiffrement présentes' : ol.reason,
    variables: presence(env, ['OUTLOOK_ENABLED', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_REDIRECT_URI', 'ADA_VAULT_KEY', 'CALENDAR_PRODUCTION_APPROVED']) });

  // video (Jitsi JWT, api/lib/video-provider.js)
  const v = videoStatus(env);
  row({ id: 'video', category: 'appointments', label: 'Visio (Jitsi avec jeton)', state: v.bookable ? (v.sandbox ? 'SIMULATED' : 'CONNECTED') : 'NOT_CONFIGURED',
    reasonCode: v.bookable ? (v.sandbox ? 'SANDBOX' : 'COMPLETE') : v.reason,
    reason: v.bookable ? (v.sandbox ? 'VIDEO_SANDBOX=true : connexion au fournisseur non vérifiée' : 'fournisseur configuré') : v.reason,
    variables: presence(env, ['VIDEO_PROVIDER', 'VIDEO_JITSI_DOMAIN', 'VIDEO_JITSI_APP_ID', 'VIDEO_JITSI_SECRET', 'VIDEO_SANDBOX', 'VIDEO_PRODUCTION_APPROVED']) });

  // OpenFisca (api/lib/openfiscaClient.js): no URL = the diagnostic runs its simulation mode
  const ofName = ['OPENFISCA_URL', 'OPENFISCA_API_URL'].find((n) => has(env, n));
  const ofPrototype = ofName ? String(env[ofName]).includes('api.fr.openfisca.org') : false;
  row({ id: 'openfisca', category: 'rules', label: 'OpenFisca (calcul indicatif)', state: !ofName ? 'SIMULATED' : ofPrototype ? 'SIMULATED' : 'CONNECTED',
    reasonCode: !ofName ? 'SIMULATION_MODE' : ofPrototype ? 'PUBLIC_PROTOTYPE' : 'COMPLETE',
    reason: !ofName ? 'aucune instance : mode simulation du diagnostic' : ofPrototype ? (production ? 'point d’accès public de prototype : refusé en production' : 'point d’accès public de prototype (développement seulement)') : 'instance configurée',
    variables: presence(env, ['OPENFISCA_URL', 'OPENFISCA_API_URL', 'OPENFISCA_FRANCE_VERSION', 'ALLOW_OPENFISCA_PUBLIC_PROTOTYPE']) });

  // Aides-territoires (api/lib/ingestion/AidesTerritoiresConnector.js)
  row({ id: 'aides-territoires', category: 'sources', label: 'Aides-territoires (API)', state: has(env, 'AIDES_TERRITOIRES_API_KEY') ? 'CONNECTED' : 'NOT_CONFIGURED',
    reasonCode: has(env, 'AIDES_TERRITOIRES_API_KEY') ? 'COMPLETE' : 'NOT_CONFIGURED',
    reason: has(env, 'AIDES_TERRITOIRES_API_KEY') ? 'clé présente' : 'pas de clé : le connecteur ne lit rien', variables: presence(env, ['AIDES_TERRITOIRES_API_KEY']) });

  // identity federation: no adapter in the product yet (honest: not « simulated », not « connected »)
  row({ id: 'franceconnect', category: 'identity', label: 'FranceConnect (identité des personnes)', adapter: 'ABSENT', state: 'NOT_CONFIGURED',
    reasonCode: 'NO_ADAPTER', reason: 'aucun adaptateur dans le produit : la connexion se fait par adresse e-mail et mot de passe', variables: [] });
  row({ id: 'proconnect', category: 'identity', label: 'ProConnect (identité des professionnels)', adapter: 'ABSENT', state: 'NOT_CONFIGURED',
    reasonCode: 'NO_ADAPTER', reason: 'aucun adaptateur dans le produit : les professionnels se connectent avec leur compte ADA Pro (MFA)', variables: [] });

  // maps: OpenStreetMap tiles (browser) + Base Adresse Nationale geocoder (server), public services without a credential
  row({ id: 'maps', category: 'maps', label: 'Cartes (OpenStreetMap) et géocodage (Base Adresse Nationale)', state: 'CONNECTED',
    reasonCode: 'PUBLIC_NO_CREDENTIAL', reason: 'services publics sans identifiant : rien à configurer (disponibilité non testée par cette page)', variables: [] });

  // error monitoring (Sentry)
  const sentry = has(env, 'SENTRY_DSN') || has(env, 'VITE_SENTRY_DSN');
  row({ id: 'sentry', category: 'operations', label: 'Suivi des erreurs (Sentry)', state: sentry ? 'CONNECTED' : 'NOT_CONFIGURED',
    reasonCode: sentry ? 'COMPLETE' : 'NOT_CONFIGURED',
    reason: sentry ? 'DSN présent' : 'non activé : les erreurs restent dans les journaux du serveur', variables: presence(env, ['SENTRY_DSN', 'VITE_SENTRY_DSN', 'SENTRY_TRACES_SAMPLE_RATE']), verify: 'scripts/obs-smoke.mjs' });

  // rate limits / cooldowns store (Upstash Redis through @vercel/kv, api/_utils/kv.js): without credentials an in-memory store per instance
  const kvOk = KV_URL_NAMES.some((n) => has(env, n)) && KV_TOKEN_NAMES.some((n) => has(env, n));
  row({ id: 'upstash', category: 'operations', label: 'Limites de débit et verrous (Upstash Redis)', state: kvOk ? 'CONNECTED' : 'SIMULATED',
    reasonCode: kvOk ? 'COMPLETE' : 'MEMORY_STORE',
    reason: kvOk ? 'adresse et jeton présents' : 'magasin en mémoire, propre à chaque instance (développement seulement ; la production refuse les limites sans magasin partagé)',
    variables: presence(env, [...KV_URL_NAMES, ...KV_TOKEN_NAMES]), verify: 'scripts/q11-multi-instance.mjs' });

  // hosting + database
  const hosted = has(env, 'VERCEL_ENV');
  row({ id: 'hosting', category: 'operations', label: 'Hébergement (Vercel)', state: hosted ? 'CONNECTED' : 'SIMULATED',
    reasonCode: hosted ? 'VERCEL' : 'LOCAL_SERVER',
    reason: hosted ? `environnement Vercel « ${['production', 'preview', 'development'].includes(String(env.VERCEL_ENV)) ? env.VERCEL_ENV : 'autre'} »` : 'serveur local (LAB)', variables: presence(env, ['VERCEL_ENV', 'VERCEL_URL']) });
  row({ id: 'database', category: 'operations', label: 'Base de données PostgreSQL', state: has(env, 'DATABASE_URL') ? 'CONNECTED' : 'NOT_CONFIGURED',
    reasonCode: has(env, 'DATABASE_URL') ? 'COMPLETE' : 'NOT_CONFIGURED',
    reason: has(env, 'DATABASE_URL') ? 'adresse de connexion présente' : 'aucune base configurée', variables: presence(env, ['DATABASE_URL', 'DATABASE_SSL_VERIFY']), verify: 'GET /api/health/deep' });

  return rows;
}

/** @param {ReturnType<typeof providerStatuses>} rows */
export const summarizeProviders = (rows) => Object.fromEntries(PROVIDER_STATES.map((s) => [s, rows.filter((r) => r.state === s).length]));
