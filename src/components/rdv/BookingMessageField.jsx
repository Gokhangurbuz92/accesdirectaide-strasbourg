// R42 (owner decision R42-A06) — the optional short message of a request: plain text, at most 500 characters.
// R43 (dossier RGPD § 2.1, E6 — proposal to validate): a label that does not invite a health description, and an explicit, never pre-ticked consent box shown
// only while a message is written; the server refuses a message without it (MESSAGE_CONSENT_REQUIRED). The server validates again (no markup) and keeps
// the message sealed, visible to the structure's authorised staff only; the person can withdraw it from « Mes rendez-vous » before the appointment.
import { forwardRef, useId } from 'react';
import { useT } from '@/i18n';

export const MESSAGE_MAX = 500;

/**
 * @typedef {{ value: string, onChange: (value: string) => void, consent?: boolean, onConsentChange?: (value: boolean) => void, consentError?: boolean, disabled?: boolean }} Props
 */
const BookingMessageField = forwardRef(/** @param {Props} props @param {import('react').ForwardedRef<HTMLInputElement>} consentRef */ function BookingMessageField(
  { value, onChange, consent = false, onConsentChange = () => {}, consentError = false, disabled = false }, consentRef) {
  const { t } = useT('booking');
  const id = useId();
  const used = Array.from(value).length;
  const written = value.trim().length > 0;
  return (
    <div className="space-y-1" data-testid="booking-message">
      <label htmlFor={`${id}-msg`} className="block text-sm font-medium text-slate-900">
        {t('booking:message.label_r43', 'Message à la structure (facultatif)')}
      </label>
      <p id={`${id}-notice`} className="text-sm text-slate-700">
        {t('booking:message.notice_r43', 'Inutile de décrire votre santé, un handicap ou un diagnostic : la structure vous posera les questions utiles pendant le rendez-vous. N’envoyez pas de document médical.')}
      </p>
      <textarea id={`${id}-msg`} rows={3} maxLength={MESSAGE_MAX} disabled={disabled} value={value} aria-describedby={`${id}-notice ${id}-count`}
        onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-slate-400 bg-white p-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700" />
      <p id={`${id}-count`} className="text-xs text-slate-700" aria-live="polite">{t('booking:message.count', '{{used}} / {{max}} caractères', { used, max: MESSAGE_MAX })}</p>
      {written ? (
        <div className="pt-1" data-testid="booking-message-consent">
          <div className="flex items-start gap-2">
            <input ref={consentRef} id={`${id}-consent`} type="checkbox" className="mt-1 h-4 w-4" checked={consent} disabled={disabled}
              aria-invalid={consentError ? 'true' : undefined} aria-describedby={consentError ? `${id}-consent-error` : undefined}
              data-testid="booking-message-consent-checkbox" onChange={(e) => onConsentChange(e.target.checked)} />
            <label htmlFor={`${id}-consent`} className="text-sm text-slate-900">
              {t('booking:message.consent_r43', 'J’accepte que ce message soit transmis à l’équipe de la structure choisie. Il peut contenir des informations sur ma situation. Je peux le retirer avant le rendez-vous.')}
            </label>
          </div>
          {consentError ? (
            <p id={`${id}-consent-error`} role="alert" className="mt-1 text-sm font-medium text-red-800" data-testid="booking-message-consent-error">
              {t('booking:message.consent_required_r43', 'Cochez la case pour envoyer votre message, ou effacez-le : le rendez-vous peut être demandé sans message.')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default BookingMessageField;
