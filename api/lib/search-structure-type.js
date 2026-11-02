/**
 * R33 — a query that names a KIND of office (« accueil CCAS », « France Services », « maison des solidarités ») asks for that kind of office, not for any
 * place whose description mentions it. Before, « accueil CCAS » returned town halls whose text says « elle oriente vers le CCAS ».
 * structureTypeHint() returns the exact catalogue type (Structure.type_structure, Annuaire de l'administration labels) and the words left once the
 * office name is removed; the search then asks for that type first and falls back to the ordinary word search when the catalogue has none.
 */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");

/** [pattern on the folded query, exact type_structure] — names and acronyms as people write them */
const TYPES = [
  [/(?<!\p{L})(ccas|centre communal d'action sociale)(?!\p{L})/u, "CCAS (centre communal d'action sociale)"],
  [/(?<!\p{L})(france services?|maison france services?)(?!\p{L})/u, 'Espace France Services'],
  [/(?<!\p{L})(maisons? des solidarites|espaces? solidarites|mds)(?!\p{L})/u, 'Maison des solidarités (Espace Solidarités)'],
  [/(?<!\p{L})(cidff|droits des femmes et des familles)(?!\p{L})/u, 'CIDFF (droits des femmes et des familles)'],
  [/(?<!\p{L})(missions? locales?)(?!\p{L})/u, 'Mission locale (jeunes de 16 à 25 ans)'],
  [/(?<!\p{L})(pmi|protection maternelle et infantile)(?!\p{L})/u, 'PMI (protection maternelle et infantile)'],
  [/(?<!\p{L})(mdph|maison departementale des personnes handicapees)(?!\p{L})/u, 'MDPH (maison des personnes handicapées)'],
  [/(?<!\p{L})(points?[ -]justice)(?!\p{L})/u, 'Point-justice (accès au droit)'],
  [/(?<!\p{L})(maisons? de justice et du droit|mjd)(?!\p{L})/u, 'Maison de justice et du droit'],
  [/(?<!\p{L})(bureau d'aide aux victimes|aide aux victimes)(?!\p{L})/u, "Bureau d'aide aux victimes"],
  [/(?<!\p{L})(csapa)(?!\p{L})/u, 'Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)'],
  [/(?<!\p{L})(cada)(?!\p{L})/u, 'Centre d’accueil de demandeurs d’asile (CADA)'],
  [/(?<!\p{L})(adil)(?!\p{L})/u, 'ADIL (information logement)'],
  [/(?<!\p{L})(points? d'accueil numerique)(?!\p{L})/u, 'Point d’accueil numérique'],
  // R34: a need whose public office is fixed by its label — France services is the State's label for help with the administrative procedures of every
  // administration, online included (France Travail, which also lists « démarches en ligne », covers only its own procedures)
  [/(?<!\p{L})((?:aide|aider|accompagnement)? ?(?:aux |pour (?:mes |les )?|a faire (?:mes |les )?|mes )?demarches? (?:en ligne|administratives?|sur internet))(?!\p{L})/u, 'Espace France Services'],
];
/** words that only say « where you are received », not what you need */
const FILLER = /(?<!\p{L})(accueil|adresse|ou|trouver|le|la|les|un|une|du|de|des|d|au|aux|pres|proche|de chez moi)(?!\p{L})/gu;

/** @param {string} query @returns {{ type: string, rest: string } | null} */
export function structureTypeHint(query) {
  const q = fold(query);
  for (const [re, type] of TYPES) {
    const m = q.match(re);
    if (m) return { type, rest: q.replace(re, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim() };
  }
  return null;
}
