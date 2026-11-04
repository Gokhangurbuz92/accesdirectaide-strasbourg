/**
 * R44 — the reason a structure gives when it refuses an appointment request (Mode B), on both sides of the journey.
 *
 * The codes are the API's existing contract (api/_services/rdv-requests.js REFUSAL_REASONS: NOT_SUITABLE, NO_CAPACITY, OTHER — fixed codes, never staff free
 * text, journaled with the decision). Choosing one is OPTIONAL for the team: without a choice the API records OTHER, the neutral sentence. This set is a
 * PROPOSAL awaiting the owner's approval (R43 owner decision D-5): it is not a universal refusal policy, and it carries no health, social or personal detail.
 * French is the source; the six-language texts are in src/i18n/locales/<lang>/{booking,pro}.json.
 */

export const REFUSAL_REASON_CODES = Object.freeze(['NOT_SUITABLE', 'NO_CAPACITY', 'OTHER']);

/** a code the API knows, else '' (the API then records OTHER) @param {unknown} value */
export const refusalCode = (value) => (REFUSAL_REASON_CODES.includes(String(value)) ? String(value) : '');

/**
 * The sentence the person reads (« Mes rendez-vous », the booking page) — the same meaning as the API's fixed French sentence.
 * @param {(key: string, fallback: string) => string} t @param {unknown} code
 */
export function refusalReasonText(t, code) {
  switch (refusalCode(code)) {
    case 'NOT_SUITABLE': return t('booking:refusal.not_suitable', 'La structure indique que cette demande ne relève pas de ses services. Vous pouvez chercher une autre structure dans l’annuaire.');
    case 'NO_CAPACITY': return t('booking:refusal.no_capacity', 'La structure ne peut pas recevoir cette demande à ce créneau. Vous pouvez demander un autre créneau.');
    default: return t('booking:refusal.other', 'La structure ne peut pas donner suite à cette demande. Vous pouvez la contacter pour en savoir plus.');
  }
}

/**
 * The choices the team sees (short, neutral labels; the person reads refusalReasonText).
 * @param {(key: string, fallback: string) => string} t
 * @returns {{ code: string, label: string }[]}
 */
export function refusalReasonChoices(t) {
  return [
    { code: '', label: t('pro:appointments.refusal.none', 'Sans motif précis (phrase neutre)') },
    { code: 'NOT_SUITABLE', label: t('pro:appointments.refusal.not_suitable', 'La demande ne relève pas de nos services') },
    { code: 'NO_CAPACITY', label: t('pro:appointments.refusal.no_capacity', 'Pas de disponibilité à ce créneau') },
    { code: 'OTHER', label: t('pro:appointments.refusal.other', 'Autre raison (phrase neutre, sans détail)') },
  ];
}
