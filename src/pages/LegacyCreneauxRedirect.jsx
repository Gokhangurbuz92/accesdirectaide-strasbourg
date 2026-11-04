// R43 — the legacy slot screen /rdv/:slug/creneaux (and /rdv/:slug, /rdv/:slug/services) → the account journey /rdv/:slug/booking, client-side, with the
// slug, service, modality and journey context kept (src/lib/rdvRouting.js legacyCreneauxBookingPath: same-origin path from a validated slug only).
// The booking page's gate (PublicBookingAccessGate) then asks for a citizen session: the redirect never opens anonymous booking.
// R44: mounted on /rdv/:slug, /rdv/:slug/services and /rdv/:slug/creneaux (src/pages/index.jsx); native QA spec v67 follows the /booking journey.
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { legacyCreneauxBookingPath } from '@/lib/rdvRouting';

export default function LegacyCreneauxRedirect() {
  const { structureSlug } = useParams();
  const location = useLocation();
  return <Navigate to={legacyCreneauxBookingPath(structureSlug, location.search)} replace />;
}
