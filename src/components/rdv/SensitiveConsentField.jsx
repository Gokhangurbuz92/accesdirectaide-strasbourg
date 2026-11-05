// R45 (ENG-LR-2, D2 P5s [PROPOSITION — À VALIDER PAR LE RESPONSABLE DE TRAITEMENT]) — the separate, never pre-ticked explicit consent (GDPR art. 9(2)(a))
// of a booking with a service whose nature can reveal health or disability data. Shown only when the server says the service needs it (explicitConsent),
// i.e. only while the art. 9 gate is open (closed in Production). No diagnosis is asked, no free text. Withdrawable from « Mes rendez-vous ».
import { forwardRef, useId } from 'react';
import { useT } from '@/i18n';

/**
 * @typedef {{ checked: boolean, onChange: (value: boolean) => void, error?: boolean, disabled?: boolean }} Props
 */
const SensitiveConsentField = forwardRef(/** @param {Props} props @param {import('react').ForwardedRef<HTMLInputElement>} ref */ function SensitiveConsentField(
  { checked, onChange, error = false, disabled = false }, ref) {
  const { t } = useT('booking');
  const id = useId();
  return (
    <div className="space-y-1" data-testid="booking-sensitive-consent">
      <p id={`${id}-notice`} className="text-sm text-slate-700">
        {t('booking:sensitive.notice_r45', 'Aucune information sur votre santé ne vous est demandée. Cet accord est distinct des autres et vous pouvez le retirer à tout moment.')}
      </p>
      <div className="flex items-start gap-2">
        <input ref={ref} id={`${id}-box`} type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={disabled}
          aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-notice ${id}-error` : `${id}-notice`}
          data-testid="booking-sensitive-consent-checkbox" onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={`${id}-box`} className="text-sm text-slate-900">
          {t('booking:sensitive.consent_r45', 'J’accepte que la plateforme transmette ma demande de rendez-vous à ce service. Je sais que la nature de ce service peut révéler une information sur ma santé ou un handicap. Cet accord sert uniquement à traiter ce rendez-vous. Je peux le retirer à tout moment depuis mon espace : le rendez-vous à venir est alors annulé.')}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-800" data-testid="booking-sensitive-consent-error">
          {t('booking:sensitive.consent_required_r45', 'Cochez la case pour demander ce rendez-vous en ligne. Sans cet accord, vous pouvez contacter directement la structure.')}
        </p>
      ) : null}
    </div>
  );
});

export default SensitiveConsentField;

/** the neutral explanation when a service is not bookable online (describes the service, never the person) */
export function ContactStructureNotice() {
  const { t } = useT('booking');
  return (
    <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-900" data-testid="booking-contact-structure">
      <p>{t('booking:sensitive.contact_structure_r45', 'La prise de rendez-vous en ligne n’est pas proposée pour ce service. Pour un rendez-vous, contactez directement la structure par ses moyens de contact habituels (accueil, téléphone ou site indiqués sur sa fiche). Rien n’a été transmis.')}</p>
    </div>
  );
}
