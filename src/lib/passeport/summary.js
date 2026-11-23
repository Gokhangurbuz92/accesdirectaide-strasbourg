// @ts-check
/**
 * G14-PS — the structured situation summary of the Passeport Social: CLOSED lists only (codes; the page shows them in the interface language), plus ONE
 * optional free note that stays on the device (a visible warning asks not to write health information if the person shares). No code names health,
 * disability, addiction, sexual life, an offence, a residence status, violence, child protection or a legal protection measure (same exclusions as the
 * limited Mon Parcours): e.g. AAH / PCH are deliberately not in the resources list.
 */
export const SUMMARY_FIELDS = Object.freeze({
  household: { multi: false, options: ['alone', 'couple', 'single_parent', 'couple_children', 'hosted_by_family', 'other'] },
  children: { multi: false, options: ['0', '1', '2', '3', '4_plus'] },
  housing: { multi: false, options: ['tenant_private', 'tenant_social', 'owner', 'hosted', 'other'] },
  work: { multi: false, options: ['employed', 'job_seeker', 'training', 'student', 'retired', 'no_activity'] },
  resources: { multi: true, options: ['salary', 'unemployment_benefit', 'rsa', 'activity_bonus', 'housing_benefit', 'family_benefit', 'pension', 'scholarship', 'none'] },
  ongoing: { multi: true, options: ['caf', 'france_travail', 'social_housing_request', 'energy_help', 'tax', 'identity_documents', 'school', 'pension_request', 'bank_account'] },
  languages: { multi: true, options: ['fr', 'en', 'ar', 'tr', 'de', 'uk', 'other'] },
  contact: { multi: false, options: ['phone', 'sms', 'email', 'in_person'] },
});
export const NOTE_MAX = 1000;

/** keeps only known codes (anything else is dropped) @param {Record<string, unknown>} input @returns {Record<string, any>} */
export function cleanSummary(input) {
  /** @type {Record<string, any>} */ const out = {};
  for (const [k, def] of Object.entries(SUMMARY_FIELDS)) {
    const v = input?.[k];
    if (def.multi) out[k] = Array.isArray(v) ? [...new Set(v.filter((x) => def.options.includes(String(x))))] : [];
    else out[k] = typeof v === 'string' && def.options.includes(v) ? v : '';
  }
  out.note = typeof input?.note === 'string' ? input.note.slice(0, NOTE_MAX) : '';
  return out;
}
