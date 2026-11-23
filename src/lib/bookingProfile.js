// @ts-nocheck
/**
 * G14-FIND — the public booking profile of a place (GET /api/rdv/structures/:slug/profile, account-free, the SAME sensitivity, verification and agenda
 * gates as the booking itself). Returns null when it cannot be read (closed, not bookable, network): the page then keeps its plain booking entry.
 * @param {string} slug @returns {Promise<{ services: Array<{ id: string, name: string, durationMinutes: number, onlineBooking: string }>, nextAvailableDay: string | null } | null>}
 */
export async function fetchBookingProfile(slug) {
  try {
    const res = await fetch(`/api/rdv/structures/${encodeURIComponent(slug)}/profile`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return body && Array.isArray(body.services) ? { services: body.services, nextAvailableDay: typeof body.nextAvailableDay === 'string' ? body.nextAvailableDay : null } : null;
  } catch {
    return null;
  }
}

/** the services that can be asked online now (the others are booked by contacting the place) @param {any} profile */
export const openServices = (profile) => (profile && Array.isArray(profile.services) ? profile.services.filter((s) => s.onlineBooking === 'OPEN') : []);
