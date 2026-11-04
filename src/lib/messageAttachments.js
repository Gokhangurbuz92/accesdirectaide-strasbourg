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
