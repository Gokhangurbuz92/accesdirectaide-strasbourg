// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { canNotify, setPreference } from '../../_services/citizen-account.js';
import { createLinkCode, linkStatus, removeLink, telegramConfig, telegramInstalled, telegramOptionOpen } from '../../_services/telegram.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';

/**
 * TG — « Recevoir mes rappels sur Telegram » (optional channel, capability citizen.telegram, closed by default).
 *   GET     → { available, linked, pending, reminders, botUsername | null }   available: capability open + TELEGRAM_* configured + migration 0065 applied
 *   POST    { consentGiven: true }  records the consent (telegram / reminder, ConsentLog) THEN returns a single-use deep link valid 10 minutes:
 *           { deepLink, expiresAt } — the code is shown once and stored hashed; the link is made in Telegram (« Start », webhook)
 *   DELETE  removes the link and switches the preference off (the withdrawal is recorded)
 * Not offered (env missing, capability closed, table absent) answers { available: false } to GET and 409 CHANNEL_UNAVAILABLE to the writes — the card then
 * says « pas encore proposé », never an error. POST and DELETE have their own limit (CITIZEN_TELEGRAM_LINK, 10 an hour per account and address).
 */
export default citizenHandler('telegram', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  const installed = await telegramInstalled();
  const available = telegramOptionOpen() && installed;
  if (req.method === 'GET') {
    const st = installed ? await linkStatus(citizen.id) : { linked: false, pending: false, linkedAt: null };
    return { ok: true, status: 200, available, ...st, reminders: available ? await canNotify(citizen.id, 'telegram', 'reminder').catch(() => false) : false,
      botUsername: available ? telegramConfig().username : null };
  }
  const limit = await checkRateLimit('CITIZEN_TELEGRAM_LINK', `${citizen.id}:${getClientIp(req)}`);
  if (!limit.allowed) return { ok: false, status: limit.status || 429, code: 'RATE_LIMITED', message: 'Trop de demandes pour Telegram. Réessayez plus tard.' };
  if (req.method === 'DELETE') {
    const removed = installed ? (await removeLink(citizen.id)).removed : 0;
    const pref = await setPreference(citizen.id, { channel: 'telegram', category: 'reminder', enabled: false });
    if (pref.ok === false) return pref;
    return { ok: true, status: 200, removed };
  }
  if (!available) return { ok: false, status: 409, code: 'CHANNEL_UNAVAILABLE', message: 'Telegram n’est pas encore proposé sur ce service.' };
  if (req.body?.consentGiven !== true) return { ok: false, status: 400, code: 'CONSENT_REQUIRED', message: 'Cochez d’abord la case d’accord pour recevoir les rappels sur Telegram.' };
  // the consent is recorded BEFORE any link exists (same order as Web Push: preference + ConsentLog, then the device)
  const pref = await setPreference(citizen.id, { channel: 'telegram', category: 'reminder', enabled: true, consentGiven: true });
  if (pref.ok === false) return pref;
  return createLinkCode(citizen.id);
});
