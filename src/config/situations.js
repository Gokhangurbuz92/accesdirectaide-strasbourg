/** R18: the home situations, each opening the search on its own words (aides, démarches and lieux d'accueil). [label, search words] */
export const SITUATIONS = [['Étudiant', 'étudiant'], ['Travail', 'emploi'], ['Handicap', 'handicap'], ['Famille', 'famille'], ['Senior', 'personnes âgées'],
  ['Étranger', 'étranger'], ['Logement', 'logement'], ['Santé', 'santé']];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * R26: the search address for an old /situations/<slug> link (the situation filter has no data, so these links opened an empty list).
 * @param {string} slug @returns {string}
 */
export function situationSearchPath(slug) {
  const s = fold(slug);
  const hit = SITUATIONS.find(([label, words]) => fold(label) === s || fold(words) === s);
  return `/recherche?q=${encodeURIComponent(hit ? hit[1] : String(slug || '').replace(/-/g, ' '))}`;
}
