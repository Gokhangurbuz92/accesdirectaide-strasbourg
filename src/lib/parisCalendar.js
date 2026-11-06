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

// R47: the professional's datetime-local fields (absences) are Paris wall time, whatever the time zone of the device — the screens list them in Paris time
const PARIS_WALL = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** an instant as the value of a datetime-local field in Paris wall time (YYYY-MM-DDTHH:MM), '' when invalid @param {string | number | Date} raw */
export function parisWallValue(raw) {
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? '' : PARIS_WALL.format(d).replace(' ', 'T');
}
/** a datetime-local value read as Paris wall time → the ISO instant ('' when invalid); a time skipped by the spring change is moved forward @param {string} value */
export function parisWallToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return '';
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 2; i += 1) {   // two passes settle the offset on either side of a change
    const [dd, tt] = PARIS_WALL.format(new Date(t)).split(' ');
    const shown = Date.parse(`${dd}T${tt}:00Z`);
    t += wall - shown;
  }
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}
