// @ts-nocheck
/**
 * TG (owner decision 24/11/2026: notifications = Web Push → e-mail (Mailjet) → OPTIONAL Telegram, all 0 €; WhatsApp rejected) — the Telegram Bot API adapter
 * of the reminder channels. Provider-independent shape, like api/_services/web-push.js: config → link → send → ledger status.
 *
 *  - available only when the deployment holds TELEGRAM_BOT_TOKEN (secret), TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET (secret, 32–256 characters of
 *    A-Z a-z 0-9 _ -, the set the Bot API accepts for setWebhook « secret_token »), the capability citizen.telegram is open and migration 0065 is applied —
 *    otherwise the channel is « pas encore proposé » everywhere (preferences refuse it, nothing is stored, nothing is sent);
 *  - linking: after the person's recorded consent, a single-use random code (24 bytes, base64url) valid 10 minutes is stored HASHED (SHA-256) and shown
 *    once as the deep link https://t.me/<bot>?start=<code>; the webhook (api/_handlers/monitor/telegram-webhook.js) receives « /start <code> » from a
 *    private chat, consumes the code atomically and binds the chat: the chat id is SEALED (data keys, purpose « telegram-chat ») and indexed by a keyed
 *    HMAC (never stored in clear, never logged);
 *  - a message names nothing personal: a generic reminder sentence and a link to the account (no health, disability, family situation, document, structure,
 *    service or place) — the builders take no such input; « accepted » means the Bot API took it, not that the person read it;
 *  - Telegram answering 403 (the person blocked the bot / deleted the account) or 400 « chat not found » ends the link; other failures are retryable.
 * The token is only ever put in the request URL to api.telegram.org: never logged, never returned, never stored elsewhere.
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { TelegramLink } from '../../src/db/schema.js';
import { openText, sealText } from '../lib/data-keys.js';
import { env as appEnv } from '../_utils/env.js';
import { capabilityOpen } from '../_utils/capabilities.js';
import { TELEGRAM_ENV, telegramConfig } from '../lib/telegram-config.js';

export const TELEGRAM_CAPABILITY = 'citizen.telegram';
export { TELEGRAM_ENV, telegramConfig };
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
const FAILING_AFTER = 3;
/** the deep-link « start » parameter of our codes: 32 of A-Z a-z 0-9 _ - */
const CODE_RE = /^[A-Za-z0-9_-]{32}$/;
const s = (v) => String(v ?? '').trim();

/** may the Telegram option be offered here: capability open AND configuration complete (the table is checked separately) @param {Record<string, string | undefined>} [env] */
export function telegramOptionOpen(env = process.env) {
  return capabilityOpen(TELEGRAM_CAPABILITY, env) && telegramConfig(env).ok;
}

const presence = new WeakMap();
const PRESENCE_TTL_MS = 60_000;
/** does this database have "TelegramLink" (migration 0065 applied) — read at most once a minute per client; a failed read is not remembered */
export async function telegramInstalled(db = defaultDb) {
  const hit = presence.get(db);
  if (hit && Date.now() - hit.at < PRESENCE_TTL_MS) return hit.value;
  try {
    const r = await db.execute(sql`SELECT to_regclass('"TelegramLink"') IS NOT NULL AS ok`);
    const value = Boolean((r.rows || r)[0]?.ok);
    presence.set(db, { at: Date.now(), value });
    return value;
  } catch { return false; }
}

// ------------------------------------------------------------------------------------------------ secrets, codes and the chat id at rest
/** constant-time comparison of two strings of any length (both are hashed first: equal-length buffers, no early exit) */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb) && String(a ?? '').length > 0;
}

/** the webhook's secret header matches TELEGRAM_WEBHOOK_SECRET (constant time); false when either is missing @param {unknown} header */
export function webhookSecretOk(header, env = process.env) {
  const expected = s(env.TELEGRAM_WEBHOOK_SECRET);
  const got = Array.isArray(header) ? header[0] : header;
  if (!expected || typeof got !== 'string' || !got) return false;
  return safeEqual(got, expected);
}

export const hashLinkCode = (code) => crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
/** a new single-use code: 24 random bytes in base64url (32 characters, valid as a Telegram « start » parameter) */
export const newLinkCode = () => crypto.randomBytes(24).toString('base64url');

/** keyed index of a chat id (HMAC-SHA256 under a sub-key of ADA_ENCRYPTION_KEY): a chat id is a small integer, a plain hash would be reversible */
export function chatIdHmac(chatId, masterHex = appEnv.secrets.adaEncryptionKey) {
  if (!masterHex) throw new Error('telegram: ADA_ENCRYPTION_KEY is required');
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(masterHex).trim(), 'hex'), Buffer.alloc(0), 'ada/telegram-chat-index/v1', 32));
  return crypto.createHmac('sha256', key).update(String(chatId), 'utf8').digest('hex');
}
const sealChat = (userId, chatId) => sealText(String(chatId), { purpose: 'telegram-chat', context: `telegram:${userId}` });
const openChat = (userId, sealed) => String(openText(sealed, { purpose: 'telegram-chat', context: `telegram:${userId}` }) || '');
/** a private chat id as Telegram sends it (an integer, positive for a private chat) */
const validChatId = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v));

