/**
 * R18 (R31) — the closed list of needs a professional organizes an orientation around, shared by the ADA Pro screen and the server
 * (api/_services/orientation-basket.js). `terms` are matched, accents and case ignored, against the categories the catalogue records already carry
 * (Aide.categorie, Demarche.categorie, Structure.categories_aidees): a match explains « why this item », it never decides a right.
 */
export const ORIENTATION_NEEDS = Object.freeze([
  { code: 'LOGEMENT', label: 'Logement, hébergement', terms: ['logement', 'hebergement', 'loyer'] },
  { code: 'SANTE', label: 'Santé, soins', terms: ['sante', 'social-sante', 'soins'] },
  { code: 'HANDICAP', label: 'Handicap', terms: ['handicap'] },
  { code: 'AUTONOMIE', label: 'Personnes âgées, autonomie', terms: ['personnes agees', 'personnes-agees', 'autonomie'] },
  { code: 'EMPLOI', label: 'Emploi, insertion', terms: ['emploi', 'insertion', 'chomage', 'remobilisation'] },
  { code: 'FAMILLE', label: 'Famille, enfants', terms: ['famille', 'enfant', 'parent'] },
  { code: 'BUDGET', label: 'Budget, alimentation, dettes', terms: ['budget', 'credit', 'surendettement', 'alimentation'] },
  { code: 'DROITS', label: 'Accès aux droits, démarches', terms: ['acces aux droits', 'acces au droit', 'action sociale', 'service public de proximite', 'social', 'justice'] },
  { code: 'MOBILITE', label: 'Mobilité, transport', terms: ['mobilite', 'transport'] },
  { code: 'SEJOUR', label: 'Droit au séjour, personnes étrangères', terms: ['etranger', 'sejour'] },
  { code: 'LIEN_SOCIAL', label: 'Lien social, culture, loisirs', terms: ['lien social', 'culture', 'loisirs'] },
]);

export const FOLLOW_UPS = Object.freeze({ A_PROPOSER: 'À proposer', PROPOSE: 'Proposé à la personne', FAIT: 'Démarche faite', SANS_SUITE: 'Sans suite' });
export const ITEM_KINDS = Object.freeze({ aide: 'Aide', demarche: 'Démarche', structure: 'Lieu d’accueil' });

/** @param {string} s */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** the need codes a record's categories match @param {string[]} categories */
export function needsOfCategories(categories) {
  const cats = categories.map(fold).filter(Boolean);
  return ORIENTATION_NEEDS.filter((n) => cats.some((c) => n.terms.some((t) => c === t || c.includes(t)))).map((n) => n.code);
}

/** @param {string} code */
export const needLabel = (code) => ORIENTATION_NEEDS.find((n) => n.code === code)?.label || code;
