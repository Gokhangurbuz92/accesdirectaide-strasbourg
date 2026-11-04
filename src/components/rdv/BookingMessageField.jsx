// R42 (owner decision R42-A06) — the optional short message of a request: the owner's label and notice, plain text, at most 500 characters.
// The server validates again (no markup) and keeps it sealed, visible to the structure's authorised staff only.
import { useId } from 'react';
import { useT } from '@/i18n';

export const MESSAGE_MAX = 500;

/** @param {{ value: string, onChange: (value: string) => void, disabled?: boolean }} props */
export default function BookingMessageField({ value, onChange, disabled = false }) {
  const { t } = useT('booking');
  const id = useId();
  const used = Array.from(value).length;
  return (
    <div className="space-y-1" data-testid="booking-message">
      <label htmlFor={`${id}-msg`} className="block text-sm font-medium text-slate-900">
        {t('booking:message.label', 'Précisez brièvement le motif de votre rendez-vous (facultatif)')}
      </label>
      <p id={`${id}-notice`} className="text-sm text-slate-700">
        {t('booking:message.notice', 'Indiquez uniquement les informations nécessaires à votre demande. Ne transmettez pas de diagnostic ni de document médical dans ce champ.')}
      </p>
      <textarea id={`${id}-msg`} rows={3} maxLength={MESSAGE_MAX} disabled={disabled} value={value} aria-describedby={`${id}-notice ${id}-count`}
        onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-slate-400 bg-white p-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700" />
      <p id={`${id}-count`} className="text-xs text-slate-700" aria-live="polite">{t('booking:message.count', '{{used}} / {{max}} caractères', { used, max: MESSAGE_MAX })}</p>
    </div>
  );
}
