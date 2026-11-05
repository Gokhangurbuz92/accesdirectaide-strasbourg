/**
 * PKG-3 / B10 — whether the Outlook calendar connection may be used (pure, no I/O). Moved here unchanged from api/_services/calendar-outlook.js in R46 so that
 * api/lib/communication-channels.js and scripts/channels-check.mjs can read it without importing the database; calendar-outlook.js re-exports it.
 * OFF by default: OUTLOOK_ENABLED=true + client id/secret/redirect URI + a 32+ character token key; in production also CALENDAR_PRODUCTION_APPROVED=true.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function outlookStatus(env = process.env) {
  /** @param {string} reason */
  const off = (reason) => ({ enabled: false, reason });
  if (String(env.OUTLOOK_ENABLED || '') !== 'true') return off('NOT_CONFIGURED');
  if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET || !env.OUTLOOK_REDIRECT_URI) return off('INCOMPLETE_CONFIGURATION');
  // R35: the vault key is ADA_VAULT_KEY (what the token encryption reads first); OUTLOOK_TOKEN_ENCRYPTION_KEY is only its former name
  if (String(env.ADA_VAULT_KEY || env.OUTLOOK_TOKEN_ENCRYPTION_KEY || '').length < 32) return off('MISSING_ENCRYPTION_KEY');
  if (String(env.VERCEL_ENV || '') === 'production' && String(env.CALENDAR_PRODUCTION_APPROVED || '') !== 'true') return off('PRODUCTION_ACTIVATION_PENDING');
  return { enabled: true, reason: null };
}
