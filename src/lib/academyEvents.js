/**
 * X04 (expansion) — the shared vocabulary of the academy and event screens: the accessibility features of an event, the accessibility needs a participant
 * may state (closed lists, the same as api/_services/academy-events.js and the CHECK of drizzle/0053), and the text of an item in the interface language
 * (a checked human translation when the editor gave one, otherwise the French text, marked lang="fr" by the caller).
 */

export const ACCESSIBILITY_FEATURES = Object.freeze(['STEP_FREE_ACCESS', 'ACCESSIBLE_TOILETS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP',
  'FALC_MATERIALS', 'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ASSISTANCE_ANIMALS_WELCOME']);
export const ACCESSIBILITY_NEEDS = Object.freeze(['STEP_FREE_ACCESS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP', 'FALC_MATERIALS',
  'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ACCOMPANYING_PERSON']);

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** the label of an accessibility feature or need @param {string} code @param {T} t */
export function accessibilityLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    STEP_FREE_ACCESS: t('events:a11y.step_free', 'Accès de plain-pied ou adapté aux fauteuils roulants'),
    ACCESSIBLE_TOILETS: t('events:a11y.toilets', 'Toilettes accessibles'),
    LSF_INTERPRETATION: t('events:a11y.lsf', 'Interprétation en langue des signes française (LSF)'),
    LIVE_CAPTIONS: t('events:a11y.captions', 'Sous-titrage en direct'),
    HEARING_LOOP: t('events:a11y.loop', 'Boucle magnétique'),
    FALC_MATERIALS: t('events:a11y.falc', 'Documents en FALC (facile à lire et à comprendre)'),
    LARGE_PRINT_MATERIALS: t('events:a11y.large_print', 'Documents en gros caractères'),
    QUIET_SPACE: t('events:a11y.quiet', 'Espace calme'),
    ASSISTANCE_ANIMALS_WELCOME: t('events:a11y.animals', 'Chiens guides et d’assistance bienvenus'),
    ACCOMPANYING_PERSON: t('events:a11y.companion', 'Venir avec une personne accompagnante'),
  };
  return labels[code] || code;
}

/**
 * the text of an item in the interface language: { title, summary, body, translated } — a field the editor did not translate stays French
 * @param {{ title?: string, summary?: string, body?: string, translations?: Record<string, { title?: string, summary?: string, body?: string }> }} item
 * @param {string} code the interface language
 */
export function itemText(item, code) {
  const tr = code && code !== 'fr' ? item?.translations?.[code] : null;
  const pick = (/** @type {'title' | 'summary' | 'body'} */ f) => (tr && tr[f] ? { text: tr[f], translated: true } : { text: item?.[f] || '', translated: false });
  return { title: pick('title'), summary: pick('summary'), body: pick('body') };
}
