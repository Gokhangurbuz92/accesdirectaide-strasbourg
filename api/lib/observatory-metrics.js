/**
 * FA-D9 — what each observatory figure IS, rigorously, and what is NOT computed (reference 09: « clearly define denominator/metric … never label browsing
 * as citoyens aidés »). One registry, read by the services that publish (territorial-stats.js, org-stats.js), by the methodology text and by the tests.
 *
 * Status of a metric:
 *   PUBLISHED              — computed from recorded platform facts and published under the disclosure rules (docs/security/observatory-disclosure-control.md);
 *   DEFINED_NOT_PUBLISHED  — a recorded fact exists and the definition is fixed here, but nothing publishes it: publishing a new measure adds cells to the
 *                            suppressed grid and needs a disclosure review and the owner's decision first (publication stays DEFERRED);
 *   NOT_COMPUTED           — no recorded fact establishes it, or the fact lives in a person's own space that statistics never read. It is not
 *                            estimated, not approximated by another figure, and no screen may show a number for it.
 * Unit: EVENT (a referral, an appointment) or ACCOUNT (a citizen account). No published figure counts PEOPLE: one person may hold several referrals,
 * appointments or accounts, and a person without an account (guest booking) is not an account.
 */

/** @typedef {'PUBLISHED' | 'DEFINED_NOT_PUBLISHED' | 'NOT_COMPUTED'} MetricStatus */
/** @typedef {{ id: string, status: MetricStatus, unit: 'EVENT' | 'ACCOUNT' | null, label: string, definition: string, source: string | null, isNot: string, publishedAs?: string[] }} Metric */

