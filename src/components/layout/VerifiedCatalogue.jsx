import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { HandHeart, FileText, MapPin, Wrench, BookOpen, Newspaper } from 'lucide-react';
import useCatalogueCounts from '@/hooks/useCatalogueCounts';
import { OFFICIAL_TOOLS } from '@/config/officialTools';
import { formatNumber, useT } from '@/i18n';

/**
 * What a visitor can use right now, with live counts (R26): shown on the home page and in place of an empty catalogue, so an empty section always
 * leads to real, verified content instead of a dead end. A count that cannot be read is not shown; nothing is estimated.
 * R32: the texts and the counts are in the interface language (`heading` comes translated from the page).
 */
export default function VerifiedCatalogue({ heading = undefined, exclude = [] }) {
  const { t } = useT('shared');
  const c = useCatalogueCounts();
  const cards = [
    { key: 'aides', to: '/aides', icon: HandHeart, label: t('shared:catalogue.aides', 'Aides'), text: t('shared:catalogue.aides.text', 'Aides nationales et locales, avec leurs conditions et leur source officielle.'), n: c.aides,
      unit: (/** @type {number} */ n) => t('shared:catalogue.aides.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} aide vérifiée', defaultValue_other: '{{n}} aides vérifiées' }) },
    { key: 'demarches', to: '/demarches', icon: FileText, label: t('shared:catalogue.demarches', 'Démarches'), text: t('shared:catalogue.demarches.text', 'Les étapes et les documents pour faire une demande, pas à pas.'), n: c.demarches,
      unit: (/** @type {number} */ n) => t('shared:catalogue.demarches.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} démarche vérifiée', defaultValue_other: '{{n}} démarches vérifiées' }) },
    { key: 'structures', to: '/structures', icon: MapPin, label: t('shared:catalogue.structures', 'Lieux d’accueil'), text: t('shared:catalogue.structures.text', 'Mairies, CCAS, Espaces France Services, associations, établissements médico-sociaux…'), n: c.structures,
      unit: (/** @type {number} */ n) => t('shared:catalogue.structures.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} lieu vérifié', defaultValue_other: '{{n}} lieux vérifiés' }) },
    { key: 'guides', to: '/bonnes-pratiques', icon: BookOpen, label: t('shared:catalogue.guides', 'Guides pratiques'), text: t('shared:catalogue.guides.text', 'Les fiches officielles de Service-Public pour les papiers, le logement, le budget et les recours.'), n: c.guides,
      unit: (/** @type {number} */ n) => t('shared:catalogue.guides.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} fiche officielle', defaultValue_other: '{{n}} fiches officielles' }) },
    { key: 'actualites', to: '/actualites', icon: Newspaper, label: t('shared:catalogue.actualites', 'Actualités'), text: t('shared:catalogue.actualites.text', 'Ce qui change pour vos droits, repris de Service-Public et vérifié sur la page d’origine.'), n: c.actualites,
      unit: (/** @type {number} */ n) => t('shared:catalogue.actualites.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} actualité vérifiée', defaultValue_other: '{{n}} actualités vérifiées' }) },
    { key: 'outils', to: '/outils', icon: Wrench, label: t('shared:catalogue.outils', 'Outils officiels'), text: t('shared:catalogue.outils.text', 'Simulateurs et services en ligne des organismes publics.'), n: OFFICIAL_TOOLS.length,
      unit: (/** @type {number} */ n) => t('shared:catalogue.outils.count', { count: n, n: formatNumber(n), defaultValue_one: '{{n}} outil officiel', defaultValue_other: '{{n}} outils officiels' }) },
  ].filter((x) => !exclude.includes(x.key));
  return (
    <section aria-labelledby="verified-catalogue-title" data-testid="verified-catalogue">
      <h2 id="verified-catalogue-title" className="text-xl font-bold text-slate-900">{heading ?? t('shared:catalogue.heading', 'Ce que vous pouvez consulter dès maintenant')}</h2>
      <div className={`mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 ${cards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {cards.map(({ key, to, icon: Icon, label, text, n, unit }) => (
          <Link key={key} to={to} className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Icon className="h-5 w-5" /></span>
            <span className="mt-4 text-base font-semibold text-slate-900 group-hover:text-blue-700">{label}</span>
            <span className="mt-1 flex-1 text-sm text-slate-600">{text}</span>
            {typeof n === 'number' && <span className="mt-4 text-sm font-semibold text-blue-800" data-testid={`count-${key}`}>{unit(n)}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

VerifiedCatalogue.propTypes = { heading: PropTypes.string, exclude: PropTypes.arrayOf(PropTypes.string) };
