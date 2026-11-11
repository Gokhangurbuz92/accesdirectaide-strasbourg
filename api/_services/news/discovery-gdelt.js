/**
 * Actualités v2 — optional worldwide discovery through the GDELT DOC 2.0 API (https://api.gdeltproject.org/api/v2/doc/doc), used ONLY to list other
 * reports of a story under « Sources et couverture » as links (publisher site, date, address). GDELT returns metadata about third-party articles: it
 * grants no right to their text or images, so neither the titles nor the « socialimage » are kept or shown.
 *
 * Off unless NEWS_DISCOVERY_GDELT=on. Bounded: one request per story at most every 6 h (cache), a 5-second timeout, 25 records, https links only,
 * at most one link per site, known-bad hosts refused; any failure returns no link and never breaks the article (the licensed feed works without it).
 */
import { fold, storyTokens } from './editorial.js';

export const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const TTL_MS = 6 * 3600 * 1000;
const cache = new Map();
let lastCall = 0;

/** the query: the story's strongest words (no stop words), quoted phrase avoided (GDELT rejects very short phrases) @param {string} title */
export function gdeltQuery(title) {
  const words = storyTokens(title).filter((w) => w.length > 3).slice(0, 5);
  return words.length >= 2 ? words.join(' ') : null;
}

/**
 * @param {string} title @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, now?: number, exclude?: string[], max?: number }} [o]
 * @returns {Promise<{ publisher: string, url: string, date: string | null, lane: 'B', via: 'gdelt' }[]>}
 */
export async function discoverCoverage(title, { env = process.env, fetchImpl = fetch, now = Date.now(), exclude = [], max = 6 } = {}) {
  if (env.NEWS_DISCOVERY_GDELT !== 'on') return [];
  const query = gdeltQuery(title); if (!query) return [];
  const key = fold(query);
  const hit = cache.get(key); if (hit && now - hit.at < TTL_MS) return hit.links.filter((/** @type {any} */ l) => !exclude.includes(l.publisher)).slice(0, max);
  if (now - lastCall < 5000) return [];   // GDELT asks for at most one request every 5 s: skip rather than queue
  lastCall = now;
  const url = new URL(GDELT_ENDPOINT);
  url.search = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '25', timespan: '72h', sort: 'hybridrel' }).toString();
  let body;
  try {
    const r = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    body = await r.json();
  } catch { return []; }
  const seen = new Set(); /** @type {{ publisher: string, url: string, date: string | null, lane: 'B', via: 'gdelt' }[]} */ const links = [];
  for (const a of Array.isArray(body?.articles) ? body.articles : []) {
    let u; try { u = new URL(String(a?.url || '')); } catch { continue; }
    if (u.protocol !== 'https:' || u.username || u.password) continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || seen.has(host)) continue;
    seen.add(host);
    const d = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(a?.seendate || ''));
    links.push({ publisher: host, url: u.toString(), date: d ? `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}Z` : null, lane: 'B', via: 'gdelt' });
  }
  cache.set(key, /** @type {any} */ ({ at: now, links }));
  return /** @type {any} */ (links.filter((/** @type {any} */ l) => !exclude.includes(l.publisher)).slice(0, max));
}

/** test hook */
export const _resetGdelt = () => { cache.clear(); lastCall = 0; };