// ------------------------------------------------------------------------------------------------ link
/** GET status of the account: { linked, pending } (no chat id, no code) */
export async function linkStatus(userId, { db = defaultDb, now = new Date() } = {}) {
  const [row] = await db.select({ linkedAt: TelegramLink.linkedAt, exp: TelegramLink.linkCodeExpiresAt }).from(TelegramLink).where(eq(TelegramLink.userId, userId)).limit(1);
  return { linked: Boolean(row?.linkedAt), linkedAt: row?.linkedAt || null, pending: Boolean(row?.exp && new Date(row.exp) > now) };
}

/**
 * Creates (or replaces) the account's pending link code and returns the deep link once: { ok, deepLink, expiresAt }. The code itself is never stored, only
 * its SHA-256; a new request replaces the previous code (single active code per account). An already linked chat stays linked until the new code is used.
 */
export async function createLinkCode(userId, { db = defaultDb, env = process.env, now = new Date() } = {}) {
  const cfg = telegramConfig(env);
  if (!cfg.ok) return { ok: false, status: 409, code: 'CHANNEL_UNAVAILABLE', message: 'Telegram n’est pas encore proposé sur ce service.' };
  const code = newLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db.insert(TelegramLink).values({ userId, linkCodeHash: hashLinkCode(code), linkCodeExpiresAt: expiresAt })
    .onConflictDoUpdate({ target: TelegramLink.userId, set: { linkCodeHash: hashLinkCode(code), linkCodeExpiresAt: expiresAt } });
  return { ok: true, status: 201, deepLink: `https://t.me/${cfg.username}?start=${code}`, expiresAt: expiresAt.toISOString() };
}

/**
 * The webhook side of « /start <code> »: consumes the code atomically (single use, unexpired) and binds the chat to its account. One chat belongs to one
 * account: a chat already bound elsewhere moves to this one. Returns { ok: true, userId } or { ok: false, code: 'INVALID_OR_EXPIRED' }.
 */
export async function consumeLinkCode(code, chatId, { db = defaultDb, now = new Date() } = {}) {
  if (!CODE_RE.test(String(code || '')) || !validChatId(chatId)) return { ok: false, code: 'INVALID_OR_EXPIRED' };
  const hmac = chatIdHmac(chatId);
  return db.transaction(async (tx) => {
    // the single-use claim: the code is cleared in the same statement that finds it (a second « /start » with it finds nothing)
    const [claimed] = await tx.update(TelegramLink).set({ linkCodeHash: null, linkCodeExpiresAt: null })
      .where(and(eq(TelegramLink.linkCodeHash, hashLinkCode(code)), gt(TelegramLink.linkCodeExpiresAt, now))).returning({ userId: TelegramLink.userId });
    if (!claimed) return { ok: false, code: 'INVALID_OR_EXPIRED' };
    await tx.update(TelegramLink).set({ chatIdEncrypted: null, chatIdHmac: null, linkedAt: null })
      .where(and(eq(TelegramLink.chatIdHmac, hmac), sql`${TelegramLink.userId} <> ${claimed.userId}`));
    await tx.update(TelegramLink).set({ chatIdEncrypted: sealChat(claimed.userId, chatId), chatIdHmac: hmac, linkedAt: now, failureCount: 0, lastFailureAt: null })
      .where(eq(TelegramLink.userId, claimed.userId));
    return { ok: true, userId: claimed.userId };
  });
}

/** removes the account's link (unlink button, preference switched off): { ok, removed } */
export async function removeLink(userId, { db = defaultDb } = {}) {
  const gone = await db.delete(TelegramLink).where(eq(TelegramLink.userId, userId)).returning({ userId: TelegramLink.userId });
  return { ok: true, status: 200, removed: gone.length };
}

/** « /stop » in Telegram: the account bound to this chat, or null (the link itself is removed by the caller through the preference) */
export async function accountOfChat(chatId, { db = defaultDb } = {}) {
  if (!validChatId(chatId)) return null;
  const [row] = await db.select({ userId: TelegramLink.userId }).from(TelegramLink).where(eq(TelegramLink.chatIdHmac, chatIdHmac(chatId))).limit(1);
  return row?.userId || null;
}

