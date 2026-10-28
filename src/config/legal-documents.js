/**
 * Version and date of the public legal documents (mentions légales, politique de confidentialité, cookies, CGU).
 *
 * The date is FIXED: it only changes when the text of a legal page changes. Never display `new Date()` as the
 * "last updated" date (it made every page look modified on the day of the visit and made it impossible to prove which
 * version a person read). See STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/05_CORRECTIONS_PAGES_APPLICATION.md § 0.
 *
 * Status: draft texts — a legal review is still required before any public launch.
 */
export const LEGAL_DOCS_VERSION = Object.freeze({
  version: '0.2',   // 2026-10-25: launch-readiness items 46 (automatic verification), 61 (encryption at rest), 63 (device answers), 64 (information banner)
  date: '2026-10-25',
  status: 'PROJET — relecture juridique requise',
});

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Formats an ISO date (YYYY-MM-DD) in French without depending on the visitor's time zone or locale. */
export function formatLegalDate(iso = LEGAL_DOCS_VERSION.date) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return String(iso);
  return `${d === 1 ? '1er' : d} ${MONTHS_FR[m - 1]} ${y}`;
}

/** Text shown at the bottom of each legal page. */
export const LEGAL_DOCS_LABEL = `Version projet du ${formatLegalDate(LEGAL_DOCS_VERSION.date)} — relecture juridique en cours`;

/**
 * Visible placeholders: these values are NOT decided yet. They must be shown as-is (never replaced by an invented
 * address, name, SIRET or DPO) until the owner fills them in.
 */
export const LEGAL_PLACEHOLDERS = Object.freeze({
  dataProtectionContact: '[À COMPLÉTER : adresse de contact protection des données]',
  publisherIdentity: "[À COMPLÉTER : identité de l'éditeur (dénomination ou nom, forme juridique, adresse, téléphone, numéro d'inscription au registre des associations)]",
  publicationDirector: '[À COMPLÉTER : directeur ou directrice de la publication]',
  // address as published in vercel.com/legal/privacy-policy (read 30/10/2026); Vercel publishes no telephone number, only its help centre
  hostAddress: 'Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis — contact : https://vercel.com/help',
  securityContact: '[À COMPLÉTER : adresse de signalement des failles de sécurité]',
  rightsHolder: '[À COMPLÉTER : titulaire des droits]',
});
