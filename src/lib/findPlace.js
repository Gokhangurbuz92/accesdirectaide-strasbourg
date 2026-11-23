// @ts-nocheck
/**
 * G14-FIND — « Où ? » of the Mon Espace search (src/components/account/FindAndBook.jsx): the covered territory and where a search leads.
 *   - a commune of the covered territory (Eurométropole de Strasbourg, data/geography/service-territory.v1.json) → its INSEE code (`territoire=`), the
 *     pre-filter /recherche already applies; without words, the directory of that town (/structures?city=);
 *   - a postal code of the Bas-Rhin (67xxx) → with words, the commune the directory's OWN recorded addresses give for that postal code
 *     (communeFromZip: one read of /api/structures?zip=), then the same search as a commune; otherwise (no words, or no commune of the covered territory
 *     found) the directory filtered on the places' recorded postal code (/structures?zip=). No postal code ↔ commune table is used: the Insee publishes
 *     none, and none is invented;
 *   - anything else → unknown (the form says which places are covered, nothing is sent).
 */
import serviceTerritory from '../../data/geography/service-territory.v1.json';

export const COMMUNES = /** @type {[string, string][]} */ (serviceTerritory.communes);
const fold = (/** @type {string} */ s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-'’\s]+/g, ' ').trim();

/** @param {string} raw @returns {{ kind: 'none' } | { kind: 'commune', code: string, name: string } | { kind: 'zip', zip: string } | { kind: 'unknown' }} */
export function parsePlace(raw) {
  const v = String(raw || '').trim();
  if (!v) return { kind: 'none' };
  if (/^\d{5}$/.test(v)) return v.startsWith('67') ? { kind: 'zip', zip: v } : { kind: 'unknown' };
  const f = fold(v);
  const hit = COMMUNES.find(([code, name]) => fold(name) === f || code === v);
  return hit ? { kind: 'commune', code: hit[0], name: hit[1] } : { kind: 'unknown' };
}

/** the destination of a search, or null when nothing can be searched @param {string} q @param {ReturnType<typeof parsePlace>} place */
export function searchTarget(q, place) {
  const words = String(q || '').trim().slice(0, 200);
  const p = new URLSearchParams();
  if (place.kind === 'zip') {
    if (words) p.set('q', words);
    p.set('zip', place.zip);
    return `/structures?${p}`;
  }
  if (place.kind === 'commune') {
    if (!words) { p.set('city', place.name); return `/structures?${p}`; }
    p.set('q', words); p.set('territoire', place.code);
    return `/recherche?${p}`;
  }
  if (!words) return null;
  p.set('q', words);
  return `/recherche?${p}`;
}


/**
 * The commune of the covered territory that the directory's recorded addresses give for a postal code (the most frequent town among the places with
 * that postal code), or null. Data-derived, never a guess: no place recorded with that postal code → null.
 * @param {string} zip @param {typeof fetch} [fetchImpl] @returns {Promise<{ kind: 'commune', code: string, name: string } | null>}
 */
export async function communeFromZip(zip, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/api/structures?zip=${encodeURIComponent(zip)}&limit=20&sort=quality`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const it of Array.isArray(body?.items) ? body.items : []) { const v = typeof it?.ville === 'string' ? it.ville.trim() : ''; if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const place = top ? parsePlace(top[0]) : null;
    return place && place.kind === 'commune' ? place : null;
  } catch {
    return null;
  }
}
