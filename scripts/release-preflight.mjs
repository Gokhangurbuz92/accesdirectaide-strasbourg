#!/usr/bin/env node
/**
 * Release preflight (WS9 production-like env). Evaluates configuration READINESS from an env object.
 * Prints check ids + PASS/WARN/FAIL + a reason; NEVER prints values. Exit code 1 when any FAIL.
 * Usage: node scripts/release-preflight.mjs            (checks process.env)
 * Launch-readiness campaign 2026-10-25 (items 41-44): this is the release GATE — every production prerequisite the application fails closed without, and every
 * variable that must not exist in production (plain-text or leaked credentials, unapproved AI keys), plus the legal identity of the publisher.
 */
import { evaluateMailerConfig } from '../api/_utils/mailer.js';
import { LEGAL_PLACEHOLDERS } from '../src/config/legal-documents.js';

/** @param {Record<string, string | undefined>} env @param {{ legalText?: string }} [opts] legalText: the legal-pages source (tests pass their own) */
export function evaluateReleasePreflight(env, opts = {}) {
  const get = (/** @type {string} */ k) => String(env[k] ?? '').trim();
  /** @type {{ id: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string }[]} */
  const out = [];
  const add = (/** @type {string} */ id, /** @type {'PASS' | 'WARN' | 'FAIL'} */ status, /** @type {string} */ detail) => out.push({ id, status, detail });

  // Restricted public beta (owner directive 29/10/2026): the API refuses every account, upload and cron route server-side (api/_utils/public-beta.js),
  // so the services that only those routes use are not required; every other check is unchanged.
  const beta = ['1', 'true'].includes(get('ADA_PUBLIC_BETA_RESTRICTED').toLowerCase());
  const notUsed = (/** @type {string} */ what) => `not used: restricted public beta (${what} refused server-side)`;
  const mail = evaluateMailerConfig({ provider: get('MAILER_PROVIDER'), from: get('MAILER_FROM'), apiKey: get('MAILER_API_KEY') });
  if (beta) add('mail.deliverable', 'PASS', notUsed('accounts, password resets and notifications'));
  else add('mail.deliverable', mail.deliverable ? 'PASS' : 'FAIL', `${mail.provider}: ${mail.reason}`);

  add('auth.mode_jwt', get('AUTH_MODE').toLowerCase() === 'jwt' ? 'PASS' : 'FAIL', 'AUTH_MODE must be "jwt" (default "token" hands out the static admin token as session)');
  add('auth.legacy_admin_token_unset', get('ADMIN_TOKEN') ? 'FAIL' : 'PASS', get('ADMIN_TOKEN') ? 'ADMIN_TOKEN is set: a legacy bearer that bypasses MFA — delete it' : 'not set');
  add('auth.no_env_admin_password', get('ADMIN_PASSWORD') ? 'FAIL' : 'PASS', 'ADMIN_PASSWORD must not exist (plain text); production administrators are named accounts with MFA (scripts/admin-bootstrap.mjs)');
  add('auth.no_env_admin', get('ADMIN_PASSWORD_HASH') || get('ADMIN_EMAIL') ? 'WARN' : 'PASS', 'ADMIN_EMAIL / ADMIN_PASSWORD_HASH are ignored in production: remove them');
  add('env.boot_required', ['DATABASE_URL', 'JWT_SECRET', 'ADA_ENCRYPTION_KEY'].every((k) => get(k)) ? 'PASS' : 'FAIL', 'production refuses to start without DATABASE_URL, JWT_SECRET and ADA_ENCRYPTION_KEY (api/_utils/env.js)');
  add('auth.session_secret', Math.max(get('AUTH_SECRET').length, get('JWT_SECRET').length) >= 32 ? 'PASS' : 'FAIL', 'AUTH_SECRET/JWT_SECRET length >= 32');
  add('crypto.encryption_key', /^[0-9a-fA-F]{64}$/.test(get('ADA_ENCRYPTION_KEY')) ? 'PASS' : 'FAIL', 'ADA_ENCRYPTION_KEY must be 64 hex chars');
  add('cron.secret', get('CRON_SECRET').length >= 24 ? 'PASS' : 'FAIL', 'CRON_SECRET length >= 24');
  const db = get('DATABASE_URL');
  add('db.url_present_not_local', db && !/localhost|127\.0\.0\.1|::1/.test(db) ? 'PASS' : 'FAIL', 'DATABASE_URL present and not loopback (production-like)');
  add('flags.no_mocks', get('USE_MOCKS') === 'true' || get('VITE_USE_MOCKS') === 'true' || get('VITE_SKIP_DB') === 'true' ? 'FAIL' : 'PASS', 'USE_MOCKS / VITE_USE_MOCKS / VITE_SKIP_DB must not be "true"');
  const devFlags = ['VITE_DEV_LOGIN_ENABLED', 'VITE_PUBLIC_DIAGNOSTICS', 'ALLOW_DEV_TOOLS'].filter((k) => get(k) === 'true').concat(get('ADA_ALLOW_LEGACY_ADMIN_TOKEN') === '1' ? ['ADA_ALLOW_LEGACY_ADMIN_TOKEN'] : []);
  add('flags.no_dev_tools', devFlags.length ? 'FAIL' : 'PASS', devFlags.length ? `development switches on: ${devFlags.join(', ')}` : 'development login, public diagnostics, dev tools and the legacy admin token are off');
  add('outlook.disabled_until_redesign', get('OUTLOOK_ENABLED') === 'true' ? 'FAIL' : 'PASS', 'Outlook token formats are inconsistent (quarantined)');
  add('unused.bypass_secret', get('BYPASS_SECRET') ? 'FAIL' : 'PASS', 'BYPASS_SECRET is not used by any handler: delete it');
  const base = get('APP_BASE_URL') || get('PUBLIC_BASE_URL');
  add('app.base_url_https', /^https:\/\/(?!localhost\b|127\.0\.0\.1\b)[^/\s]+/i.test(base) ? 'PASS' : 'FAIL', 'APP_BASE_URL: the public https address (links in e-mails; production refuses to build them without it)');
  const vault = get('ADA_VAULT_KEY') || get('OUTLOOK_TOKEN_ENCRYPTION_KEY');
  add('crypto.vault_key', (/^[0-9a-fA-F]{64}$/.test(vault) || vault.length >= 32) && vault !== get('ADA_ENCRYPTION_KEY') ? 'PASS' : 'FAIL', 'ADA_VAULT_KEY (MFA secrets): 64 hex chars or >= 32 chars, distinct from ADA_ENCRYPTION_KEY');
  add('kv.configured', (get('KV_REST_API_URL') || get('UPSTASH_KV_REST_API_URL')) && (get('KV_REST_API_TOKEN') || get('UPSTASH_KV_REST_API_TOKEN')) ? 'PASS' : 'FAIL', 'Upstash KV: sign-in, sign-up, booking, contact and administration fail closed without it');
  if (beta) add('storage.configured', 'PASS', notUsed('the Coffre and attachments'));
  else add('storage.configured', ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'].every((k) => get(k)) ? 'PASS' : 'FAIL', 'object storage (Coffre, attachments): an EU bucket under a DPA');
  // R34 (G11): the LAB's local file store must not reach production (the runtime ignores it there; the variable signals a copied LAB environment)
  add('storage.no_local_dir', !get('ADA_LOCAL_STORAGE_DIR') ? 'PASS' : beta ? 'WARN' : 'FAIL', 'ADA_LOCAL_STORAGE_DIR is LAB only: delete it from the production environment');
  add('db.tls_verified', get('DATABASE_SSL_VERIFY') === 'true' ? 'PASS' : 'FAIL', 'DATABASE_SSL_VERIFY=true: the database certificate is verified');
  if (beta) add('alerts.webhook', 'WARN', notUsed('the health-alert cron (no cron in the beta)') + '; Vercel deployment notifications only');
  else add('alerts.webhook', /^https:\/\//.test(get('ALERT_WEBHOOK_URL')) ? 'PASS' : 'FAIL', 'ALERT_WEBHOOK_URL (https): operational alerts must reach a person, not only the logs');
  add('content.strict_mode', get('ADA_PUBLIC_CONTENT_MODE').toLowerCase() === 'lab' ? 'FAIL' : 'PASS', 'ADA_PUBLIC_CONTENT_MODE must not be "lab" (unverified records would be shown)');
  add('share.legacy_off', get('ADA_LEGACY_SHARE_READ') === '1' ? 'FAIL' : 'PASS', 'ADA_LEGACY_SHARE_READ stays off (a bare link would open a dossier)');
  add('ai.no_unapproved_provider_key', get('GEMINI_API_KEY') || get('GOOGLE_API_KEY') ? 'FAIL' : 'PASS', 'GEMINI_API_KEY / GOOGLE_API_KEY must not exist until an AI provider is approved (DPIA, DPA)');
  add('observability.sentry', get('SENTRY_DSN') ? 'PASS' : 'WARN', 'SENTRY_DSN (EU region, DPA) for error tracking');
  const dsnHosts = ['SENTRY_DSN', 'VITE_SENTRY_DSN'].map((k) => get(k)).filter(Boolean).map((d) => { try { return new URL(d).hostname; } catch { return '?'; } });
  add('observability.sentry_eu', dsnHosts.every((h) => /\.ingest\.de\.sentry\.io$/.test(h)) ? 'PASS' : 'FAIL', 'SENTRY_DSN / VITE_SENTRY_DSN in the EU region (*.ingest.de.sentry.io): the only Sentry origin the CSP allows');
  add('observability.no_session_replay', get('VITE_SENTRY_REPLAY') === 'true' ? 'FAIL' : 'PASS', 'Sentry Session Replay stays off (consent; DPIA A1)');
  add('ops.maintenance_off', ['1', 'true'].includes(String(get('MAINTENANCE_MODE') || '')) ? 'WARN' : 'PASS', 'MAINTENANCE_MODE=1 serves the maintenance page to every visitor');
  const legal = opts.legalText !== undefined ? opts.legalText : JSON.stringify(LEGAL_PLACEHOLDERS);
  add('legal.publisher_complete', legal && !/\[À COMPLÉTER/.test(legal.normalize('NFC')) ? 'PASS' : 'FAIL', 'legal pages: the publisher identity is complete (no « [À COMPLÉTER] »: registered association, publication director, host, contacts)');
  if (beta) add('beta.mailer_noop', ['', 'noop'].includes(get('MAILER_PROVIDER').toLowerCase()) ? 'PASS' : 'FAIL', 'MAILER_PROVIDER stays noop in the restricted beta (no real e-mail)');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = evaluateReleasePreflight(process.env);
  for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id} — ${r.detail}`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