// ------------------------------------------------------------------------------------------------ messages (generic, nothing personal)
/** the absolute link of an account page; null when no public address is configured (production refuses localhost) */
export function accountLink(path) {
  return import('../_utils/user-auth.js').then((m) => { try { return m.buildAppUrl(path); } catch { return null; } }).catch(() => null);
}
export const withLink = (text, url) => (url ? `${text} Détails : ${url}` : text);

/** Mon Parcours due-date reminder (French, like the push nudge): no step, no right, no document @param {string} dateStr Paris date « 3 décembre 2026 » @param {string | null} url */
export const parcoursReminderText = (dateStr, url) => withLink(`Rappel AccesDirectAide : une étape de votre parcours arrive à échéance le ${dateStr}.`, url);

/** J-1 appointment reminder: api/lib/reminder-channels.js appointmentReminderTelegram (pure, next to the push nudge) */

/** confirmation / refusal replies of the bot (French; the account language is not known to the webhook before the link) */
export const BOT_TEXT = Object.freeze({
  linked: 'C’est fait : vous recevrez ici les rappels d’AccesDirectAide (rendez-vous, étapes de Mon Parcours), sans détail personnel. Pour arrêter, envoyez /stop ou utilisez « Mon compte ».',
  invalid: 'Ce lien n’est plus valable (il sert une seule fois et pendant 10 minutes). Recommencez depuis « Mon compte » sur AccesDirectAide.',
  hello: 'Bonjour. Ce robot envoie les rappels d’AccesDirectAide aux personnes qui l’ont demandé depuis leur compte. Pour l’activer, utilisez « Mon compte » sur AccesDirectAide.',
  stopped: 'C’est arrêté : vous ne recevrez plus de rappels ici. Vous pouvez les réactiver depuis « Mon compte » sur AccesDirectAide.',
  notLinked: 'Ce compte Telegram ne reçoit aucun rappel d’AccesDirectAide.',
});

// ------------------------------------------------------------------------------------------------ send
const defaultSendLimit = async (userId) => (await import('../_utils/rateLimit.js')).checkRateLimit('TELEGRAM_SEND_USER', `telegram:${userId}`);

/**
 * Sends one reminder text to the account's linked chat: { status } one of
 *   NOT_CONFIGURED  no token / username / secret: nothing attempted          NO_LINK       the person has no linked chat: nothing attempted
 *   ACCEPTED        the Bot API answered ok (not proof the person read it)  EXPIRED       403 / chat not found: the link is removed (the person left)
 *   FAILED          attempted and refused / unreachable (5xx, 429, network): may succeed later
 *   RATE_LIMITED    this account already received TELEGRAM_SEND_USER messages today: nothing attempted
 * @param {string} userId @param {string} text a builder's output above (generic words and a link to the account)
 */
export async function sendTelegram(userId, text, { db = defaultDb, env = process.env, fetchImpl = fetch, rateLimit = defaultSendLimit, now = new Date() } = {}) {
  if (!telegramConfig(env).ok) return { status: 'NOT_CONFIGURED' };
  const [row] = await db.select().from(TelegramLink).where(and(eq(TelegramLink.userId, userId), isNotNull(TelegramLink.chatIdEncrypted))).limit(1);
  if (!row) return { status: 'NO_LINK' };
  if (rateLimit) { let allowed = true; try { allowed = (await rateLimit(userId))?.allowed !== false; } catch { allowed = true; } if (!allowed) return { status: 'RATE_LIMITED' }; }
  let chatId; try { chatId = openChat(userId, row.chatIdEncrypted); } catch { chatId = ''; }
  if (!validChatId(chatId)) { await removeLink(userId, { db }); return { status: 'EXPIRED' }; }
  let status = 0; let description = '';
  try {
    const r = await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${s(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: Number(chatId), text: String(text).slice(0, 600), link_preview_options: { is_disabled: true } }),
    });
    status = r.status;
    if (status !== 200) { try { description = String((await r.json())?.description || ''); } catch { description = ''; } }
  } catch { status = 0; }
  if (status === 200) {
    await db.update(TelegramLink).set({ failureCount: 0, lastSuccessAt: now }).where(eq(TelegramLink.userId, userId));
    return { status: 'ACCEPTED' };
  }
  if (status === 403 || (status === 400 && /chat not found/i.test(description))) { await removeLink(userId, { db }); return { status: 'EXPIRED' }; }
  await db.update(TelegramLink).set({ failureCount: (row.failureCount || 0) + 1, lastFailureAt: now }).where(eq(TelegramLink.userId, userId));
  return { status: 'FAILED', failing: (row.failureCount || 0) + 1 >= FAILING_AFTER };
}

/** the notice-ledger status of one sendTelegram() result (same scale as pushLedgerStatus) */
export const telegramLedgerStatus = (out) => (out?.status === 'ACCEPTED' ? 'PROVIDER_ACCEPTED' : out?.status === 'FAILED' ? 'FAILED' : 'NOT_DELIVERED');
