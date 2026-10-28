/**
 * Launch-readiness item 63 — the deadline of a data-subject request: GDPR art. 12(3), an answer « within one month of receipt », computed the way EU
 * regulation 1182/71 counts months (art. 3.2 c: the same date in the following month, or its last day when that date does not exist). The extension of two
 * further months is a decision taken and explained to the person — never applied automatically.
 */
const DAY = 86400000;

/** @param {Date | string | null | undefined} receivedAt @param {Date} [now] */
export function dsrDeadline(receivedAt, now = new Date()) {
  const r = receivedAt ? new Date(receivedAt) : null;
  if (!r || Number.isNaN(r.getTime())) return { dueAt: null, overdue: false, daysLeft: null };
  const y = r.getUTCFullYear(); const m = r.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();   // days in the following month
  const due = new Date(Date.UTC(y, m, Math.min(r.getUTCDate(), lastDay), 23, 59, 59, 999));
  return { dueAt: due.toISOString(), overdue: now.getTime() > due.getTime(), daysLeft: Math.ceil((due.getTime() - now.getTime()) / DAY) };
}
