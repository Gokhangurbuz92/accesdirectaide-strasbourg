// @ts-check
/**
 * G14-PS — the labels of the social referral codes in the interface language (server rules: api/lib/social-referral-policy.js). One literal t() call per
 * code so scripts/i18n-check.mjs sees every key. Shared by « Mes orientations sociales » and the professional page.
 * @param {import('i18next').TFunction} t
 */
export function socialReferralLabels(t) {
  return {
    reason: {
      HOUSING: t('socialref:reason.HOUSING', 'Logement'), EMPLOYMENT: t('socialref:reason.EMPLOYMENT', 'Emploi'), TRAINING: t('socialref:reason.TRAINING', 'Formation'),
      INCOME_BUDGET: t('socialref:reason.INCOME_BUDGET', 'Ressources et budget'), ENERGY: t('socialref:reason.ENERGY', 'Énergie et factures'),
      ADMIN_PROCEDURES: t('socialref:reason.ADMIN_PROCEDURES', 'Démarches administratives'), ACCESS_TO_RIGHTS: t('socialref:reason.ACCESS_TO_RIGHTS', 'Accès aux droits'),
      MOBILITY: t('socialref:reason.MOBILITY', 'Mobilité'), DIGITAL: t('socialref:reason.DIGITAL', 'Numérique'), FOOD: t('socialref:reason.FOOD', 'Alimentation'),
    },
    status: {
      PENDING_CITIZEN: t('socialref:status.PENDING_CITIZEN', 'Attend l’accord de la personne'), SENT: t('socialref:status.SENT', 'Envoyée, attend la réponse'),
      ACCEPTED: t('socialref:status.ACCEPTED', 'Acceptée'), DECLINED: t('socialref:status.DECLINED', 'Refusée par la structure'), COMPLETED: t('socialref:status.COMPLETED', 'Terminée'),
      CANCELLED: t('socialref:status.CANCELLED', 'Annulée'), WITHDRAWN: t('socialref:status.WITHDRAWN', 'Accord retiré par la personne'), EXPIRED: t('socialref:status.EXPIRED', 'Expirée'),
      CLOSED: t('socialref:status.CLOSED', 'Close'),
    },
    decline: {
      OUT_OF_SCOPE: t('socialref:decline.OUT_OF_SCOPE', 'Ce n’est pas notre domaine'), NO_CAPACITY: t('socialref:decline.NO_CAPACITY', 'Pas de place en ce moment'),
      ALREADY_SUPPORTED: t('socialref:decline.ALREADY_SUPPORTED', 'Déjà accompagné sur ce sujet'), OUT_OF_TERRITORY: t('socialref:decline.OUT_OF_TERRITORY', 'Hors de notre territoire'),
    },
  };
}
/** @param {Record<string, string>} map @param {unknown} code */
export const lbl = (map, code) => map[String(code)] || '';
