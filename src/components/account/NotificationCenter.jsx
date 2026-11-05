import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';

/** @param {(k: string, d: string) => string} t @returns {Record<string, string>} */
const kindLabels = (t) => ({
  APPOINTMENT_BOOKED_BY_STRUCTURE: t('compte:notifications.kind.booked_by_structure', 'Une structure a fixé un rendez-vous avec vous.'),
  APPOINTMENT_BOOKED_BY_CITIZEN: t('compte:notifications.kind.booked_by_citizen', 'Votre rendez-vous est enregistré.'),
  APPOINTMENT_CANCELLED_BY_STRUCTURE: t('compte:notifications.kind.cancelled_by_structure', 'Une structure a annulé un rendez-vous.'),
  APPOINTMENT_RESCHEDULED: t('compte:notifications.kind.rescheduled', 'Un rendez-vous a été déplacé.'),
  APPOINTMENT_REMINDER_J1: t('compte:notifications.kind.reminder_j1', 'Rappel : vous avez un rendez-vous demain.'),
  APPOINTMENT_VISIO_APPROVED: t('compte:notifications.kind.visio_approved', 'Le rendez-vous en visio a été accepté.'),
  APPOINTMENT_VISIO_REVOKED: t('compte:notifications.kind.visio_revoked', 'Le rendez-vous en visio n’est plus possible.'),
  APPOINTMENT_REQUEST_RECEIVED: t('compte:notifications.kind.request_received', 'Votre demande de rendez-vous a été transmise.'),
  APPOINTMENT_REQUEST_ACCEPTED: t('compte:notifications.kind.request_accepted', 'Votre demande de rendez-vous a été acceptée.'),
  APPOINTMENT_REQUEST_REFUSED: t('compte:notifications.kind.request_refused', 'Votre demande de rendez-vous n’a pas pu être acceptée.'),
  MESSAGE_FROM_STRUCTURE: t('compte:notifications.kind.message_from_structure', 'Nouveau message d’une structure.'),
  DOSSIER_MESSAGE: t('compte:notifications.kind.dossier_message', 'Nouveau message sur un dossier partagé.'),
  PARCOURS_DEADLINE_SOON: t('compte:notifications.kind.parcours_deadline', 'Une échéance de Mon Parcours arrive dans moins de 7 jours.'),
  DOCUMENT_EXPIRING: t('compte:notifications.kind.document_expiring', 'Un document de Mon Coffre arrive à sa date de fin de validité.'),
  GUARDIAN_REQUEST: t('compte:notifications.kind.guardian_request', 'Une demande de lien de représentant légal attend votre réponse.'),
});

/**
 * R46 / N03 — the notification centre of Mon Espace. Items say WHAT happened and WHEN, with a link; the content stays on the linked page (minimisation).
 * An unreadable list (closed capability, outage) shows no card rather than a broken one.
 */
export default function NotificationCenter() {
  const { t } = useT('compte');
  const LABELS = kindLabels(t);
  const [data, setData] = useState(/** @type {any} */ (null));
  const [note, setNote] = useState('');
  const load = useCallback(() => Promise.resolve().then(() => citizenApi.notifications()).then(setData, () => setData({ error: true })), []);
  useEffect(() => { load(); }, [load]);
  if (!data || data.error) return null;
  const items = /** @type {any[]} */ (data.notifications || []).filter((n) => LABELS[n.kind]);
  const readAll = async () => {
    setNote('');
    try { await citizenApi.markNotificationsRead(); await load(); setNote(t('compte:notifications.all_read', 'Toutes les notifications sont marquées comme lues.')); }
    catch (e) { setNote(/** @type {any} */ (e)?.message || t('compte:notifications.failed', 'Action impossible pour le moment.')); }
  };
  return (
    <Card data-testid="notification-center">
      <CardHeader>
        <CardTitle as="h2" id="notifications-title" className="text-base">
          {t('compte:notifications.title', 'Notifications')}
          {data.unread ? <span className="ml-2 rounded-full bg-blue-800 px-2 py-0.5 text-xs font-semibold text-white" data-testid="notifications-unread">{t('compte:notifications.unread', '{{n}} non lue(s)', { n: data.unread })}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-800">
        {items.length === 0 ? <p data-testid="notifications-empty">{t('compte:notifications.empty', 'Aucune notification pour le moment.')}</p> : (
          <ul className="space-y-2" aria-labelledby="notifications-title" data-testid="notifications-list">
            {items.map((n) => (
              <li key={n.id} className={`rounded-md border p-2 ${n.unread ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`} data-testid="notification-item" data-kind={n.kind}>
                <Link to={n.link} className="font-medium text-blue-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{LABELS[n.kind]}</Link>
                <span className="ml-2 text-xs text-slate-700">{formatDate(n.at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                {n.unread ? <span className="sr-only">{t('compte:notifications.unread_item', '(non lue)')}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {data.unread ? <Button size="sm" variant="outline" onClick={readAll} data-testid="notifications-read-all">{t('compte:notifications.read_all', 'Tout marquer comme lu')}</Button> : null}
        <p className="text-xs text-slate-700">{t('compte:notifications.privacy', 'Les notifications ne contiennent aucun message ni nom : ouvrez le lien pour voir le détail.')}</p>
        {note ? <p role="status" className="text-sm text-slate-800">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
