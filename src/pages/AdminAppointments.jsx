// @ts-nocheck
import { Link } from 'react-router-dom';

/**
 * /admin/appointments — owner LAB audit (2026-10-25). This page used to list and « accept » citizens' appointment requests through an `AppointmentRequest`
 * entity of the former Base44 platform; that entity does not exist here, so the list could never load. In this application appointments are booked with a
 * structure and handled by that structure in its Espace Pro; ADA staff have no implicit access to people's appointments (separate security model, A16). The
 * page now says so and points to where ADA does act.
 */
export default function AdminAppointments() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid="admin-appointments-info">
      <h1 className="text-2xl font-bold text-slate-900">Rendez-vous</h1>
      <p className="text-slate-800">Les rendez-vous sont pris auprès d’une structure et gérés par cette structure dans son Espace Pro (agenda, confirmation, report, annulation).</p>
      <p className="text-slate-800">L’administration d’ADA n’a pas accès aux rendez-vous des personnes : il n’existe pas d’accès implicite aux dossiers.</p>
      <ul className="list-disc space-y-1 pl-5 text-slate-800">
        <li>Une personne qui signale un problème de rendez-vous passe par les <Link className="text-blue-800 underline" to="/admin/support">demandes d’aide</Link>.</li>
        <li>Une demande liée à ses données (accès, effacement) se traite dans la <Link className="text-blue-800 underline" to="/admin/privacy">protection des données</Link>.</li>
        <li>Une structure à suspendre se traite dans <Link className="text-blue-800 underline" to="/admin/organizations">Organisations</Link>.</li>
      </ul>
    </div>
  );
}
