// @ts-check
/**
 * G14 release 3 (owner approval 24/11/2026) — the needs a bookable service answers, as subdomains of the ONE taxonomy of the platform: the 20 domains and
 * 86 subdomains of data/reference/social-domains.v1.json (socialReference(), shared with the demand signals, the orientation and the Mon Parcours steps).
 * Stored in "ProRdvServiceSubdomain" (drizzle/0063) by api/_handlers/pro/services.js; read by the directory's need filter (api/lib/search-query.js) so a
 * person finds « every place that takes appointments for <subdomain> ». Closed list: any other id is refused — no free text is ever stored.
 *
 * A need tag is the place's description of its service, not a classification of the person who books it. It does NOT change the service's sensitivity
 * (only an administrator's review does — api/lib/service-sensitivity.js), but a tag of a sensitive subdomain (SENSITIVE_NEEDS: health, disability,
 * addiction, immigration, justice…) is shown to the administrator as a signal for that review (suggestSensitivity).
 */
import { socialReference } from './demand-signals.js';

/** at most this many needs on one service (a service that answers « everything » describes nothing) */
export const MAX_SERVICE_SUBDOMAINS = 8;
const ID = /^[a-z0-9-]{1,64}$/;

/**
 * @param {unknown} input an array of subdomain ids (or undefined: no change)
 * @returns {{ ok: true, value: Array<{ subdomain: string, domain: string }> } | { ok: false, code: 'NEEDS_INVALID' | 'NEEDS_UNKNOWN' | 'NEEDS_TOO_MANY' }}
 */
export function parseServiceSubdomains(input) {
  if (!Array.isArray(input)) return { ok: false, code: 'NEEDS_INVALID' };
  const ids = [...new Set(input.map((x) => (typeof x === 'string' ? x.trim() : '')))];
  if (ids.some((x) => !ID.test(x))) return { ok: false, code: 'NEEDS_INVALID' };
  if (ids.length > MAX_SERVICE_SUBDOMAINS) return { ok: false, code: 'NEEDS_TOO_MANY' };
  const ref = socialReference();
  const value = [];
  for (const id of ids) {
    const s = ref.subdomains.get(id);
    if (!s) return { ok: false, code: 'NEEDS_UNKNOWN' };
    value.push({ subdomain: s.id, domain: s.domain });
  }
  return { ok: true, value: value.sort((a, b) => a.subdomain.localeCompare(b.subdomain)) };
}

/**
 * The subdomains a directory need filter selects: one subdomain, or every subdomain of one domain. null = no need filter; [] = an unknown id (the filter
 * then matches nothing — it never falls back to the whole list).
 * @param {{ subdomain?: unknown, domain?: unknown }} q @returns {string[] | null}
 */
export function needFilterSubdomains({ subdomain, domain } = {}) {
  const sub = typeof subdomain === 'string' ? subdomain.trim() : '';
  const dom = typeof domain === 'string' ? domain.trim() : '';
  if (!sub && !dom) return null;
  const ref = socialReference();
  if (sub) {
    const s = ID.test(sub) ? ref.subdomains.get(sub) : undefined;
    if (!s || (dom && s.domain !== dom)) return [];
    return [s.id];
  }
  if (!ID.test(dom) || !ref.domains.includes(dom)) return [];
  return [...ref.subdomains.values()].filter((s) => s.domain === dom).map((s) => s.id);
}

/** the sensitive subdomains among these tags (for the administrator's sensitivity review — a signal, never a value) @param {string[]} subdomains */
export function sensitiveTags(subdomains) {
  const ref = socialReference();
  return (Array.isArray(subdomains) ? subdomains : []).filter((id) => ref.subdomains.get(id)?.sensitive === true);
}
