// VIS — the human alternative on every dead end (empty search, empty list, page or record not found, withdrawn content). When the site cannot answer,
// the person is told they can ask someone in person, and is given the official locators. No phone number, no promise of a result: « vous pouvez demander ».
// The names of the French public services (France services, CCAS, mairie) stay in French in every interface language: they are what is written on the door.
import { createElement } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { ExternalLink, Users } from 'lucide-react';
import { useT } from '@/i18n';

/** Official locators, each opened and read on 15/11/2026 (France services: address search on the home page; Annuaire de l'administration, DILA: the CCAS/CIAS and mairie lists, filter by address or postcode). */
export const HUMAN_HELP_URLS = Object.freeze({
  franceServices: 'https://www.france-services.gouv.fr/',
  ccas: 'https://lannuaire.service-public.gouv.fr/navigation/ccas',
  mairie: 'https://lannuaire.service-public.gouv.fr/navigation/mairie',
});
/** the site's own directory, filtered on the France services offices (src/pages/Annuaire.jsx TYPE_STRUCTURES) */
export const HUMAN_HELP_DIRECTORY = '/structures?type=france_services';

const LINK = 'ada-target min-h-11 gap-1 font-medium text-blue-800 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm';

/**
 * @param {{ headingLevel?: 2 | 3, className?: string, id?: string, directoryLink?: boolean }} props  headingLevel: the level that follows the page's own heading (2 under an h1);
 *   id: when a page shows the block twice; directoryLink: false on the directory's own empty France services list (the link would lead back to it)
 */
export default function HumanHelpBlock({ headingLevel = 2, className = '', id = 'human-help', directoryLink = true }) {
  const { t } = useT('shared');
  const newWindow = t('shared:newWindow', ' (nouvelle fenêtre)');
  const titleId = `${id}-title`;
  const external = [
    [HUMAN_HELP_URLS.franceServices, t('shared:humanHelp.franceServices', 'Trouver une France services (site officiel)')],
    [HUMAN_HELP_URLS.ccas, t('shared:humanHelp.ccas', 'Trouver un CCAS (annuaire officiel de l’administration)')],
    [HUMAN_HELP_URLS.mairie, t('shared:humanHelp.mairie', 'Trouver une mairie (annuaire officiel de l’administration)')],
  ];
  return (
    <section className={`mx-auto my-6 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-start text-sm text-slate-800 ${className}`.trim()} aria-labelledby={titleId} data-testid="human-help-block">
      {createElement(`h${headingLevel === 3 ? 3 : 2}`, { id: titleId, className: 'flex items-center gap-2 text-base font-semibold text-slate-900' },
        <Users className="h-5 w-5 shrink-0 text-blue-800" aria-hidden="true" />,
        t('shared:humanHelp.title', 'Parler à une personne'))}
      <p className="mt-2">{t('shared:humanHelp.text', 'Vous pouvez demander de l’aide sur place : dans une France services, au CCAS ou à la mairie de votre commune.')}</p>
      <ul className="mt-3 space-y-1">
        {external.map(([href, label]) => (
          <li key={href}>
            <a className={LINK} href={href} target="_blank" rel="noopener noreferrer">
              {label}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">{newWindow}</span>
            </a>
          </li>
        ))}
        {directoryLink && <li><Link className={LINK} to={HUMAN_HELP_DIRECTORY}>{t('shared:humanHelp.directory', 'Voir les France services dans notre annuaire')}</Link></li>}
      </ul>
    </section>
  );
}
HumanHelpBlock.propTypes = { headingLevel: PropTypes.oneOf([2, 3]), className: PropTypes.string, id: PropTypes.string, directoryLink: PropTypes.bool };
