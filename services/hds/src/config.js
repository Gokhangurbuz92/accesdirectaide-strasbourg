// @ts-check
/**
 * G14-R3 — configuration of the HDS service, fail-closed. In production (NODE_ENV=production) the service refuses to start unless every value is
 * present and well formed; it never prints a value (only the NAME of what is missing).
 *
 *   DATABASE_URL | SCALINGO_POSTGRESQL_URL   the HDS PostgreSQL (Scalingo Business plan, HDS option) — never loopback in production
 *   HDS_TICKET_PUBLIC_KEYS                   "<kid>:<base64 SPKI DER>,…" (public keys of the main API's ticket signer; rotation = two entries)
 *   HDS_DATA_KEYS                            "<kid>:<64 hex>,…" key-encryption keys (first = active)
 *   ALLOWED_ORIGIN                           exact browser origin(s) of the main site, comma list (https in production)
 *   HDS_TICKET_ISSUER / HDS_TICKET_AUDIENCE  default ada-main / ada-hds
 *   HDS_HEALTH_CATEGORY_ENABLED              "true" lets Mon Coffre accept the « sante » category, ONLY with an explicit consent of the version below
 *   HDS_HEALTH_CONSENT_VERSION               the approved art. 9 consent text version (e.g. consentement-sante@v1-2026-12-01)
 *   PORT                                     set by Scalingo
 */
import { parseKeyring } from './envelope.js';
import { parsePublicKeys } from './ticket.js';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const missing = [];
  const databaseUrl = String(env.DATABASE_URL || env.SCALINGO_POSTGRESQL_URL || '').trim();
  if (!databaseUrl) missing.push('DATABASE_URL|SCALINGO_POSTGRESQL_URL');
  else if (production) {
    try { if (LOOPBACK.test(new URL(databaseUrl).hostname)) missing.push('DATABASE_URL (loopback refused in production)'); } catch { missing.push('DATABASE_URL (not a URL)'); }
  }
  /** @type {Map<string, import('node:crypto').KeyObject>} */ let keys = new Map();
  try { keys = parsePublicKeys(env.HDS_TICKET_PUBLIC_KEYS); } catch (e) { missing.push(`HDS_TICKET_PUBLIC_KEYS (${/** @type {Error} */ (e).message})`); }
  /** @type {import('./envelope.js').Keyring | null} */ let ring = null;
  try { ring = parseKeyring(env.HDS_DATA_KEYS); } catch (e) { missing.push(`HDS_DATA_KEYS (${/** @type {Error} */ (e).message})`); }
  const origins = String(env.ALLOWED_ORIGIN || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!origins.length) missing.push('ALLOWED_ORIGIN');
  for (const o of origins) {
    let u = null; try { u = new URL(o); } catch { u = null; }
    const ok = u && u.origin === o && (u.protocol === 'https:' || (!production && u.protocol === 'http:' && LOOPBACK.test(u.hostname)));
    if (!ok) missing.push('ALLOWED_ORIGIN (exact https origin, no path)');
  }
  const healthEnabled = String(env.HDS_HEALTH_CATEGORY_ENABLED || '').trim() === 'true';
  const healthConsentVersion = String(env.HDS_HEALTH_CONSENT_VERSION || '').trim();
  if (healthEnabled && !/^[a-z0-9-]+@v[0-9][A-Za-z0-9.-]{0,40}$/.test(healthConsentVersion)) missing.push('HDS_HEALTH_CONSENT_VERSION (required when HDS_HEALTH_CATEGORY_ENABLED=true)');
  if (env.SENTRY_DSN) missing.push('SENTRY_DSN must NOT be set on the HDS service (no error tracker receives HDS traffic)');
  const port = Number(env.PORT || 4510);
  if (!Number.isInteger(port) || port <= 0 || port === 3000) missing.push('PORT (3000 is reserved for the owner LAB)');
  if (missing.length) {
    const err = new Error(`HDS_CONFIG_INVALID: ${missing.join('; ')}`);
    /** @type {any} */ (err).missing = missing;
    throw err;
  }
  return Object.freeze({
    production, databaseUrl, port, origins, keyring: /** @type {import('./envelope.js').Keyring} */ (ring), ticketKeys: keys,
    issuer: String(env.HDS_TICKET_ISSUER || 'ada-main'), audience: String(env.HDS_TICKET_AUDIENCE || 'ada-hds'),
    healthEnabled, healthConsentVersion,
  });
}
