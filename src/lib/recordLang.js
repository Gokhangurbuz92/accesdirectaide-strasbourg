/**
 * R47 — the language of a record's own text (RGAA 8.7 / WCAG 3.1.2, « language of parts »). Titles, summaries, names, descriptions, addresses and the
 * other fields written in French in the database (or sent in French by the API) stay French on a page in another interface language: the element that
 * holds them carries lang="fr" (and dir="ltr", so a French sentence keeps its direction on an Arabic page), so screen readers and the page reader
 * pronounce them with the French voice. Nothing is added on a French page, nor when the text shown IS a checked translation of the field
 * (useContentTranslation decides that; its `attrs(field)` already answers for the translated kinds).
 *
 *   const fr = useFrAttrs();                       <td {...fr}>{structure.nom}</td>
 *   frAttrs(code, { translated: tr.translated })   (a pure function, for code outside a component)
 *   <RecordText>{name}</RecordText>               (src/components/i18n/RecordText.jsx: a <span> when the text has no element of its own)
 */
import { SOURCE_LANGUAGE, useLanguage } from '@/i18n';

/** @typedef {{ lang?: 'fr', dir?: 'ltr' }} FrAttrs */

/** @type {Readonly<FrAttrs>} */
const NONE = Object.freeze({});
/** @type {Readonly<FrAttrs>} */
export const FR_ATTRS = Object.freeze({ lang: 'fr', dir: 'ltr' });

/**
 * the attributes of an element holding French record text on a page in the interface language `code`
 * @param {string | null | undefined} code the interface language
 * @param {{ translated?: boolean }} [opts] `translated`: the element shows a checked translation (then it is in the interface language: no mark)
 * @returns {Readonly<FrAttrs>}
 */
export function frAttrs(code, { translated = false } = {}) {
  if (translated) return NONE;
  const c = String(code || SOURCE_LANGUAGE).toLowerCase();
  if (c === SOURCE_LANGUAGE || c.startsWith(`${SOURCE_LANGUAGE}-`)) return NONE;
  return FR_ATTRS;
}

/** the attributes for French record text in the current interface language (re-renders on a language change) @returns {Readonly<FrAttrs>} */
export function useFrAttrs() {
  const { code } = useLanguage();
  return frAttrs(code);
}
