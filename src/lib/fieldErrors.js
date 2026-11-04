/**
 * R42-POLISH (R41 review A5, RGAA 11.10 / 11.11) — field-level error semantics shared by the public and back-office forms (not the booking and sign-in
 * forms, which belong to their own streams):
 *   - the field in error carries aria-invalid="true" and aria-describedby → its own message (kept with any description it already had);
 *   - an error summary at the top of the form lists every error as a link to its field, is announced (role="alert") and receives the focus on submit;
 *   - nothing is announced while the person types; a fixed field loses its error at once.
 * The forms use noValidate: the browser's own bubbles are not announced reliably and would stop the submit before this summary is shown.
 */

/** the id of a field's error message @param {string} field */
export const errorIdOf = (field) => `${field}-error`;

/**
 * the attributes of a field: aria-invalid and aria-describedby only when it is in error
 * @param {string} field the field's id
 * @param {Record<string, string>} errors field id → message
 * @param {string} [describedBy] ids the field is already described by
 * @returns {{ 'aria-invalid'?: true, 'aria-describedby'?: string }}
 */
export function fieldA11y(field, errors, describedBy = '') {
  const own = errors[field] ? errorIdOf(field) : '';
  const ids = [describedBy, own].filter(Boolean).join(' ');
  return { ...(errors[field] ? { 'aria-invalid': /** @type {const} */ (true) } : {}), ...(ids ? { 'aria-describedby': ids } : {}) };
}

/** a label without its trailing « * » mark @param {string} label */
export const plainLabel = (label) => String(label || '').replace(/\s*\*\s*$/, '').trim();

/** a pragmatic e-mail shape check (the server decides; this only catches typing slips) @param {string} value */
export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());

/** errors map without one field (the person fixed it) @param {Record<string, string>} errors @param {string} field */
export function withoutError(errors, field) {
  if (!errors[field]) return errors;
  const { [field]: _fixed, ...rest } = errors;
  return rest;
}
