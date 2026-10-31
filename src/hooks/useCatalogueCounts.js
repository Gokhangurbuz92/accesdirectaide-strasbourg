import { useEffect, useState } from 'react';

/** the public catalogue lists (their `pagination.total` is what a visitor can open: only verified, visible records) */
const LISTS = { aides: '/api/aides?pageSize=1', demarches: '/api/demarches?pageSize=1', structures: '/api/structures?pageSize=1', guides: '/api/guides', actualites: '/api/actualites?pageSize=1' };
let pending = null;

/** @returns {Promise<{ aides: number | null, demarches: number | null, structures: number | null, guides: number | null, actualites: number | null }>} */
export function loadCatalogueCounts(fetchImpl = fetch) {
  if (!pending) {
    pending = Promise.all(Object.entries(LISTS).map(async ([k, url]) => {
      try {
        const r = await fetchImpl(url, { credentials: 'same-origin' });
        if (!r.ok) return [k, null];
        const j = await r.json();
        const n = Array.isArray(j) ? j.length : Number(j?.pagination?.total ?? j?.total);   // the guides list is a plain array of the published guides
        return [k, Number.isFinite(n) ? n : null];
      } catch { return [k, null]; }
    })).then((rows) => Object.fromEntries(rows));
    pending.then((c) => { if (Object.values(c).some((v) => v === null)) pending = null; });   // an outage is retried at the next page, never cached
  }
  return pending;
}
export const resetCatalogueCounts = () => { pending = null; };

/** live counts of what is published; null while loading or when a list cannot be read (the number is then simply not shown) */
export default function useCatalogueCounts() {
  const [counts, setCounts] = useState({ aides: null, demarches: null, structures: null, guides: null, actualites: null });
  useEffect(() => { let live = true; loadCatalogueCounts().then((c) => { if (live) setCounts(c); }); return () => { live = false; }; }, []);
  return counts;
}
