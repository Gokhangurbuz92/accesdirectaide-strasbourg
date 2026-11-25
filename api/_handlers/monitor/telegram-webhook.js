// @ts-nocheck
/**
 * TG — POST /api/monitor/telegram/webhook: the Telegram Bot API webhook of the optional reminder channel.
 *   It sits under /monitor/ because that prefix is the one the byte-pinned CSRF middleware (api/_utils/csrf.js) already exempts for server-to-server calls
 *   (as the Mailjet and Twilio webhooks): a /api/telegram/webhook path would need a change of the pinned files.
 *   Off (404) unless TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET are configured, the capability citizen.telegram is open and
 *   migration 0065 is applied. Every request must carry X-Telegram-Bot-Api-Secret-Token equal to TELEGRAM_WEBHOOK_SECRET (constant-time comparison):
 *   otherwise 401 and nothing is read. Only private-chat text messages are handled:
 *     « /start <code> »  consumes the single-use code (10 min) and links the chat to its account (chat id sealed), then confirms;
 *     « /stop »          switches the person's Telegram reminders off (withdrawal recorded in ConsentLog) and deletes the link;
 *     anything else      a short generic answer (no data stored).
 *   The answer to Telegram is the reply itself (Bot API « reply in the webhook response »: { method: 'sendMessage', chat_id, text }), so the webhook
 *   makes no outbound call. Nothing of the message (text, names, chat id) is logged or stored, except the sealed chat id of a link.
 */
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { BOT_TEXT, accountOfChat, consumeLinkCode, telegramInstalled, telegramOptionOpen, webhookSecretOk } from '../../_services/telegram.js';

const reply = (res, chatId, text) => res.status(200).json({ method: 'sendMessage', chat_id: chatId, text, link_preview_options: { is_disabled: true } });

/**
 * @param {any} req @param {any} res
 * @param {{ setPreference?: Function, installed?: () => Promise<boolean>, consume?: typeof consumeLinkCode, accountOfChat?: typeof accountOfChat, rateLimit?: Function }} [deps]
 */
export async function handleTelegramUpdate(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!telegramOptionOpen() || !(await (deps.installed || telegramInstalled)())) return res.status(404).json({ error: 'Not Found' });
  if (!webhookSecretOk(req.headers?.['x-telegram-bot-api-secret-token'])) return res.status(401).json({ error: 'Unauthorized' });
  const limit = await (deps.rateLimit || checkRateLimit)('TELEGRAM_WEBHOOK', getClientIp(req)).catch(() => ({ allowed: true }));
  if (!limit.allowed) return res.status(429).json({ error: 'Too many requests' });
  const msg = req.body?.message;
  const chatId = msg?.chat?.id;
  // other update kinds, groups and channels: acknowledged and ignored (a reminder bot only talks in private chats)
  if (!msg || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return res.status(200).json({ ok: true });
  const text = msg.text.trim();
  try {
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start) {
      if (!start[1]) return reply(res, chatId, BOT_TEXT.hello);
      const out = await (deps.consume || consumeLinkCode)(start[1], chatId);
      return reply(res, chatId, out.ok ? BOT_TEXT.linked : BOT_TEXT.invalid);
    }
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      const userId = await (deps.accountOfChat || accountOfChat)(chatId);
      if (!userId) return reply(res, chatId, BOT_TEXT.notLinked);
      const setPreference = deps.setPreference || (await import('../../_services/citizen-account.js')).setPreference;
      // the withdrawal is recorded like the unlink button (ConsentLog decision false, collected in Telegram); the link is deleted by setPreference
      await setPreference(userId, { channel: 'telegram', category: 'reminder', enabled: false, collection: { channel: 'telegram_stop' } });
      return reply(res, chatId, BOT_TEXT.stopped);
    }
    return reply(res, chatId, BOT_TEXT.hello);
  } catch (e) {
    logger.error({ err: { name: e?.name } }, '[telegram/webhook] update failed');   // never the message, the chat id or the token
    return res.status(200).json({ ok: true });   // Telegram would otherwise resend the same update; the person can retry from the account
  }
}

/** @param {any} req @param {any} res */
export default function handler(req, res) {
  return handleTelegramUpdate(req, res);
}
