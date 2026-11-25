/**
 * TG — the Telegram bot configuration, pure (no I/O): read by the service (api/_services/telegram.js), the release preflight (telegram.configured) and
 * the activation tools. Never returns the token or the webhook secret: only whether they are present and well-formed, and the public bot username.
 */
export const TELEGRAM_ENV = Object.freeze(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET']);
/** the Bot API token shape: <bot id>:<secret> */
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
/** a bot username: 5–32 characters, letters / digits / underscore, ending in « bot » */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$/;
/** setWebhook « secret_token »: 1–256 of A-Z a-z 0-9 _ - (Bot API, read 25/11/2026); at least 32 here so it cannot be guessed */
const SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const s = (/** @type {unknown} */ v) => String(v ?? '').trim();

/**
 * the deployment's Telegram configuration (never the token or the secret)
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ ok: true, username: string } | { ok: false, reason: 'NOT_CONFIGURED' | 'INVALID_TOKEN' | 'INVALID_USERNAME' | 'INVALID_WEBHOOK_SECRET' }}
 */
export function telegramConfig(env = process.env) {
  const token = s(env.TELEGRAM_BOT_TOKEN); const username = s(env.TELEGRAM_BOT_USERNAME).replace(/^@/, ''); const secret = s(env.TELEGRAM_WEBHOOK_SECRET);
  if (!token || !username || !secret) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!TOKEN_RE.test(token)) return { ok: false, reason: 'INVALID_TOKEN' };
  if (!USERNAME_RE.test(username)) return { ok: false, reason: 'INVALID_USERNAME' };
  if (!SECRET_RE.test(secret)) return { ok: false, reason: 'INVALID_WEBHOOK_SECRET' };
  return { ok: true, username };
}
