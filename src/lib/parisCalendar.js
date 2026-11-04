// R43 — the Paris calendar for the booking page: the slot window is 14 PARIS days starting today in Strasbourg. The UTC date (toISOString) is the day before
// between 00:00 and 01:00 / 02:00 Paris, which made the window start « yesterday » and lose its 14th Paris day.
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** the Paris calendar day (YYYY-MM-DD) of an instant @param {Date} [at] @returns {string} */
export function parisDate(at = new Date()) {
  return PARIS_DAY.format(at);
}

/** a YYYY-MM-DD day plus n calendar days (pure date arithmetic, no time zone) @param {string} ymd @param {number} n @returns {string} */
export function addCalendarDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** the booking page's slot window: today in Paris and the 13 following Paris days (the API's 14-day maximum) @param {Date} [now] */
export function parisBookingWindow(now = new Date()) {
  const from = parisDate(now);
  return { from, to: addCalendarDays(from, 13) };
}
