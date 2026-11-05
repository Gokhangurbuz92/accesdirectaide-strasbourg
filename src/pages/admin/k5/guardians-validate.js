// @ts-nocheck
/** R46 / C05 — the client-side checks of the guardian verification form (the server applies the same 10–500 rule: api/_handlers/admin/guardianships.js). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** @param {{ id: string, method: string, reason: string }} form @param {(k: string, d: string, o?: object) => string} t */
export function validate(form, t) {
  const errors = {};
  if (!form.id) errors.id = t('admin:k5.guardians.v.link', 'Choisissez le lien vérifié.');
  if (!form.method) errors.method = t('admin:k5.guardians.v.method', 'Choisissez la méthode utilisée.');
  const r = form.reason.trim();
  if (r.length < REASON_MIN || r.length > REASON_MAX) errors.reason = t('admin:k5.guardians.v.reason_length', 'Le motif doit faire de {{min}} à {{max}} caractères (actuellement {{n}}).', { min: REASON_MIN, max: REASON_MAX, n: r.length });
  else if (/[<>]/.test(r)) errors.reason = t('admin:k5.guardians.v.reason_chars', 'Le motif ne peut pas contenir les signes < ou >.');
  return errors;
}
