import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';

const OTHER = {
  aides: [['demarches', 'les démarches'], ['structures', 'les lieux d’accueil']],
  demarches: [['aides', 'les aides'], ['structures', 'les lieux d’accueil']],
  structures: [['aides', 'les aides'], ['demarches', 'les démarches']],
};
const TIPS = {
  aides: 'Écrivez un mot clé (« loyer », « handicap », « APL ») plutôt qu’une phrase.',
  demarches: 'Écrivez un mot clé (« titre de séjour », « retraite », « logement social »).',
  structures: 'Écrivez le type de lieu et la commune (« CCAS Strasbourg ») ou un code postal (« 67000 »).',
};

/**
 * R28: the same help under every « no result » message of the aides, démarches and lieux lists — the same words searched in the two other catalogues
 * and in the global search, and one tip on how to write the search. It used to differ on each page, with a reset button as the only way out.
 */
export default function NoResultsHelp({ kind, q = '' }) {
  const query = String(q || '').trim();
  const enc = encodeURIComponent(query);
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700" data-testid="no-results-help">
      <p className="font-semibold text-slate-900">Essayez aussi</p>
      <ul className="mt-2 space-y-1.5">
        {query && OTHER[kind].map(([path, label]) => (
          <li key={path}><Link to={`/${path}?q=${enc}`} className="font-medium text-blue-700 hover:underline">Chercher « {query} » dans {label}</Link></li>
        ))}
        {query && <li><Link to={`/recherche?q=${enc}`} className="font-medium text-blue-700 hover:underline">Chercher « {query} » partout sur le site</Link></li>}
        <li>{TIPS[kind]}</li>
      </ul>
    </div>
  );
}
NoResultsHelp.propTypes = { kind: PropTypes.oneOf(['aides', 'demarches', 'structures']).isRequired, q: PropTypes.string };
