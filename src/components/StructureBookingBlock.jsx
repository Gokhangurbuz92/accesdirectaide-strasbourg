// @ts-nocheck
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate, useT } from '@/i18n';
import { openServices } from '@/lib/bookingProfile';

/**
 * G14-FIND — the booking block, at the top of the place's page (above the fold on a phone). With the profile: the services open to an online request, and
 * the first day with a free slot in the next 14 days as the server computed it (never an estimate). Without it: the booking entry as before.
 * @param {{ rdvPath: string, profile: any, profileLoading?: boolean }} props
 */
export default function StructureBookingBlock({ rdvPath, profile, profileLoading = false }) {
  const { t } = useT('structures');
  const open = openServices(profile);
  // a profile that answers with no service open to an online request: the page says so and offers no booking button (the request would be refused)
  const closedByServices = Boolean(profile) && open.length === 0;
  return (
    <Card className="border-indigo-200 bg-indigo-50/40" data-testid="structure-booking-block">
      <CardContent className="p-5 md:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-indigo-900">
          <Calendar className="h-5 w-5" aria-hidden="true" />
          {t('structures:detail.booking.title', 'Prendre rendez-vous')}
        </h2>
        {closedByServices ? (
          <p className="text-slate-800" data-testid="structure-booking-contact-only">
            {t('structures:detail.booking.contact_only', 'La demande de rendez-vous en ligne n’est pas ouverte pour les services de cette structure. Contactez-la directement (coordonnées ci-dessous).')}
          </p>
        ) : (
          <>
            <p className="mb-3 text-slate-800">{t('structures:detail.booking.text', 'Cette structure propose la prise de rendez-vous en ligne.')}</p>
            {open.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-1 text-sm font-semibold text-slate-900">{t('structures:detail.booking.services_title', 'Services ouverts à la demande en ligne')}</h3>
                <ul className="space-y-1 text-sm text-slate-800" data-testid="structure-booking-services">
                  {open.map((s) => (
                    <li key={s.id} className="flex flex-wrap gap-x-2">
                      <span lang="fr" className="font-medium">{s.name}</span>
                      {Number.isFinite(Number(s.durationMinutes)) && Number(s.durationMinutes) > 0
                        ? <span className="text-slate-700">{t('structures:detail.booking.duration', '({{n}} min)', { n: Number(s.durationMinutes) })}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {profile && open.length > 0 ? (
              <p className="mb-3 text-sm text-slate-900" data-testid="structure-booking-next-day">
                {profile.nextAvailableDay
                  ? t('structures:detail.booking.next_day', 'Premier jour avec un créneau libre : {{date}}.', { date: formatDate(`${profile.nextAvailableDay}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' }) })
                  : t('structures:detail.booking.no_slot_14', 'Aucun créneau libre dans les 14 prochains jours. Vous pouvez réessayer plus tard ou contacter la structure.')}
              </p>
            ) : null}
            {profileLoading ? <p className="sr-only" role="status">{t('structures:detail.booking.loading', 'Chargement des disponibilités…')}</p> : null}
            <Button className="min-h-11 w-full bg-indigo-700 hover:bg-indigo-800" asChild>
              <Link to={rdvPath}>{t('structures:detail.booking.slots', 'Voir les créneaux disponibles')}</Link>
            </Button>
          </>
        )}
        {/* R42 (DEC-R42-01): an account is required to ask for an appointment; the page itself stays open to everyone */}
        {closedByServices ? null : (
          <p className="mt-3 text-sm text-slate-700" data-testid="structure-booking-account-required">
            {t('structures:detail.booking.account_required', 'Un compte particulier est nécessaire pour demander un rendez-vous. Les informations de cette page restent consultables sans compte.')}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-700" data-testid="structure-not-partner">
          {t('structures:detail.booking.not_partner', 'La présence de cette structure dans l’annuaire ne signifie pas un partenariat avec AccesDirectAide.')}
        </p>
      </CardContent>
    </Card>
  );
}
