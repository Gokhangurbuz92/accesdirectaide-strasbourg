// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { listInbox, markAllRead } from '../../_services/citizen-inbox.js';

/**
 * R46 / N03 — in-app notifications (api/_services/citizen-inbox.js).
 *   GET  /api/citizen/notifications                  → { notifications: [{ id, kind, at, link, unread }], unread, seenAt }  (no content, no names)
 *   POST /api/citizen/notifications { action: 'read-all' } → { seenAt }
 */
export default citizenHandler('notifications', ['GET', 'POST'], async (citizen, req) => {
  if (req.method === 'GET') return listInbox(citizen.id);
  if (req.body?.action === 'read-all') return markAllRead(citizen.id);
  return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
});
