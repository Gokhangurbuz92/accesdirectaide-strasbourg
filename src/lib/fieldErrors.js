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
  const rest = { ...errors };
  delete rest[field];
  return rest;
}

/** an address the server accepts as a link: https only (the catalogue refuses anything else) @param {string} value */
export const looksLikeHttpsUrl = (value) => {
  try { const u = new URL(String(value || '').trim()); return u.protocol === 'https:' && Boolean(u.hostname); } catch { return false; }
};

/**
 * R43 — the messages of the field errors, in the interface language (`t` of any namespace: the keys are in `common`). Each message names its field, so the
 * summary reads on its own.
 * @typedef {(key: string, fallback: string, options?: Record<string, unknown>) => string} TFn
 */
/** @param {TFn} t @param {string} label */
export const requiredMessage = (t, label) => t('common:form.errors.required', '{{label}} : ce champ est obligatoire.', { label: plainLabel(label) });
/** @param {TFn} t @param {string} label @param {number} min */
export const minLengthMessage = (t, label, min) => t('common:form.errors.min_length', '{{label}} : saisissez au moins {{min}} caractères.', { label: plainLabel(label), min });
/** @param {TFn} t @param {string} label */
export const emailMessage = (t, label) => t('common:form.errors.email', '{{label}} : saisissez une adresse e-mail valide, par exemple nom@exemple.fr.', { label: plainLabel(label) });
/** @param {TFn} t @param {string} label */
export const httpsUrlMessage = (t, label) => t('common:form.errors.https_url', '{{label}} : saisissez une adresse complète commençant par https://, par exemple https://www.service-public.fr.', { label: plainLabel(label) });
/** @param {TFn} t @param {string} label */
export const chooseMessage = (t, label) => t('common:form.errors.choose', '{{label}} : choisissez une option dans la liste.', { label: plainLabel(label) });
