// R44 — how the person wants to be received, chosen BEFORE the slots (the slots of a service depend on its modality), with what is known before the commitment:
// the structure's recorded address and its verification state for in person, the true state of the video service (a LAB sandbox is said to be a test), and
// the modalities that cannot be booked here (video not active, telephone not offered online) shown as such — never as a choice.
import { forwardRef, useId } from 'react';
import { MapPin, Phone, Video } from 'lucide-react';
import { useT } from '@/i18n';
import { modalityLabels } from '@/lib/bookingModalities';

/**
 * @typedef {import('@/lib/bookingModalities.js').Modality} Modality
 * @typedef {import('@/lib/bookingModalities.js').Location} Location
 */

/** The address line (or « to confirm ») shown before the commitment. @param {{ location: Location, testid?: string }} props */
export function LocationNote({ location, testid = 'booking-location' }) {
  const { t } = useT('booking');
  return (
    <p className="flex items-start gap-2 text-sm text-slate-800" data-testid={testid}>
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" aria-hidden="true" />
      <span>
        {location ? (
          <>
            <span className="font-medium">{t('booking:modality.address_label', 'Adresse :')}</span>{' '}
            <span lang="fr" dir="ltr">{location.address}</span>
            {location.verified ? null : <> {t('booking:modality.address_unverified', '(adresse non encore vérifiée par Accès Direct Aide : confirmez-la auprès de la structure)')}</>}
            {location.stepFreeAccess ? <> — {t('booking:modality.step_free', 'accessible aux personnes à mobilité réduite (selon la structure)')}</> : null}
          </>
        ) : t('booking:modality.address_tbc', 'Adresse : à confirmer auprès de la structure (elle n’est pas renseignée sur Accès Direct Aide).')}
      </span>
    </p>
  );
}

/** What a video appointment really is here. @param {{ sandbox: boolean, testid?: string }} props */
export function VideoNote({ sandbox, testid = 'booking-video-status' }) {
  const { t } = useT('booking');
  return (
    <div className="space-y-1 text-sm text-slate-800" data-testid={testid}>
      <p className="flex items-start gap-2">
        <Video className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" aria-hidden="true" />
        <span>{t('booking:modality.video_how', 'À distance : l’accès se fait depuis « Mes rendez-vous », 15 minutes avant, une fois la visio validée par la structure. Aucun lien n’est envoyé par e-mail.')}</span>
      </p>
      {sandbox ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950" data-testid="booking-video-sandbox">
          {t('booking:modality.video_sandbox', 'Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici. Ce n’est pas un service de visio en fonctionnement.')}
        </p>
      ) : null}
    </div>
  );
}


/** The modalities that cannot be booked here, said as such (never a choice). @param {{ options: Modality[] }} props */
export function UnavailableModalities({ options }) {
  const { t } = useT('booking');
  const unavailable = options.filter((o) => !o.bookable && o.reason !== 'NOT_FOR_SERVICE');
  const LABEL = modalityLabels(t);
  const WHY = {
    VIDEO_NOT_ACTIVE: t('booking:modality.video_not_active', 'Pas disponible : la visio n’est pas activée sur ce service pour le moment.'),
    NOT_OFFERED_ONLINE: t('booking:modality.phone_not_online', 'Pas proposé en ligne : pour un échange par téléphone, contactez la structure avec les coordonnées de sa fiche.'),
  };
  if (!unavailable.length) return null;
  return (
        <div className="space-y-1" data-testid="booking-modality-unavailable">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">{t('booking:modality.unavailable_title', 'Non proposé ici')}</h3>
          <ul className="space-y-1">
            {unavailable.map((o) => (
              <li key={o.mode} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800" data-testid={`booking-modality-unavailable-${o.mode}`}>
                {o.mode === 'PHONE' ? <Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Video className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span><span className="font-medium">{LABEL[o.mode]}</span> — {WHY[/** @type {'VIDEO_NOT_ACTIVE' | 'NOT_OFFERED_ONLINE'} */ (o.reason)]}</span>
              </li>
            ))}
          </ul>
        </div>
  );
}

/**
 * @typedef {{ options: Modality[], value: string, onChange: (mode: string) => void, location: Location, error?: string }} Props
 */
const ModalityChoice = forwardRef(/** @param {Props} props @param {import('react').ForwardedRef<HTMLDivElement>} ref */ function ModalityChoice({ options, value, onChange, location, error = '' }, ref) {
  const { t } = useT('booking');
  const id = useId();
  const bookable = options.filter((o) => o.bookable);
  const LABEL = modalityLabels(t);
  const errorId = `${id}-error`;
  return (
    <div className="space-y-4" data-testid="booking-modality">
      <div ref={ref} tabIndex={-1} role="radiogroup" aria-labelledby={`${id}-legend`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className="space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 rounded-xl">
        <h2 id={`${id}-legend`} className="text-base font-semibold text-slate-900">{t('booking:modality.legend', 'Comment souhaitez-vous être reçu(e) ?')}</h2>
        {error ? <p id={errorId} className="text-sm font-medium text-red-800" data-testid="booking-modality-error">{error}</p> : null}
        {bookable.map((o) => (
          <label key={o.mode} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${value === o.mode ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
            <input type="radio" name={`${id}-mode`} value={o.mode} checked={value === o.mode} onChange={() => onChange(o.mode)} className="mt-1 h-4 w-4" data-testid={`booking-modality-${o.mode}`} />
            <span className="space-y-1">
              <span className="block font-semibold text-slate-900">{LABEL[o.mode]}</span>
              {o.mode === 'IN_PERSON' ? <LocationNote location={location} testid="booking-modality-location" /> : null}
              {o.mode === 'VIDEO' ? <VideoNote sandbox={o.sandbox} testid="booking-modality-video" /> : null}
            </span>
          </label>
        ))}
      </div>
      <UnavailableModalities options={options} />
    </div>
  );
});

export default ModalityChoice;
