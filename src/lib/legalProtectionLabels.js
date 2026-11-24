// @ts-nocheck
// G14-R3G — the labels of « Protection juridique » (citizen page and administrator queue), in the interface language.
import { useT } from '@/i18n';

/** the labels of the measures, states, kinds… (French = canonical; legal terms kept in French in every language) */
export function useLegalProtectionLabels() {
  const { t } = useT('legalprotection');
  return {
    measure: {
      TUTELLE: t('legalprotection:measure.tutelle', 'Tutelle'),
      CURATELLE_SIMPLE: t('legalprotection:measure.curatelle_simple', 'Curatelle simple'),
      CURATELLE_RENFORCEE: t('legalprotection:measure.curatelle_renforcee', 'Curatelle renforcée'),
      CURATELLE_AMENAGEE: t('legalprotection:measure.curatelle_amenagee', 'Curatelle aménagée'),
      HABILITATION_FAMILIALE_GENERALE: t('legalprotection:measure.hf_generale', 'Habilitation familiale générale'),
      HABILITATION_FAMILIALE_SPECIALE: t('legalprotection:measure.hf_speciale', 'Habilitation familiale spéciale (pour certains actes)'),
      SAUVEGARDE_MANDAT_SPECIAL: t('legalprotection:measure.sauvegarde', 'Sauvegarde de justice avec mandat spécial'),
    },
    state: {
      DECLARED: t('legalprotection:state.declared', 'Déclaré, pas encore vérifié : aucun accès'),
      VERIFIED: t('legalprotection:state.verified', 'Vérifié par l’administrateur'),
      SUSPENDED: t('legalprotection:state.suspended', 'Suspendu après votre signalement : aucun accès'),
      REJECTED: t('legalprotection:state.rejected', 'Refusé : la décision n’a pas pu être vérifiée'),
      ENDED: t('legalprotection:state.ended', 'Terminé'),
      EXPIRED: t('legalprotection:state.expired', 'Expiré (date de fin passée) : aucun accès'),
    },
    kind: { FAMILLE: t('legalprotection:kind.famille', 'Un proche (famille)'), MJPM: t('legalprotection:kind.mjpm', 'Un mandataire judiciaire à la protection des majeurs (MJPM)') },
    form: {
      SERVICE: t('legalprotection:form.service', 'Service mandataire'),
      INDIVIDUEL: t('legalprotection:form.individuel', 'Mandataire individuel'),
      PREPOSE: t('legalprotection:form.prepose', 'Préposé d’établissement'),
    },
    mode: {
      ACT: t('legalprotection:power.act', 'Peut agir pour vous ici (annuler un rendez-vous, changer l’état d’une étape). Vous êtes prévenu de tout ce qu’il fait.'),
      CONFIRM: t('legalprotection:power.confirm', 'Peut regarder et vous DEMANDER une action. Rien n’est fait sans votre accord.'),
    },
    area: { RDV: t('legalprotection:area.rdv', 'vos rendez-vous à venir'), PARCOURS: t('legalprotection:area.parcours', 'Mon Parcours (sauf les étapes sensibles)') },
    method: {
      ORIGINAL_SHOWN: t('legalprotection:method.original', 'décision originale présentée'),
      CERTIFIED_COPY_EXAMINED: t('legalprotection:method.copy', 'copie certifiée examinée'),
      COURT_CONFIRMATION: t('legalprotection:method.court', 'confirmation par le greffe du tribunal'),
    },
    event: {
      LEGAL_PROTECTION_DECLARED: t('legalprotection:event.declared', 'déclaration enregistrée'),
      LEGAL_PROTECTION_VERIFIED: t('legalprotection:event.verified', 'décision vérifiée par l’administrateur'),
      LEGAL_PROTECTION_REJECTED: t('legalprotection:event.rejected', 'déclaration refusée'),
      LEGAL_PROTECTION_CONTESTED: t('legalprotection:event.contested', 'signalement de la personne protégée'),
      LEGAL_PROTECTION_REINSTATED: t('legalprotection:event.reinstated', 'lien rétabli après examen du signalement'),
      LEGAL_PROTECTION_ENDED: t('legalprotection:event.ended', 'lien terminé'),
      LEGAL_REP_VIEWED_RDV: t('legalprotection:event.viewed_rdv', 'a regardé les rendez-vous'),
      LEGAL_REP_VIEWED_PARCOURS: t('legalprotection:event.viewed_parcours', 'a regardé Mon Parcours'),
      LEGAL_REP_ACTION_EXECUTED: t('legalprotection:event.executed', 'a fait une action'),
      LEGAL_REP_ACTION_REQUESTED: t('legalprotection:event.requested', 'a demandé une action'),
      LEGAL_REP_ACTION_CONFIRMED: t('legalprotection:event.confirmed', 'action acceptée par la personne'),
      LEGAL_REP_ACTION_REFUSED: t('legalprotection:event.refused', 'action non faite'),
      LEGAL_REP_HELPER_CODE_ISSUED: t('legalprotection:event.code', 'code d’accompagnement demandé'),
    },
  };
}

