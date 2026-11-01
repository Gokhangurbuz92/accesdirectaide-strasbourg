/**
 * Boîte à outils (P11): official public online services and simulators, listed while no tool of AccesDirectAide's own is published.
 * Each entry points to the service's own official site and says what it is for, nothing more: AccesDirectAide does not run these tools and does not
 * vouch for a result. Each address was opened on `checkedAt` and answered normally (HTTP 200, the service's own page title); the list is checked
 * by tests/unit/r26-public-experience.test.jsx (https, official domains only).
 *
 * R32: the French text is written once, as the default of an explicit translation call (scripts/i18n-check.mjs reads those calls). OFFICIAL_TOOLS
 * holds the French entries (the identity stands in for the translation function); `toolText(tool, t)` gives the name, purpose and topic of a tool
 * in the interface language. The names of the official services stay as they are (Caf, ANTS, 1jeune1solution…).
 */
export const OFFICIAL_TOOLS_CHECKED_AT = '2026-10-31';

/** @typedef {(key: string, french: string) => string} ToolT */
/** @typedef {{ id: string, titre: string, url: string, categorie: string, description: string }} OfficialTool */

/** @param {ToolT} t @returns {OfficialTool[]} */
const toolList = (t) => [
  { id: 'mes-droits-sociaux', titre: t('shared:tool.mes-droits-sociaux.title', 'Simulateur Mes Droits Sociaux'), url: 'https://www.mesdroitssociaux.gouv.fr/accueil/simulateur', categorie: t('shared:tool.category.droits', 'droits'),
    description: t('shared:tool.mes-droits-sociaux.text', 'Estimer en ligne les aides sociales auxquelles vous pourriez avoir droit.') },
  { id: 'caf-demarches', titre: t('shared:tool.caf-demarches.title', 'Démarches et simulations de la Caf'), url: 'https://www.caf.fr/allocataires/aides-et-demarches/mes-demarches', categorie: t('shared:tool.category.droits', 'droits'),
    description: t('shared:tool.caf-demarches.text', 'Faire une simulation ou une démarche auprès de la Caf (logement, prime d’activité, famille…).') },
  { id: '1jeune1solution', titre: t('shared:tool.1jeune1solution.title', 'Mes aides financières (1jeune1solution)'), url: 'https://www.1jeune1solution.gouv.fr/mes-aides', categorie: t('shared:tool.category.jeunes', 'jeunes'),
    description: t('shared:tool.1jeune1solution.text', 'Pour les jeunes : trouver les aides financières qui correspondent à votre situation.') },
  { id: 'logement-social', titre: t('shared:tool.logement-social.title', 'Demande de logement social en ligne'), url: 'https://www.demande-logement-social.gouv.fr/', categorie: t('shared:tool.category.logement', 'logement'),
    description: t('shared:tool.logement-social.text', 'Déposer, compléter ou renouveler une demande de logement social.') },
  { id: 'mes-aides-reno', titre: t('shared:tool.mes-aides-reno.title', 'Mes aides réno'), url: 'https://mesaides.france-renov.gouv.fr/', categorie: t('shared:tool.category.logement', 'logement'),
    description: t('shared:tool.mes-aides-reno.text', 'Simulateur officiel des aides pour rénover un logement (chauffage, isolation…).') },
  { id: 'c2s', titre: t('shared:tool.c2s.title', 'Complémentaire santé solidaire (ameli)'), url: 'https://www.ameli.fr/assure/droits-demarches/difficultes-acces-droits-soins/complementaire-sante/complementaire-sante-solidaire', categorie: t('shared:tool.category.sante', 'santé'),
    description: t('shared:tool.c2s.text', 'Comprendre la Complémentaire santé solidaire et la demander auprès de l’Assurance maladie.') },
  { id: 'info-retraite', titre: t('shared:tool.info-retraite.title', 'Info Retraite'), url: 'https://www.info-retraite.fr/portail-info/home.html', categorie: t('shared:tool.category.retraite', 'retraite'),
    description: t('shared:tool.info-retraite.text', 'Consulter votre relevé de carrière et estimer le montant de votre retraite.') },
  { id: 'aide-juridictionnelle', titre: t('shared:tool.aide-juridictionnelle.title', 'Aide juridictionnelle en ligne'), url: 'https://www.aidejuridictionnelle.justice.fr/', categorie: t('shared:tool.category.justice', 'justice'),
    description: t('shared:tool.aide-juridictionnelle.text', 'Demander une aide pour payer les frais d’avocat ou de justice.') },
  { id: 'ants', titre: t('shared:tool.ants.title', 'ANTS — titres d’identité et permis'), url: 'https://ants.gouv.fr/', categorie: t('shared:tool.category.papiers', 'papiers'),
    description: t('shared:tool.ants.text', 'Démarches en ligne pour la carte d’identité, le passeport, le permis de conduire et la carte grise.') },
  { id: 'annuaire-administration', titre: t('shared:tool.annuaire-administration.title', 'Annuaire de l’administration'), url: 'https://lannuaire.service-public.gouv.fr/', categorie: t('shared:tool.category.orientation', 'orientation'),
    description: t('shared:tool.annuaire-administration.text', 'Trouver l’adresse, le téléphone et les horaires d’un service public.') },
];

/** the French entries (source text) @type {OfficialTool[]} */
export const OFFICIAL_TOOLS = toolList((_key, french) => french);

/**
 * The name (`titre`), purpose (`description`) and topic (`categorie`, a display label) of an official tool in the interface language.
 * `t` is the caller's translation function — `const { t } = useT('shared')` — and `tool` an entry of OFFICIAL_TOOLS; an unknown entry is returned as it is.
 * @param {{ id: string, titre?: string, description?: string, categorie?: string }} tool @param {ToolT} t
 * @returns {{ titre: string, description: string, categorie: string }}
 */
export function toolText(tool, t) {
  const found = toolList(t).find((x) => x.id === tool?.id);
  return {
    titre: found?.titre ?? tool?.titre ?? '',
    description: found?.description ?? tool?.description ?? '',
    categorie: found?.categorie ?? tool?.categorie ?? '',
  };
}
