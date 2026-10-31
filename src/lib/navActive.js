/**
 * Which main-menu entry the current address belongs to. The menu used to compare the LAST segment of the address with a page name, so a record page
 * (/aides/apl), the list of places (/structures) and every page without its own entry fell back to « Accueil » (R26 audit).
 */
const SECTIONS = {
  Home: ['/'],
  Aides: ['/aides', '/aide', '/categories', '/situations', '/recherche', '/trouver-aide'],
  Demarches: ['/demarches'],
  Annuaire: ['/structures', '/annuaire'],
  Tools: ['/outils'],
  Actualites: ['/actualites'],
};

/** @param {string} pathname @param {string} page a menu entry's page name */
export function navActive(pathname, page) {
  const p = String(pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return (SECTIONS[page] || []).some((x) => (x === '/' ? p === '/' : p === x || p.startsWith(`${x}/`)));
}
