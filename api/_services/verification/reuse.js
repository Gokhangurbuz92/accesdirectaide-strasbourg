/**
 * Reuse terms of the publishers whose pages the platform reads (R29, extended R41-IJ). One registry for the news and the content chain.
 *
 * Reading a page to verify a fact (address, fingerprint, date kept) is allowed for every official source; REPUBLISHING its words is allowed only when the
 * publisher's legal notice or licence allows it (« open »). Each entry was read by hand on the publisher's legal notice, with its address and date. A host that
 * is not listed is NOT open (fail-closed): its words are never republished, only facts written in our own words.
 */

/** @typedef {{ status: 'open' | 'authorisation-required', publisher: string, licence?: string, evidenceUrl: string, checkedAt: string }} ReuseTerms */

/** @type {Readonly<Record<string, ReuseTerms>>} */
export const REUSE_BY_HOST = Object.freeze({
  'www.service-public.gouv.fr': { status: 'open', publisher: 'Service-Public.fr (DILA)', licence: 'Licence Ouverte 2.0 (etalab-2.0)', evidenceUrl: 'https://www.service-public.gouv.fr/P10025', checkedAt: '2026-10-31' },
  'entreprendre.service-public.gouv.fr': { status: 'open', publisher: 'Service-Public.fr Entreprendre (DILA)', licence: 'Licence Ouverte 2.0 (etalab-2.0)', evidenceUrl: 'https://www.service-public.gouv.fr/P10025', checkedAt: '2026-10-31' },
  'www.grandest.fr': { status: 'authorisation-required', publisher: 'Région Grand Est', evidenceUrl: 'https://www.grandest.fr/mentions-legales/', checkedAt: '2026-11-03' },
  'www.grand-est.ars.sante.fr': { status: 'authorisation-required', publisher: 'ARS Grand Est', evidenceUrl: 'https://www.grand-est.ars.sante.fr/mentions-legales-9', checkedAt: '2026-11-03' },
  // R41: « Aucune reproduction … sans autorisation expresse » (rubrique « Contenu et propriété intellectuelle »)
  'www.strasbourg.eu': { status: 'authorisation-required', publisher: 'Ville et Eurométropole de Strasbourg', evidenceUrl: 'https://www.strasbourg.eu/mentions-legales', checkedAt: '2026-11-03' },
  // R41: reproduction totale ou partielle interdite sans accord préalable (art. L122-4 CPI cité par la page)
  'www.alsace.eu': { status: 'authorisation-required', publisher: 'Collectivité européenne d’Alsace', evidenceUrl: 'https://www.alsace.eu/mentions-legales/', checkedAt: '2026-11-03' },
});

/** the reuse terms of an address's host, or null when the host is not registered @param {string} url @returns {ReuseTerms | null} */
export function reuseOf(url) {
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { return null; }
  return Object.prototype.hasOwnProperty.call(REUSE_BY_HOST, host) ? REUSE_BY_HOST[host] : null;
}

/** may the words of this address be republished? Only a registered « open » host; anything else (unknown, malformed) is not @param {string} url */
export const isReuseOpen = (url) => reuseOf(url)?.status === 'open';
