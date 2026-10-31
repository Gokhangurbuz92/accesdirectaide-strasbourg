import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { HandHeart, FileText, MapPin, Wrench } from 'lucide-react';
import useCatalogueCounts from '@/hooks/useCatalogueCounts';
import { OFFICIAL_TOOLS } from '@/config/officialTools';

const fr = (n) => n.toLocaleString('fr-FR');

/**
 * What a visitor can use right now, with live counts (R26): shown on the home page and in place of an empty catalogue, so an empty section always
 * leads to real, verified content instead of a dead end. A count that cannot be read is not shown; nothing is estimated.
 */
export default function VerifiedCatalogue({ heading = 'Ce que vous pouvez consulter dès maintenant', exclude = [] }) {
  const c = useCatalogueCounts();
  const cards = [
    { key: 'aides', to: '/aides', icon: HandHeart, label: 'Aides', text: 'Aides nationales et locales, avec leurs conditions et leur source officielle.', n: c.aides, unit: 'aides vérifiées' },
    { key: 'demarches', to: '/demarches', icon: FileText, label: 'Démarches', text: 'Les étapes et les documents pour faire une demande, pas à pas.', n: c.demarches, unit: 'démarches vérifiées' },
    { key: 'structures', to: '/structures', icon: MapPin, label: 'Lieux d’accueil', text: 'Mairies, CCAS, Espaces France Services, associations, établissements médico-sociaux…', n: c.structures, unit: 'lieux vérifiés' },
    { key: 'outils', to: '/outils', icon: Wrench, label: 'Outils officiels', text: 'Simulateurs et services en ligne des organismes publics.', n: OFFICIAL_TOOLS.length, unit: 'outils officiels' },
  ].filter((x) => !exclude.includes(x.key));
  return (
    <section aria-labelledby="verified-catalogue-title" data-testid="verified-catalogue">
      <h2 id="verified-catalogue-title" className="text-xl font-bold text-slate-900">{heading}</h2>
      <div className={`mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 ${cards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {cards.map(({ key, to, icon: Icon, label, text, n, unit }) => (
          <Link key={key} to={to} className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Icon className="h-5 w-5" /></span>
            <span className="mt-4 text-base font-semibold text-slate-900 group-hover:text-blue-700">{label}</span>
            <span className="mt-1 flex-1 text-sm text-slate-600">{text}</span>
            {typeof n === 'number' && <span className="mt-4 text-sm font-semibold text-blue-800" data-testid={`count-${key}`}>{fr(n)} {unit}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

VerifiedCatalogue.propTypes = { heading: PropTypes.string, exclude: PropTypes.arrayOf(PropTypes.string) };
