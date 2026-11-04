// @ts-nocheck
/**
 * PKG-4 / R14 — attach ONE file (PDF, PNG, JPEG, 3 Mo max) to a message and download the files of a conversation. The server checks the type from the content,
 * encrypts the file and lets only the two parties of the conversation read it; this component only prepares the upload and offers the download.
 */
import HealthDocumentNotice from '@/components/HealthDocumentNotice';
import { useT } from '@/i18n';
import { ATTACHMENT_ACCEPT } from '@/lib/messageAttachments';

export function AttachmentPicker({ id, file, onChange, disabled }) {
  const { t } = useT('messaging');
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{t('messaging:attachments.picker_label', 'Pièce jointe (facultatif : PDF, PNG ou JPEG, 3 Mo max)')}</label>
      <input id={id} data-testid={`${id}-input`} type="file" accept={ATTACHMENT_ACCEPT} disabled={disabled} className="block w-full text-sm"
        onChange={(e) => onChange(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
      <HealthDocumentNotice testid={`${id}-health-notice`} />
      {file ? <p className="text-xs text-slate-600" data-testid={`${id}-selected`}>{t('messaging:attachments.selected', 'Fichier choisi : {{name}}', { name: file.name })}</p> : null}
    </div>
  );
}

export function AttachmentList({ attachments, onDownload, testid = 'message-attachment' }) {
  const { t } = useT('messaging');
  if (!Array.isArray(attachments) || !attachments.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((a) => (
        <li key={a.id}>
          <button type="button" data-testid={testid} className="text-sm text-blue-800 underline focus:outline-none focus:ring-2 focus:ring-blue-700" onClick={() => onDownload(a)}>
            {t('messaging:attachments.download', 'Télécharger « {{name}} » ({{size}} Ko)', { name: a.name, size: Math.max(1, Math.round((a.byteLength || 0) / 1024)) })}
          </button>
        </li>
      ))}
    </ul>
  );
}
