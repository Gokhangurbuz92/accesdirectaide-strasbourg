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
  // 0.2 (2026-10-25): launch-readiness items 46 (automatic verification), 61 (encryption at rest), 63 (device answers), 64 (information banner)
  // 0.3 (2026-11-04, R42-LEGAL): operator = natural-person project carrier, no association created (R42-A01); appointments require an account
  // (DEC-R42-01); structures' role and retention periods marked as not decided; transfer guarantees no longer asserted without verification
  version: '0.3',
  date: '2026-11-04',
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
 * Public beta (owner directive 29/10/2026): the publisher's identity is not kept in the public source code. It comes from build-time variables set in the
 * Vercel project (VITE_LEGAL_*); the release gate runs in the same build, so a production build without them fails.
 * @param {string} name
 */
function legalValue(name) {
  // STATIC references only: a dynamic import.meta.env[name] makes Vite inline EVERY VITE_* variable of the build (integration URLs, Vercel metadata) into the bundle
  const env = import.meta.env || {};
  const fromVite = {
    VITE_LEGAL_DATA_PROTECTION_CONTACT: env.VITE_LEGAL_DATA_PROTECTION_CONTACT,
    VITE_LEGAL_PUBLISHER_IDENTITY: env.VITE_LEGAL_PUBLISHER_IDENTITY,
    VITE_LEGAL_CONTROLLER_IDENTITY: env.VITE_LEGAL_CONTROLLER_IDENTITY,
    VITE_LEGAL_PUBLICATION_DIRECTOR: env.VITE_LEGAL_PUBLICATION_DIRECTOR,
    VITE_LEGAL_SECURITY_CONTACT: env.VITE_LEGAL_SECURITY_CONTACT,
    VITE_LEGAL_RIGHTS_HOLDER: env.VITE_LEGAL_RIGHTS_HOLDER,
  }[name];
  const fromNode = globalThis.process?.env ? globalThis.process.env[name] : undefined;
  return String(fromVite || fromNode || '').trim();
}

/**
 * Visible placeholders: these values are NOT decided yet. They must be shown as-is (never replaced by an invented
 * address, name, SIRET or DPO) until the owner fills them in.
 */
export const LEGAL_PLACEHOLDERS = Object.freeze({
  dataProtectionContact: legalValue('VITE_LEGAL_DATA_PROTECTION_CONTACT') || '[À COMPLÉTER : adresse de contact protection des données]',
  // R42-A01: the publisher is a natural person (the project carrier) until a legal person exists — LCEN art. 1-1 I 1° asks a natural person for
  // name and first names, domicile and telephone (or, for a NON-professional publisher only, art. 1-1 II anonymity through the host)
  publisherIdentity: legalValue('VITE_LEGAL_PUBLISHER_IDENTITY') || "[À COMPLÉTER : identité de l'éditeur — nom et prénom de la personne physique porteuse du projet, domicile et téléphone (LCEN, art. 1-1 I 1°) ; aucune association n'est créée]",
  // R44 (LCEN analysis I-1): the controller shown in the privacy notice (GDPR art. 13(1)(a): identity and contact details) is its own value, so that the
  // publisher's LCEN identification (domicile, telephone, or the art. 1-1 II anonymity wording) is never copied into the privacy notice. Unset = the
  // publisher identity, as before (no visible change until the owner sets it).
  controllerIdentity: legalValue('VITE_LEGAL_CONTROLLER_IDENTITY') || legalValue('VITE_LEGAL_PUBLISHER_IDENTITY')
    || "[À COMPLÉTER : identité du responsable de traitement — nom et prénom de la personne physique porteuse du projet (RGPD, art. 13-1 a) ; aucune association n'est créée]",
  publicationDirector: legalValue('VITE_LEGAL_PUBLICATION_DIRECTOR') || '[À COMPLÉTER : directeur ou directrice de la publication]',
  // address as published in vercel.com/legal/privacy-policy (read 30/10/2026); Vercel publishes no telephone number, only its help centre
  hostAddress: 'Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis — contact : https://vercel.com/help',
  securityContact: legalValue('VITE_LEGAL_SECURITY_CONTACT') || '[À COMPLÉTER : adresse de signalement des failles de sécurité]',
  rightsHolder: legalValue('VITE_LEGAL_RIGHTS_HOLDER') || '[À COMPLÉTER : titulaire des droits]',
});
