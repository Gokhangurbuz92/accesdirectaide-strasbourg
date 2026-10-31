/**
 * R29 — who wrote a news item and under which reuse terms, from the address of its original page. Only publishers whose texts may be reused are
 * published (api/_services/news-verification.js); the item names them and their licence.
 */
const DILA = { name: 'Service-Public.fr', owner: 'Direction de l’information légale et administrative (DILA)', licence: 'Licence Ouverte 2.0', licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/' };
const PUBLISHERS = { 'www.service-public.gouv.fr': DILA, 'entreprendre.service-public.gouv.fr': DILA };

/** @param {string | null | undefined} url @returns {{ name: string, owner: string, licence: string, licenceUrl: string } | null} */
export function newsPublisher(url) {
  try { return PUBLISHERS[new URL(String(url)).hostname] || null; } catch { return null; }
}

/** the label shown after « Source : » — the publisher's name, or the site's address when the publisher is not known */
export function newsSourceLabel(url, fallback = '') {
  const p = newsPublisher(url);
  if (p) return p.name;
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return fallback; }
}

/** a category worth showing: « general » (a whole feed's default) says nothing about the item */
export const shownNewsCategory = (c) => (c && c !== 'general' ? c : null);
