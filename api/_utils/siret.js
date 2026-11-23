/**
 * A well-formed SIRET: 14 digits with a valid Luhn key; La Poste's establishments (SIREN 356 000 000) have their own rule (sum of the digits a multiple of 5).
 * Moved here unchanged from api/_services/verification/datainclusion.js (which re-exports it) so the professional sign-up (G14) can check a SIRET without
 * loading the data·inclusion importer. A well-formed SIRET is not a verified one: a registry or an ADA administrator confirms it.
 * @param {unknown} s @returns {string | null} the 14 digits, or null
 */
export function validSiret(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 14) return null;
  if (d.startsWith('356000000')) return [...d].reduce((a, c) => a + Number(c), 0) % 5 === 0 ? d : null;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) { let n = Number(d[13 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0 ? d : null;
}
