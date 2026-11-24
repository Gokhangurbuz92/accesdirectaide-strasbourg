// @ts-nocheck
import { ExternalLink, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useT } from '@/i18n';
import { needName } from '@/lib/socialNeeds';

/**
 * G14 release 3 — « Rendez-vous sur leur site »: the place takes appointments on its OWN system. Shown only for a page an administrator approved and while
 * the server's public switch is open (the API sends `external_booking` only then). Not AccesDirectAide booking: no account, no request is sent by us.
 * The outbound link says clearly that the person leaves AccesDirectAide; it carries nothing about the visitor (the stored URL is the place's page, checked
 * to hold no personal data; rel="noopener noreferrer" and referrerPolicy no-referrer: the other site does not learn which page sent the visitor).
 * @param {{ booking: { url: string, host: string, platform: string, platformLabel: string | null, subdomains?: string[] } }} props
 */
export default function ExternalBookingBlock({ booking }) {
  const { t } = useT('structures');
  if (!booking || typeof booking.url !== 'string' || !booking.url.startsWith('https://')) return null;
  const needs = Array.isArray(booking.subdomains) ? booking.subdomains : [];
  return (
    <Card className="border-slate-300 bg-white" data-testid="structure-external-booking">
      <CardContent className="p-5 md:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-slate-900">
          <Globe className="h-5 w-5 text-slate-700" aria-hidden="true" />
          {t('structures:ownbooking.title', 'Rendez-vous sur leur site')}
        </h2>
        <p className="mb-2 text-slate-800">{t('structures:ownbooking.text', 'Cette structure prend ses rendez-vous sur son propre système. Ce n’est pas une prise de rendez-vous sur AccesDirectAide : la demande, les conditions et la confirmation dépendent de ce site.')}</p>
        {booking.platformLabel ? (
          <p className="mb-2 text-sm text-slate-800" data-testid="structure-external-booking-platform">
            {t('structures:ownbooking.platform', 'Plateforme publique de prise de rendez-vous : {{name}}.', { name: booking.platformLabel })}
          </p>
        ) : null}
        {needs.length > 0 ? (
          <p className="mb-2 text-sm text-slate-800">{t('structures:ownbooking.needs', 'Pour : {{needs}}.', { needs: needs.map((id) => needName(t, id)).join(' · ') })}</p>
        ) : null}
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" id="external-booking-leave" data-testid="structure-external-booking-leave">
          {t('structures:ownbooking.leave', 'Vous quittez AccesDirectAide. Le site ouvert a ses propres conditions et sa propre politique de confidentialité. AccesDirectAide ne lui transmet aucune information sur vous.')}
        </p>
        <a href={booking.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-describedby="external-booking-leave"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-800 px-4 py-2 font-semibold text-white hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          data-testid="structure-external-booking-link">
          {t('structures:ownbooking.link', 'Prendre rendez-vous sur {{host}}', { host: booking.host })}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('structures:ownbooking.new_window', ' (nouvelle fenêtre, site extérieur)')}</span>
        </a>
      </CardContent>
    </Card>
  );
}
