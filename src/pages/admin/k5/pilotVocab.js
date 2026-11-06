/**
 * R47 — the pilot protocol's vocabulary (api/_services/pilot-measures.js sends it in French, by code) in the interface language: each code has its own key
 * whose French default is the server's label, so the French page is unchanged; a code the server adds later keeps the server's label.
 */
/** @param {(key: string, fallback: string) => string} t */
export const pilotLabels = (t) => ({
  journeys: {
    J1_AIDE_LOGEMENT: t('admin:k5.pilot.vocab.journeys.j1_aide_logement', 'Trouver une aide pour payer son loyer et ouvrir sa source officielle'),
    J2_DEMARCHE: t('admin:k5.pilot.vocab.journeys.j2_demarche', 'Trouver comment faire une démarche et ce qu’il faut préparer'),
    J3_LIEU: t('admin:k5.pilot.vocab.journeys.j3_lieu', 'Trouver un lieu d’accueil proche et ses horaires'),
    J4_GUIDE: t('admin:k5.pilot.vocab.journeys.j4_guide', 'Lire un guide et suivre « Et ensuite ? »'),
    J5_ACTUALITE: t('admin:k5.pilot.vocab.journeys.j5_actualite', 'Trouver une actualité récente et sa source'),
    J6_ORIENTATION_PRO: t('admin:k5.pilot.vocab.journeys.j6_orientation_pro', 'Professionnel : préparer une sélection d’orientation (espace de test)'),
  },
  outcomes: {
    REUSSI: t('admin:k5.pilot.vocab.outcomes.reussi', 'Réussi sans aide'),
    REUSSI_AVEC_AIDE: t('admin:k5.pilot.vocab.outcomes.reussi_avec_aide', 'Réussi avec aide'),
    ECHEC: t('admin:k5.pilot.vocab.outcomes.echec', 'Échec'),
    ABANDON: t('admin:k5.pilot.vocab.outcomes.abandon', 'Abandon'),
  },
  assistance: {
    AUCUNE: t('admin:k5.pilot.vocab.assistance.aucune', 'Aucune'),
    INDICE: t('admin:k5.pilot.vocab.assistance.indice', 'Un indice'),
    PAS_A_PAS: t('admin:k5.pilot.vocab.assistance.pas_a_pas', 'Guidage pas à pas'),
  },
  devices: {
    ORDINATEUR: t('admin:k5.pilot.vocab.devices.ordinateur', 'Ordinateur'),
    TELEPHONE: t('admin:k5.pilot.vocab.devices.telephone', 'Téléphone'),
    TABLETTE: t('admin:k5.pilot.vocab.devices.tablette', 'Tablette'),
  },
  assistive: {
    AUCUNE: t('admin:k5.pilot.vocab.assistive.aucune', 'Aucune'),
    LECTEUR_ECRAN: t('admin:k5.pilot.vocab.assistive.lecteur_ecran', 'Lecteur d’écran'),
    LOUPE: t('admin:k5.pilot.vocab.assistive.loupe', 'Loupe / zoom'),
    CLAVIER_SEUL: t('admin:k5.pilot.vocab.assistive.clavier_seul', 'Clavier seul'),
    COMMANDE_VOCALE: t('admin:k5.pilot.vocab.assistive.commande_vocale', 'Commande vocale'),
    AUTRE: t('admin:k5.pilot.vocab.assistive.autre', 'Autre'),
  },
  issues: {
    CONTRASTE: t('admin:k5.pilot.vocab.issues.contraste', 'Contraste ou couleurs'),
    TAILLE_TEXTE: t('admin:k5.pilot.vocab.issues.taille_texte', 'Taille du texte'),
    CLAVIER: t('admin:k5.pilot.vocab.issues.clavier', 'Navigation au clavier'),
    LECTEUR_ECRAN: t('admin:k5.pilot.vocab.issues.lecteur_ecran', 'Lecteur d’écran'),
    VOCABULAIRE: t('admin:k5.pilot.vocab.issues.vocabulaire', 'Mots difficiles'),
    LONGUEUR: t('admin:k5.pilot.vocab.issues.longueur', 'Texte trop long'),
    CIBLE_TACTILE: t('admin:k5.pilot.vocab.issues.cible_tactile', 'Bouton difficile à toucher'),
    ORIENTATION: t('admin:k5.pilot.vocab.issues.orientation', 'Se perdre dans les pages'),
    AUTRE: t('admin:k5.pilot.vocab.issues.autre', 'Autre'),
  },
  environments: {
    PRODUCTION: t('admin:k5.pilot.vocab.environments.production', 'Site public'),
    LAB: t('admin:k5.pilot.vocab.environments.lab', 'Espace de test'),
  },
  kinds: {
    aide: t('admin:k5.pilot.vocab.kinds.aide', 'Aides'),
    demarche: t('admin:k5.pilot.vocab.kinds.demarche', 'Démarches'),
    structure: t('admin:k5.pilot.vocab.kinds.structure', 'Lieux d’accueil'),
    dispositif: t('admin:k5.pilot.vocab.kinds.dispositif', 'Dispositifs'),
  },
});

/** the server's vocabulary with each label in the interface language @param {Record<string, Record<string, string>>} vocab @param {(key: string, fallback: string) => string} t */
export function translatedVocab(vocab, t) {
  const L = /** @type {Record<string, Record<string, string>>} */ (pilotLabels(t));
  return Object.fromEntries(Object.entries(vocab || {}).map(([group, map]) => [group, Object.fromEntries(Object.entries(map || {}).map(([code, label]) => [code, L[group]?.[code] || label]))]));
}

/** a catalogue line's kind, an aggregated journey's reason @param {(key: string, fallback: string, o?: any) => string} t */
export const pilotKind = (t, /** @type {string} */ kind, /** @type {string} */ label) => /** @type {Record<string, Record<string, string>>} */ (pilotLabels(t)).kinds[kind] || label;
export const pilotReason = (/** @type {(key: string, fallback: string, o?: any) => string} */ t, /** @type {number} */ sessions, /** @type {number} */ k, /** @type {string} */ reason) => (sessions ? t('admin:k5.pilot.reason_few', 'moins de {{k}} séances : résultats non publiés', { k }) : sessions === 0 ? t('admin:k5.pilot.reason_none', 'aucune séance') : reason);
