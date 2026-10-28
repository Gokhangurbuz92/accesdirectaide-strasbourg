/**
 * R18 — the citizen password rule, ONE definition for the server (sign-up and reset: api/_handlers/auth) and the screens that ask for a password, so the screen
 * states the rule before sending and the server's refusal is the same sentence (it used to be « Une erreur est survenue », and the reset accepted any 8 characters).
 */
export const PASSWORD_RULE = 'Au moins 8 caractères, dont une majuscule, une minuscule et un chiffre.';

/** @param {unknown} value @returns {string[]} what is missing, in French (empty: the password is accepted) — the server's `details` wording, unchanged since K0 */
export function passwordProblems(value) {
  const pw = String(value ?? '');
  const out = [];
  if (pw.length < 8) out.push('8 caractères minimum');
  if (!/[A-Z]/.test(pw)) out.push('1 majuscule requise');
  if (!/[a-z]/.test(pw)) out.push('1 minuscule requise');
  if (!/[0-9]/.test(pw)) out.push('1 chiffre requis');
  return out;
}

/** @param {string[]} problems */
export const passwordMessage = (problems) => `Mot de passe trop faible : ${problems.join(', ')}.`;
