/**
 * R43-MAIL — POST /api/monitor/mail-events/mailjet: Mailjet's Event API (delivery events) for the transactional e-mails.
 *
 *   Off by default: without MAILER_EVENTS_ENABLED=1 the route answers 404 (and during the restricted beta api/_utils/public-beta.js lets it through only
 *   when the flag is on).
 *   Authenticated: Mailjet documents no signature, only HTTPS + basic auth in the callback URL (https://<user>:<password>@www.accesdirectaide.fr/api/monitor/
 *   mail-events/mailjet). The pair is MAILER_EVENTS_BASIC_USER / MAILER_EVENTS_BASIC_PASSWORD (≥ 24 characters), compared in constant time. Missing pair → 503.
 *   It sits under /monitor/ because that prefix is the one the byte-pinned CSRF middleware already exempts for server-to-server calls (no cookie, no Origin).
 *   Answer: 200 once the events are applied (Mailjet retries every 30 s for 24 h on anything else), 500 only when NONE could be applied (database down), so
 *   Mailjet tries again. Nothing about an address is logged or answered.
 */
import { env } from '../../_utils/env.js';
import logger from '../../_utils/logger.js';
import { parseMailjetEvents, verifyMailjetBasicAuth } from '../../lib/mailjet-events.js';
import { applyMailjetEvents } from '../../_services/mail-events.js';

/**
 * @param {{ method?: string, headers?: Record<string, unknown>, body?: unknown }} req
 * @param {{ status: (code: number) => { json: (b: unknown) => unknown, end: () => unknown }, setHeader: (k: string, v: string) => unknown }} res
 * @param {{ apply?: typeof applyMailjetEvents }} [deps]
 */
export default async function mailjetEventsHandler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!env.mailer.eventsEnabled) return res.status(404).json({ error: 'Not Found' });
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const auth = verifyMailjetBasicAuth(req.headers?.authorization, { user: env.mailer.eventsBasicUser, password: env.mailer.eventsBasicPassword });
  if (auth === 'NOT_CONFIGURED') {
    logger.error({ msg: 'mail_events.not_configured', provider: 'mailjet' }, '[mail-events] MAILER_EVENTS_BASIC_USER / MAILER_EVENTS_BASIC_PASSWORD missing or too short');
    return res.status(503).json({ error: 'MAIL_EVENTS_NOT_CONFIGURED' });
  }
  if (auth !== 'OK') {
    logger.warn({ msg: 'mail_events.unauthorized', provider: 'mailjet', reason: auth }, '[mail-events] refused');
    res.setHeader('WWW-Authenticate', 'Basic realm="mail-events", charset="UTF-8"');
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  const events = parseMailjetEvents(req.body);
  if (!events.length) return res.status(200).json({ ok: true, received: 0 });
  const result = await (deps.apply || applyMailjetEvents)(events);
  if (result.errors > 0 && result.errors === result.received) return res.status(500).json({ error: 'NOT_APPLIED' });
  return res.status(200).json({ ok: true, received: result.received });
}
