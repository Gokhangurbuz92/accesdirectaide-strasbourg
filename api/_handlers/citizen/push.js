// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { canNotify } from '../../_services/citizen-account.js';
import { pushConfig, removeSubscriptions, saveSubscription, subscriptionCount } from '../../_services/web-push.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';

/**
 * R11 / N04 — notifications on this device (Web Push).
 *   GET     → { available, publicKey | null, subscriptions, reminders }   (available: the deployment holds its VAPID keys)
 *   POST    { subscription }  the browser's PushSubscription.toJSON(): stored sealed; refused unless push reminders are switched on WITH the person's consent
 *   DELETE  { endpoint? }     this browser's subscription, or all of the account's
 * G14-CHAN: POST and DELETE also have their own limit (CITIZEN_PUSH_SUBSCRIBE, 10 an hour per account and address) on top of the account-wide one.
 */
export default citizenHandler('push', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  const cfg = pushConfig();
  if (req.method === 'GET') return { ok: true, status: 200, available: cfg.ok, publicKey: cfg.ok ? cfg.publicKey : null, subscriptions: await subscriptionCount(citizen.id), reminders: await canNotify(citizen.id, 'push', 'reminder').catch(() => false) };
  const limit = await checkRateLimit('CITIZEN_PUSH_SUBSCRIBE', `${citizen.id}:${getClientIp(req)}`);
  if (!limit.allowed) return { ok: false, status: limit.status || 429, code: 'RATE_LIMITED', message: 'Trop de demandes pour les notifications de cet appareil. Réessayez plus tard.' };
  if (req.method === 'DELETE') return removeSubscriptions(citizen.id, req.body?.endpoint || null);
  if (!cfg.ok) return { ok: false, status: 409, code: 'CHANNEL_UNAVAILABLE', message: 'Les notifications sur cet appareil ne sont pas disponibles sur ce service.' };
  if (!(await canNotify(citizen.id, 'push', 'reminder').catch(() => false))) return { ok: false, status: 409, code: 'CONSENT_REQUIRED', message: 'Activez d’abord les rappels sur cet appareil, avec votre accord.' };
  return saveSubscription(citizen.id, req.body?.subscription);
});
