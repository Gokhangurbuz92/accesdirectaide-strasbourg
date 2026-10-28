// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { canNotify } from '../../_services/citizen-account.js';
import { pushConfig, removeSubscriptions, saveSubscription, subscriptionCount } from '../../_services/web-push.js';

/**
 * R11 / N04 — notifications on this device (Web Push).
 *   GET     → { available, publicKey | null, subscriptions, reminders }   (available: the deployment holds its VAPID keys)
 *   POST    { subscription }  the browser's PushSubscription.toJSON(): stored sealed; refused unless push reminders are switched on WITH the person's consent
 *   DELETE  { endpoint? }     this browser's subscription, or all of the account's
 */
export default citizenHandler('push', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  const cfg = pushConfig();
  if (req.method === 'GET') return { ok: true, status: 200, available: cfg.ok, publicKey: cfg.ok ? cfg.publicKey : null, subscriptions: await subscriptionCount(citizen.id), reminders: await canNotify(citizen.id, 'push', 'reminder').catch(() => false) };
  if (req.method === 'DELETE') return removeSubscriptions(citizen.id, req.body?.endpoint || null);
  if (!cfg.ok) return { ok: false, status: 409, code: 'CHANNEL_UNAVAILABLE', message: 'Les notifications sur cet appareil ne sont pas disponibles sur ce service.' };
  if (!(await canNotify(citizen.id, 'push', 'reminder').catch(() => false))) return { ok: false, status: 409, code: 'CONSENT_REQUIRED', message: 'Activez d’abord les rappels sur cet appareil, avec votre accord.' };
  return saveSubscription(citizen.id, req.body?.subscription);
});
