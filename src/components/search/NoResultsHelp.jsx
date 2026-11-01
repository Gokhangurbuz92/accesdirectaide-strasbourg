import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useT } from '@/i18n';

/** the two other catalogues searched with the same words, as a sentence in the interface language (one explicit call each: scripts/i18n-check.mjs) */
const SEARCH_IN = {
  aides: (/** @type {(key: string, fallback: string, values: object) => string} */ t, /** @type {string} */ query) => t('shared:noResults.inAides', 'Chercher « {{query}} » dans les aides', { query }),
  demarches: (/** @type {(key: string, fallback: string, values: object) => string} */ t, /** @type {string} */ query) => t('shared:noResults.inDemarches', 'Chercher « {{query}} » dans les démarches', { query }),
  structures: (/** @type {(key: string, fallback: string, values: object) => string} */ t, /** @type {string} */ query) => t('shared:noResults.inStructures', 'Chercher « {{query}} » dans les lieux d’accueil', { query }),
};
const OTHER = {
  aides: ['demarches', 'structures'],
  demarches: ['aides', 'structures'],
  structures: ['aides', 'demarches'],
};
const TIPS = {
  aides: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:noResults.tip.aides', 'Écrivez un mot clé (« loyer », « handicap », « APL ») plutôt qu’une phrase.'),
  demarches: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:noResults.tip.demarches', 'Écrivez un mot clé (« titre de séjour », « retraite », « logement social »).'),
  structures: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:noResults.tip.structures', 'Écrivez le type de lieu et la commune (« CCAS Strasbourg ») ou un code postal (« 67000 »).'),
};

/**
 * R28: the same help under every « no result » message of the aides, démarches and lieux lists — the same words searched in the two other catalogues
 * and in the global search, and one tip on how to write the search. It used to differ on each page, with a reset button as the only way out.
 * R32: in the interface language; the example words stay French, the language of the catalogue being searched.
 */
export default function NoResultsHelp({ kind, q = '' }) {
  const { t } = useT('shared');
  const query = String(q || '').trim();
  const enc = encodeURIComponent(query);
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700" data-testid="no-results-help">
      <p className="font-semibold text-slate-900">{t('shared:noResults.title', 'Essayez aussi')}</p>
      <ul className="mt-2 space-y-1.5">
        {query && OTHER[kind].map((path) => (
          <li key={path}><Link to={`/${path}?q=${enc}`} className="font-medium text-blue-700 hover:underline">{SEARCH_IN[/** @type {keyof typeof SEARCH_IN} */ (path)](t, query)}</Link></li>
        ))}
        {query && <li><Link to={`/recherche?q=${enc}`} className="font-medium text-blue-700 hover:underline">{t('shared:noResults.everywhere', 'Chercher « {{query}} » partout sur le site', { query })}</Link></li>}
        <li>{TIPS[kind](t)}</li>
      </ul>
    </div>
  );
}
NoResultsHelp.propTypes = { kind: PropTypes.oneOf(['aides', 'demarches', 'structures']).isRequired, q: PropTypes.string };
