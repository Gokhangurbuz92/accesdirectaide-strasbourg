// @ts-nocheck
/**
 * PKG-4 / R14 — attach ONE file (PDF, PNG, JPEG, 5 Mo max) to a message and download the files of a conversation. The server checks the type from the content,
 * encrypts the file and lets only the two parties of the conversation read it; this component only prepares the upload and offers the download.
 */
import HealthDocumentNotice from '@/components/HealthDocumentNotice';

export const ATTACHMENT_ACCEPT = 'application/pdf,image/png,image/jpeg';
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export function readAttachment(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > ATTACHMENT_MAX_BYTES) return reject(new Error('La pièce jointe dépasse 5 Mo.'));
    if (!ATTACHMENT_ACCEPT.split(',').includes(file.type)) return reject(new Error('Seuls les fichiers PDF, PNG et JPEG sont acceptés.'));
    const reader = new FileReader();
    reader.onload = () => resolve({ filename: file.name, mimeType: file.type, contentBase64: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new Error('Fichier illisible.'));
    reader.readAsDataURL(file);
  });
}

export function AttachmentPicker({ id, file, onChange, disabled }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">Pièce jointe (facultatif : PDF, PNG ou JPEG, 5 Mo max)</label>
      <input id={id} data-testid={`${id}-input`} type="file" accept={ATTACHMENT_ACCEPT} disabled={disabled} className="block w-full text-sm"
        onChange={(e) => onChange(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
      <HealthDocumentNotice testid={`${id}-health-notice`} />
      {file ? <p className="text-xs text-slate-600" data-testid={`${id}-selected`}>Fichier choisi : {file.name}</p> : null}
    </div>
  );
}

export function AttachmentList({ attachments, onDownload, testid = 'message-attachment' }) {
  if (!Array.isArray(attachments) || !attachments.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((a) => (
        <li key={a.id}>
          <button type="button" data-testid={testid} className="text-sm text-blue-800 underline focus:outline-none focus:ring-2 focus:ring-blue-700" onClick={() => onDownload(a)}>
            Télécharger « {a.name} » ({Math.max(1, Math.round((a.byteLength || 0) / 1024))} Ko)
          </button>
        </li>
      ))}
    </ul>
  );
}

export async function saveDownload(response, name) {
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = name || 'piece-jointe';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
