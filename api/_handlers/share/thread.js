import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { holdsOwnerSecret } from '../../_utils/share-access.js';
import * as threads from '../../_services/shared-dossier-threads.js';

const MAX_ENCRYPTED_CONTENT_LENGTH = 32 * 1024;
const NOT_FOUND = { error: 'not_found', message: 'Ce dossier est introuvable ou inaccessible.' };

/**
 * POST /api/share/thread — the SHARER side of a structure <-> shared-diagnostic chat.
 * Authentication is the capability (fragment secret) of the shared diagnostic, exactly like /api/share/get; unknown id, wrong capability and
 * a thread of another dossier are indistinguishable (404). The sharer can only read and answer threads that structures opened on THEIR dossier;
 * they cannot create threads (no way to spam structures). Expired dossiers answer 410.
 *
 * Body: { id, capability, action: 'list' }                                 -> { threads: [{ id, structureName, lastMessageAt }] }
 *       { id, capability, action: 'messages', threadId }                   -> { items: [{ id, sender: 'PRO'|'SHARER', encryptedContent, createdAt }] }
 *       { id, capability, action: 'send', threadId, encryptedContent }     -> 201 { item }
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const id = String(req.body?.id || '').trim();
  const capability = String(req.body?.capability || '').trim();
  const action = String(req.body?.action || '').trim();
  if (!id || id.length > 128 || !capability || !['list', 'messages', 'send'].includes(action)) return res.status(404).json(NOT_FOUND);

  try {
    const limit = await checkRateLimit(action === 'send' ? 'MESSAGE_USER_SEND' : 'MESSAGE_USER_READ', `share:${id}:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });

    const dossier = await threads.getDossier(id);
    if (!dossier || !holdsOwnerSecret(dossier, capability)) return res.status(404).json(NOT_FOUND);   // OWNER secret only; legacy rows have no owner (a link is never proof of ownership)
    if (threads.isExpired(dossier)) return res.status(410).json({ error: 'expired', message: 'Ce lien de partage a expiré.' });

    if (action === 'list') {
      const rows = await threads.listThreads(dossier.id);
      return res.status(200).json({ ok: true, threads: rows.map((t) => ({ id: t.id, structureName: t.structureName, lastMessageAt: t.lastMessageAt })) });
    }

    const threadId = String(req.body?.threadId || '').trim();
    const thread = threadId && threadId.length <= 128 ? await threads.findThreadOfDossier(dossier.id, threadId) : null;
    if (!thread) return res.status(404).json(NOT_FOUND);

    if (action === 'messages') {
      const rows = await threads.listMessages(thread.id, 50);
      return res.status(200).json({
        ok: true,
        items: rows.map((m) => ({ id: m.id, sender: m.senderType === 'PRO' ? 'PRO' : 'SHARER', encryptedContent: threads.openMessage(thread.id, m.body), createdAt: m.createdAt })),
      });
    }

    const encryptedContent = req.body?.encryptedContent;
    if (typeof encryptedContent !== 'string' || encryptedContent.length === 0) return res.status(400).json({ error: 'Contenu manquant' });
    if (encryptedContent.length > MAX_ENCRYPTED_CONTENT_LENGTH) return res.status(413).json({ error: 'Message trop volumineux' });
    const wrapped = threads.sealMessage(thread.id, encryptedContent);
    const msg = await threads.addMessage({ threadId: thread.id, senderType: 'SHARER', senderProUserId: null, body: wrapped });
    return res.status(201).json({ ok: true, item: { id: msg.id, sender: 'SHARER', createdAt: msg.createdAt } });
  } catch (error) {
    logger.error({ err: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'share thread failed' } }, '[Share Thread Error]');
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
}
