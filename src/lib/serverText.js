/**
 * R47 — a message written by the API (in French: the server's refusals are its contract, asserted by the API tests) shown in the INTERFACE language.
 * On a French page the server's sentence is shown exactly as before. In another language a known sentence has its own key, and an unknown one is replaced
 * by the caller's own translated fallback (a French sentence there was unreadable).
 */
import i18n from '@/i18n';

const norm = (/** @type {string} */ s) => s.trim().replace(/[’']/g, "'").replace(/\.$/, '');

/** the server sentences the screens show most (not-found answers of the record pages), by their normalised French text */
const KNOWN = () => ({
  'Dossier introuvable': i18n.t('common:server.dossier_not_found', 'Dossier introuvable.'),
  'Ce dossier est introuvable ou n\'est pas rattaché à votre compte': i18n.t('common:server.share_not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.'),
  'Too Many Requests': i18n.t('common:server.too_many', 'Trop de demandes en peu de temps : patientez une minute, puis réessayez.'),
  'Conversation introuvable': i18n.t('common:server.conversation_not_found', 'Conversation introuvable.'),
  'Rendez-vous introuvable': i18n.t('common:server.appointment_not_found', 'Rendez-vous introuvable.'),
  'Not found': i18n.t('common:server.not_found', 'Introuvable : cette page ou cet élément n’existe pas, ou plus.'),
});

/**
 * @param {unknown} message what the API answered (error / message field)
 * @param {string} [fallback] the caller's translated sentence for this situation
 * @returns {string}
 */
export function serverText(message, fallback = '') {
  const m = typeof message === 'string' ? message : '';
  if (!m) return fallback;
  if (String(i18n.language || 'fr').startsWith('fr')) return m;   // the French page shows the server's sentence exactly as before
  return /** @type {Record<string, string>} */ (KNOWN())[norm(m)] || fallback || m;
}
