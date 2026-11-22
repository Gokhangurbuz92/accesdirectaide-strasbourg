// @ts-nocheck
/**
 * G14 / DSA art. 17, 20 — « Décisions de modération » in the person's space: the statements of reasons about their content (author) and the decisions on
 * their reports (notifier), and the internal complaint, six months, free (owner decision 30). A verified citizen session, CSRF on writes.
 *   GET  /api/citizen/moderation                         { available, decisions: [{ id, role, contentType, action, reasonCode, decidedAt, appealUntil, statement, appeal, canAppeal }] }
 *   POST /api/citizen/moderation { action: 'appeal', decisionId, body }
 * Open only while a content capability is open (api/_handlers/notices.js anyUgcOpen). Who reported is never shown to the author.
 */
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { citizenModeration } from '../../_services/moderation-dsa.js';
import { anyUgcOpen } from '../notices.js';

const ID = /^[0-9a-f-]{36}$/i;
const CLOSED = { ok: false, status: 503, code: 'CAPABILITY_NOT_OPEN', message: 'Aucun contenu publié par les utilisateurs n’est ouvert sur ce service.' };
export default citizenHandler('moderation', ['GET', 'POST'], async (citizen, req) => {
  if (!anyUgcOpen()) return CLOSED;
  const svc = citizenModeration();
  if (req.method === 'GET') return svc.list(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action !== 'appeal') return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
  if (typeof b.decisionId !== 'string' || !ID.test(b.decisionId)) return { ok: false, status: 400, code: 'ID_REQUIRED', message: 'Décision manquante.' };
  return svc.appeal(citizen.id, b.decisionId, b.body);
});
