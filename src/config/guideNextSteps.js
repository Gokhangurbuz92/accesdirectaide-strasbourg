/**
 * R29 — « Et ensuite ? » after an official guide: where to act on it, on this site. Every link opens a list that has verified records in production
 * (checked 31/10/2026: 58 Espaces France Services, 21 points-justice, the ADIL, the Banque de France, the CPAM, the CCAS of Strasbourg, the FSL).
 *
 * R32: the labels stay in French here — they are the defaults of their interface keys. The page passes its `t` to `guideNextSteps(guide, t)` to get
 * them in the interface language; without it (tests, scripts) every step is the French one, as in `GUIDE_NEXT_STEPS`.
 */
const french = (/** @type {string} */ _key, /** @type {string} */ text) => text;

/** @param {(key: string, french: string) => string} t */
function nextSteps(t) {
  const FRANCE_SERVICES = { to: '/structures?q=France%20Services', label: t('guides:next.france_services.label', 'Un Espace France Services près de chez vous'), text: t('guides:next.france_services.text', 'Des agents vous aident gratuitement pour vos démarches administratives.') };
  const DEMARCHES = { to: '/demarches', label: t('guides:next.demarches.label', 'Les démarches pas à pas'), text: t('guides:next.demarches.text', 'Les étapes et les documents pour faire une demande.') };
  const OUTILS = { to: '/outils', label: t('guides:next.outils.label', 'Les services en ligne officiels'), text: t('guides:next.outils.text', 'Simulateurs et formulaires des organismes publics.') };
  return {
    byCategory: {
      papiers: [FRANCE_SERVICES, DEMARCHES, OUTILS],
      logement: [
        { to: '/aides?theme=logement', label: t('guides:next.logement.label', 'Les aides au logement'), text: t('guides:next.logement.text', 'Les aides vérifiées pour payer votre loyer ou vous loger.') },
        { to: '/dispositifs', label: t('guides:next.fsl.label', 'Le Fonds de solidarité pour le logement'), text: t('guides:next.fsl.text', 'L’aide du Bas-Rhin pour les impayés de loyer et d’énergie.') },
        { to: '/structures?q=ADIL', label: t('guides:next.adil.label', 'Un conseil gratuit sur le logement'), text: t('guides:next.adil.text', 'L’Agence départementale d’information sur le logement (ADIL).') },
      ],
      budget: [
        { to: '/structures?q=Banque%20de%20France', label: t('guides:next.banque_de_france.label', 'La Banque de France du Bas-Rhin'), text: t('guides:next.banque_de_france.text', 'Pour déposer un dossier de surendettement ou exercer le droit au compte.') },
        { to: '/structures?q=CCAS%20Strasbourg', label: t('guides:next.ccas.label', 'Le CCAS de Strasbourg'), text: t('guides:next.ccas.text', 'Une aide sociale et un accompagnement budgétaire.') },
        { to: '/aides', label: t('guides:next.aides.label', 'Les aides auxquelles vous pourriez avoir droit'), text: t('guides:next.aides.text', 'Les aides nationales et locales, avec leurs conditions.') },
      ],
      'démarches': [DEMARCHES, FRANCE_SERVICES, OUTILS],
      recours: [
        { to: '/structures?q=point%20justice', label: t('guides:next.point_justice.label', 'Un point-justice près de chez vous'), text: t('guides:next.point_justice.text', 'Une information juridique gratuite et confidentielle.') },
        FRANCE_SERVICES,
        DEMARCHES,
      ],
    },
    fallback: [DEMARCHES, FRANCE_SERVICES],
    health: { to: '/structures?q=CPAM', label: t('guides:next.cpam.label', 'Votre caisse d’assurance maladie (CPAM)'), text: t('guides:next.cpam.text', 'Pour contester une décision de l’Assurance maladie.') },
  };
}

const FRENCH = nextSteps(french);
export const GUIDE_NEXT_STEPS = FRENCH.byCategory;

/**
 * the next steps of a guide: by its category, plus the health insurance fund when the guide is about health
 * @param {{ categorie?: string, contexte?: string[] }} guide @param {(key: string, french: string) => string} [t] the page's translation function
 */
export function guideNextSteps(guide, t = french) {
  const all = t === french ? FRENCH : nextSteps(t);
  const base = all.byCategory[guide?.categorie] || all.fallback;
  return (guide?.contexte || []).includes('santé') ? [all.health, ...base].slice(0, 3) : base;
}
