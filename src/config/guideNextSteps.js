/**
 * R29 — « Et ensuite ? » after an official guide: where to act on it, on this site. Every link opens a list that has verified records in production
 * (checked 31/10/2026: 58 Espaces France Services, 21 points-justice, the ADIL, the Banque de France, the CPAM, the CCAS of Strasbourg, the FSL).
 */
const FRANCE_SERVICES = { to: '/structures?q=France%20Services', label: 'Un Espace France Services près de chez vous', text: 'Des agents vous aident gratuitement pour vos démarches administratives.' };
const DEMARCHES = { to: '/demarches', label: 'Les démarches pas à pas', text: 'Les étapes et les documents pour faire une demande.' };
const OUTILS = { to: '/outils', label: 'Les services en ligne officiels', text: 'Simulateurs et formulaires des organismes publics.' };

export const GUIDE_NEXT_STEPS = {
  papiers: [FRANCE_SERVICES, DEMARCHES, OUTILS],
  logement: [
    { to: '/aides?theme=logement', label: 'Les aides au logement', text: 'Les aides vérifiées pour payer votre loyer ou vous loger.' },
    { to: '/dispositifs', label: 'Le Fonds de solidarité pour le logement', text: 'L’aide du Bas-Rhin pour les impayés de loyer et d’énergie.' },
    { to: '/structures?q=ADIL', label: 'Un conseil gratuit sur le logement', text: 'L’Agence départementale d’information sur le logement (ADIL).' },
  ],
  budget: [
    { to: '/structures?q=Banque%20de%20France', label: 'La Banque de France du Bas-Rhin', text: 'Pour déposer un dossier de surendettement ou exercer le droit au compte.' },
    { to: '/structures?q=CCAS%20Strasbourg', label: 'Le CCAS de Strasbourg', text: 'Une aide sociale et un accompagnement budgétaire.' },
    { to: '/aides', label: 'Les aides auxquelles vous pourriez avoir droit', text: 'Les aides nationales et locales, avec leurs conditions.' },
  ],
  'démarches': [DEMARCHES, FRANCE_SERVICES, OUTILS],
  recours: [
    { to: '/structures?q=point%20justice', label: 'Un point-justice près de chez vous', text: 'Une information juridique gratuite et confidentielle.' },
    FRANCE_SERVICES,
    DEMARCHES,
  ],
};
const HEALTH = { to: '/structures?q=CPAM', label: 'Votre caisse d’assurance maladie (CPAM)', text: 'Pour contester une décision de l’Assurance maladie.' };

/** the next steps of a guide: by its category, plus the health insurance fund when the guide is about health @param {{ categorie?: string, contexte?: string[] }} guide */
export function guideNextSteps(guide) {
  const base = GUIDE_NEXT_STEPS[guide?.categorie] || [DEMARCHES, FRANCE_SERVICES];
  return (guide?.contexte || []).includes('santé') ? [HEALTH, ...base].slice(0, 3) : base;
}