/** @type {ReadonlyArray<Metric>} */
export const METRICS = Object.freeze([
  {
    id: 'need_expressed', status: 'NOT_COMPUTED', unit: null, label: 'Besoin exprimé',
    definition: 'Une personne a dit, dans la plateforme, avoir besoin de quelque chose.',
    source: null,
    isNot: 'Une recherche, une page vue ou une réponse à un questionnaire n’est pas un besoin exprimé. Ce que la personne écrit reste dans son espace (Mon Parcours, dossier partagé, assistant) : les statistiques ne le lisent jamais.',
  },
  {
    id: 'aid_found', status: 'NOT_COMPUTED', unit: null, label: 'Aide trouvée',
    definition: 'Une aide qui correspond à la situation de la personne a été identifiée.',
    source: null,
    isNot: 'Consulter ou enregistrer une fiche ne dit pas que l’aide s’applique à la personne ; la plateforme ne décide pas de l’éligibilité.',
  },
  {
    id: 'action_started', status: 'NOT_COMPUTED', unit: null, label: 'Démarche engagée',
    definition: 'La personne a commencé une démarche (étape de Mon Parcours marquée commencée, par elle-même).',
    source: 'ParcoursItem / ParcoursEvent (espace personnel, jamais lu par les statistiques)',
    isNot: 'Une déclaration de la personne dans son propre espace, sans vérification ; elle n’est pas agrégée.',
  },
  {
    id: 'referral_sent', status: 'PUBLISHED', unit: 'EVENT', label: 'Orientation envoyée', publishedAs: ['sent'],
    definition: 'Orientation d’une structure vers une autre, autorisée par la personne et transmise (date d’envoi dans le trimestre), comptée dans la commune de la structure destinataire.',
    source: 'Referral.sentAt',
    isNot: 'Ce n’est pas un nombre de personnes : une personne peut avoir plusieurs orientations, et une orientation suivie d’une autre compte deux fois.',
  },
  {
    id: 'referral_accepted', status: 'DEFINED_NOT_PUBLISHED', unit: 'EVENT', label: 'Orientation acceptée par la structure destinataire',
    definition: 'Orientation que la structure destinataire a acceptée (passage enregistré à « acceptée »).',
    source: 'ReferralEvent.toStatus = ACCEPTED',
    isNot: 'Accepter n’est pas accompagner ni rendre le service. Non publié : une nouvelle mesure demande une revue de divulgation et la décision du propriétaire.',
  },
  {
    id: 'referral_declined_no_capacity', status: 'PUBLISHED', unit: 'EVENT', label: 'Orientation refusée faute de capacité', publishedAs: ['unmet'],
    definition: 'Orientation à laquelle la structure destinataire a répondu « pas de capacité ».',
    source: 'Referral.responseCode = NO_CAPACITY',
    isNot: 'Ce n’est pas un besoin non couvert : la personne a pu être orientée ensuite ailleurs et accompagnée, et un besoin qui n’a donné lieu à aucune orientation n’est pas compté.',
  },
  {
    id: 'referral_declined_out_of_scope', status: 'PUBLISHED', unit: 'EVENT', label: 'Orientation hors périmètre', publishedAs: ['outOfScope'],
    definition: 'Orientation à laquelle la structure destinataire a répondu « hors de notre champ » : une orientation mal adressée.',
    source: 'Referral.responseCode = OUT_OF_SCOPE',
    isNot: 'Ce n’est pas un besoin non couvert.',
  },
  {
    id: 'referral_expired', status: 'DEFINED_NOT_PUBLISHED', unit: 'EVENT', label: 'Orientation restée sans réponse dans le délai',
    definition: 'Orientation close automatiquement faute de réponse dans le délai prévu.',
    source: 'ReferralEvent.toStatus = EXPIRED',
    isNot: 'Ce n’est ni un refus ni un non-recours. Non publié.',
  },
  {
    id: 'appointment_not_cancelled', status: 'PUBLISHED', unit: 'EVENT', label: 'Rendez-vous non annulé', publishedAs: ['appointments', 'rdv'],
    definition: 'Rendez-vous pris auprès d’une structure, dont l’heure tombe dans le trimestre et qui n’a pas été annulé (créneaux leurres exclus).',
    source: 'ProAppointment.startAt, status <> cancelled',
    isNot: 'Un rendez-vous pris n’est ni honoré ni une aide obtenue : il compte aussi les rendez-vous dont la présence n’a jamais été enregistrée.',
  },
  {
    id: 'citizen_accounts_with_appointment', status: 'PUBLISHED', unit: 'ACCOUNT', label: 'Comptes citoyens avec un rendez-vous', publishedAs: ['people', 'peopleWithAppointment'],
    definition: 'Comptes citoyens distincts ayant, dans le trimestre, un rendez-vous réservé, confirmé ou honoré auprès des structures d’une commune.',
    source: 'ProAppointment.citizenUserId (distinct par commune)',
    isNot: 'Ce n’est pas un nombre de personnes aidées : une réservation sans compte n’y figure pas, et la somme des communes compte un même compte une fois par commune.',
  },
  {
    id: 'appointment_honoured', status: 'DEFINED_NOT_PUBLISHED', unit: 'EVENT', label: 'Rendez-vous honoré (déclaré par la structure)',
    definition: 'Rendez-vous que la structure a marqué « honoré ».',
    source: 'ProAppointment.status = done',
    isNot: 'Une présence déclarée par la structure, pas un service rendu ni un droit obtenu. Non publié.',
  },
  {
    id: 'support_closed_declared', status: 'DEFINED_NOT_PUBLISHED', unit: 'EVENT', label: 'Accompagnement déclaré terminé par la structure destinataire',
    definition: 'Orientation que la structure destinataire a close avec un résultat qu’elle déclare (accompagnement terminé, dossier déposé, information donnée…).',
    source: 'Referral.status = COMPLETED, Referral.outcome',
    isNot: 'La déclaration d’une structure, non vérifiée par la personne ni par l’organisme payeur. Non publié.',
  },
  {
    id: 'service_rendered', status: 'NOT_COMPUTED', unit: null, label: 'Service effectivement rendu / droit obtenu',
    definition: 'La personne a effectivement reçu le service ou la prestation.',
    source: null,
    isNot: 'Aucun fait enregistré dans la plateforme ne l’établit : le résultat de clôture est une déclaration de la structure, et l’attribution d’un droit par l’organisme payeur n’est pas reçue par la plateforme. Rien n’est calculé.',
  },
  {
    id: 'non_take_up', status: 'NOT_COMPUTED', unit: null, label: 'Non-recours',
    definition: 'Une personne qui pourrait prétendre à un droit ou à un service ne le reçoit pas.',
    source: null,
    isNot: 'Le mesurer demande deux faits que la plateforme n’a pas : l’éligibilité établie (la plateforme ne la décide jamais) et la non-perception (aucune donnée des organismes payeurs). Les orientations refusées, hors périmètre ou sans réponse signalent des frictions du parcours d’orientation, pas un taux de non-recours.',
  },
  {
    id: 'page_view', status: 'NOT_COMPUTED', unit: null, label: 'Visites, recherches',
    definition: 'Pages vues ou recherches effectuées sur le site.',
    source: null,
    isNot: 'L’audience n’est pas mesurée pendant la bêta ; une visite ou une recherche ne sera jamais présentée comme une personne aidée.',
  },
]);

const byId = new Map(METRICS.map((m) => [m.id, m]));
/** @param {string} id */
export const metric = (id) => byId.get(id) || null;

/** The published response key → metric id (every key a statistic response publishes must be here). */
export const PUBLISHED_KEYS = Object.freeze(Object.fromEntries(METRICS.filter((m) => m.status === 'PUBLISHED').flatMap((m) => (m.publishedAs || []).map((k) => [k, m.id]))));

/** What a response says about its own keys: { key: { metric, label, unit } } — documentation, never data. @param {string[]} keys */
export function metricsOf(keys) {
  return Object.fromEntries(keys.map((k) => {
    const m = byId.get(PUBLISHED_KEYS[k]);
    if (!m) throw new Error(`observatory: no published metric for key ${k}`);
    return [k, { metric: m.id, label: m.label, unit: m.unit }];
  }));
}

/** The methodology sentence on what is not measured (non-recours, service rendered, audience) — French master text. */
export const NOT_MEASURED_TEXT = 'Ces chiffres ne mesurent ni le non-recours, ni les services effectivement rendus, ni les personnes aidées : ce sont des orientations et des rendez-vous enregistrés. Le non-recours demanderait de savoir qui pourrait prétendre à un droit et ne le reçoit pas — la plateforme ne décide pas de l’éligibilité et ne reçoit aucune donnée des organismes payeurs. Les besoins exprimés, les aides consultées et les démarches suivies par les personnes restent dans leur espace personnel et ne sont pas comptés.';
