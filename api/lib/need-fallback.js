/**
 * R7 — « J'ai besoin d'aide pour… » (/trouver-aide) without a seeded need taxonomy. NeedCategory / StructureNeed are filled only by scripts/seed-taxonomy.ts and the
 * professional profiles; the records the automatic veille publishes (Annuaire, SIRENE) carry their OWN categories (categories_aidees, e.g. « Logement », « Accès aux
 * droits ») and services. A need with no taxonomy row used to filter nothing (every verified structure was listed as if it matched). Here a need is matched against
 * those declared categories and the keywords of scripts/seed-taxonomy.ts in the structure's services or description; the answer says that it is this approximation.
 * R11 / D05: the categories of the services data·inclusion lists for a place (Structure.services_externes.categories: « Mobilité », « Numérique », « Budget »…) count too.
 */
export const NEED_FALLBACK = Object.freeze({
  acces_droits: { categories: ['Accès aux droits', 'Accès au droit', 'Service public de proximité', 'Organisme social', "Services de l'État"], keywords: ['droits', 'rsa', 'aah', 'apl', 'css', 'administratif', 'démarches', 'papiers'] },
  logement: { categories: ['Logement'], keywords: ['logement', 'hébergement', 'loyer', 'expulsion', 'hlm', 'sans-abri'] },
  emploi: { categories: ['Emploi', 'Emploi et jeunesse', 'Formation', 'Savoirs de base'], keywords: ['emploi', 'travail', 'formation', 'chômage', 'insertion', 'reconversion'] },
  mobilite: { categories: ['Mobilité'], keywords: ['mobilité', 'transport', 'permis', 'déplacement', 'conduire'] },
  famille: { categories: ['Famille', 'Santé et famille'], keywords: ['famille', 'enfant', 'parent', 'séparation', 'naissance', 'parentalité'] },
  handicap: { categories: ['Handicap'], keywords: ['handicap', 'mdph', 'aah', 'pch', 'rqth', 'invalidité'] },
  sante_mentale: { categories: ['Santé mentale', 'Addictions'], keywords: ['santé mentale', 'dépression', 'addiction', 'alcool', 'psychologue'] },
  violences: { categories: [], keywords: ['violence', 'conjugale', 'harcèlement', 'agression', 'protection'] },
  budget: { categories: ['Impôts', 'Budget', 'Alimentation et équipement'], keywords: ['budget', 'dette', 'surendettement', 'impayé', 'crédit'] },
  urgence: { categories: [], keywords: ['urgence', 'sans-abri', 'secours', 'hébergement d’urgence', '115'] },
  isolement: { categories: ['Personnes âgées', 'Lien social et remobilisation'], keywords: ['isolement', 'solitude', 'lien social', 'exclusion'] },
  numerique: { categories: ['Numérique'], keywords: ['numérique', 'internet', 'ordinateur', 'en ligne', 'informatique'] },
});

/** The known needs of a request, with their categories and keywords. @param {string[]} slugs */
export function fallbackNeeds(slugs) {
  return slugs.filter((s) => Object.prototype.hasOwnProperty.call(NEED_FALLBACK, s)).map((s) => ({ slug: s, ...NEED_FALLBACK[/** @type {keyof typeof NEED_FALLBACK} */ (s)] }));
}
