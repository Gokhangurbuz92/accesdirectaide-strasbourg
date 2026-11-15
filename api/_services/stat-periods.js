// @ts-nocheck
/**
 * The fixed publication grid of every cross-organization statistic (institution observatoire and export, professional regional observatoire): COMPLETE calendar
 * periods only. A running period (month-to-date, rolling days) polled twice gives the increment between the two polls — a per-commune daily count.
 * No database, no import: both statistics services read it (api/_services/territorial-stats.js re-exports it).
 */

/** Calendar period [start, end) for 'month' | 'quarter' | 'year' ending with the last COMPLETE period before `now`. */
export function periodWindow(period, now = new Date()) {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  if (period === 'year') return { label: String(y - 1), start: new Date(Date.UTC(y - 1, 0, 1)), end: new Date(Date.UTC(y, 0, 1)) };
  if (period === 'quarter') { const q = Math.floor(m / 3); const sq = q === 0 ? 3 : q - 1; const sy = q === 0 ? y - 1 : y;
    return { label: `${sy}-T${sq + 1}`, start: new Date(Date.UTC(sy, sq * 3, 1)), end: new Date(Date.UTC(sy, sq * 3 + 3, 1)) }; }
  const sm = m === 0 ? 11 : m - 1; const sy = m === 0 ? y - 1 : y;
  return { label: `${sy}-${String(sm + 1).padStart(2, '0')}`, start: new Date(Date.UTC(sy, sm, 1)), end: new Date(Date.UTC(sy, sm + 1, 1)) };
}

/** The four complete calendar quarters before `now`, oldest first. */
export function lastQuarters(now = new Date(), count = 4) {
  const out = []; let at = now;
  for (let i = 0; i < count; i += 1) { const w = periodWindow('quarter', at); out.unshift(w); at = new Date(w.start.getTime() + 86400000); }
  return out;
}
