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

/** R46: how far ahead a booking may be made (the server's MAX_BOOKING_AHEAD_DAYS) and the window step of the booking page */
export const BOOKING_AHEAD_DAYS = 60;
export const BOOKING_WINDOW_DAYS = 14;
/** the last window start offset that still contains a bookable day (0, 14, 28, 42, 56) */
export const MAX_WINDOW_OFFSET = Math.floor(BOOKING_AHEAD_DAYS / BOOKING_WINDOW_DAYS) * BOOKING_WINDOW_DAYS;

/**
 * the booking page's slot window: today in Paris and the 13 following Paris days (the API's 14-day maximum); R46: `offsetDays` (a multiple of 14, clamped
 * to [0, MAX_WINDOW_OFFSET]) moves it to the following fortnights, so every bookable day up to 60 days ahead can be reached
 * @param {Date} [now] @param {number} [offsetDays]
 */
export function parisBookingWindow(now = new Date(), offsetDays = 0) {
  const offset = Math.min(MAX_WINDOW_OFFSET, Math.max(0, Math.trunc(Number(offsetDays) || 0)));
  const from = addCalendarDays(parisDate(now), offset);
  return { from, to: addCalendarDays(from, BOOKING_WINDOW_DAYS - 1) };
}
