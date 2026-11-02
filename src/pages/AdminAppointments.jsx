// @ts-nocheck
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

/**
 * /admin/appointments — owner LAB audit (2026-10-25). This page used to list and « accept » citizens' appointment requests through an `AppointmentRequest`
 * entity of the former Base44 platform; that entity does not exist here, so the list could never load. In this application appointments are booked with a
 * structure and handled by that structure in its Espace Pro; ADA staff have no implicit access to people's appointments (separate security model, A16). The
 * page now says so and points to where ADA does act.
 */
export default function AdminAppointments() {
  const { t } = useT('admin');
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid="admin-appointments-info">
      <h1 className="text-2xl font-bold text-slate-900">{t('admin:appointments.title', 'Rendez-vous')}</h1>
      <p className="text-slate-800">{t('admin:appointments.handled_by_structure', 'Les rendez-vous sont pris auprès d’une structure et gérés par cette structure dans son Espace Pro (agenda, confirmation, report, annulation).')}</p>
      <p className="text-slate-800">{t('admin:appointments.no_access', 'L’administration d’ADA n’a pas accès aux rendez-vous des personnes : il n’existe pas d’accès implicite aux dossiers.')}</p>
      <ul className="list-disc space-y-1 pl-5 text-slate-800">
        <li><Trans i18n={i18n} i18nKey="admin:appointments.via_support" defaults="Une personne qui signale un problème de rendez-vous passe par les <0>demandes d’aide</0>." components={[<Link key="support" className="text-blue-800 underline" to="/admin/support" />]} /></li>
        <li><Trans i18n={i18n} i18nKey="admin:appointments.via_privacy" defaults="Une demande liée à ses données (accès, effacement) se traite dans la <0>protection des données</0>." components={[<Link key="privacy" className="text-blue-800 underline" to="/admin/privacy" />]} /></li>
        <li><Trans i18n={i18n} i18nKey="admin:appointments.via_organizations" defaults="Une structure à suspendre se traite dans <0>Organisations</0>." components={[<Link key="orgs" className="text-blue-800 underline" to="/admin/organizations" />]} /></li>
      </ul>
    </div>
  );
}
