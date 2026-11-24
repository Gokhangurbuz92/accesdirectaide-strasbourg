/**
 * PKG-4 / R14 — the non-component half of src/components/Messaging/MessageAttachments.jsx (R42: moved here so the component file only exports
 * components): the accepted types and size (equal to the server's, api/_services/message-attachments.js), reading ONE file for upload, saving a download.
 */
import i18n from '@/i18n';

export const ATTACHMENT_ACCEPT = 'application/pdf,image/png,image/jpeg';
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;   // R34: equal to the server's limit (api/_services/message-attachments.js)

/** @param {File | null | undefined} file @returns {Promise<{ filename: string, mimeType: string, contentBase64: string } | null>} */
export function readAttachment(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > ATTACHMENT_MAX_BYTES) return reject(new Error(i18n.t('messaging:attachments.too_large', 'La pièce jointe dépasse 3 Mo.')));
    if (!ATTACHMENT_ACCEPT.split(',').includes(file.type)) return reject(new Error(i18n.t('messaging:attachments.bad_type', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.')));
    const reader = new FileReader();
    reader.onload = () => resolve({ filename: file.name, mimeType: file.type, contentBase64: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new Error(i18n.t('messaging:attachments.unreadable', 'Fichier illisible.')));
    reader.readAsDataURL(file);
  });
}

/** @param {Response} response @param {string} [name] */
export async function saveDownload(response, name) {
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = name || 'piece-jointe';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * G14-R4 — through the HDS service when this site has one (messaging.attachments): the file is encrypted in this browser for the person AND the
 * organisation, stored at the certified host with a ticket bound to the conversation, and only its reference { hdsAttachmentId, byteLength, sha256 } is sent
 * with the message. Without an HDS service (the LAB), the legacy upload. Errors carry a code (CITIZEN_KEY_MISSING, ORG_KEY_MISSING, UNSUPPORTED_TYPE).
 * @param {'citizen' | 'pro'} side @param {string} conversationId @param {File | null | undefined} file
 */
export async function prepareOutgoingAttachment(side, conversationId, file) {
  if (!file) return null;
  if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(i18n.t('messaging:attachments.too_large', 'La pièce jointe dépasse 3 Mo.'));
  const { uploadAttachment } = await import('./hdsSharing.js');
  let ref = null;
  try { ref = await uploadAttachment(side, conversationId, file); }
  catch (e) {
    const code = /** @type {any} */ (e)?.code;
    if (code === 'CITIZEN_KEY_MISSING') throw new Error(i18n.t('messaging:attachments.hds_citizen_key', 'La personne n’a pas encore activé Mon Coffre : la pièce jointe chiffrée ne peut pas lui être envoyée.'));
    if (code === 'ORG_KEY_MISSING') throw new Error(i18n.t('messaging:attachments.hds_org_key', 'La structure n’a pas encore créé sa clé de chiffrement : envoyez votre message sans pièce jointe.'));
    if (code === 'UNSUPPORTED_TYPE') throw new Error(i18n.t('messaging:attachments.bad_type', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.'));
    throw e;
  }
  return ref || readAttachment(file);
}

/**
 * open a received attachment: from the HDS service (decrypted here with the person's or the organisation's key) or the legacy download
 * @param {'citizen' | 'pro'} side @param {string} conversationId @param {{ id: string, name: string, hds?: boolean }} a @param {() => Promise<Response>} legacy
 */
export async function openIncomingAttachment(side, conversationId, a, legacy) {
  if (a.hds) {
    const { downloadAttachment } = await import('./hdsSharing.js');
    const { saveBlob } = await import('./hdsClient.js');
    let out;
    try { out = await downloadAttachment(side, conversationId, a.id); }
    catch (e) {
      const code = /** @type {any} */ (e)?.code;
      if (code === 'VAULT_LOCKED') throw new Error(i18n.t('messaging:attachments.hds_unlock_citizen', 'Ouvrez d’abord Mon Coffre avec votre phrase secrète pour lire cette pièce jointe chiffrée.'));
      if (code === 'ORG_KEY_LOCKED') throw new Error(i18n.t('messaging:attachments.hds_unlock_pro', 'Ouvrez d’abord vos clés dans « Dossiers chiffrés » pour lire cette pièce jointe chiffrée.'));
      throw e;
    }
    if (out) { saveBlob(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (out.bytes))], { type: out.type }), out.name); return; }
  }
  const r = await legacy();
  if (!r.ok) throw new Error(String(r.status));
  await saveDownload(r, a.name);
}
