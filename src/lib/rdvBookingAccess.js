// RDV booking entrance policy; the backend remains authoritative (api/_handlers/rdv.js, auth/me.js).
/**
 * @param {string | null | undefined} search
 * @param {string | null | undefined} hash
 * @returns {boolean}
 */
export function hasBookingManagementCapability(search, hash) {
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const appointmentId = String(query.get('appointment') || '').trim();
  const token = String(fragment.get('token') || '').trim();
  // The server validates the capability; this only preserves the existing flow.
  return appointmentId.length > 0 && token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}

/**
 * @param {number} status
 * @param {any} payload
 * @returns {'login' | 'verify-email' | 'unavailable' | 'allowed'}
 */
export function classifyCitizenBookingAccess(status, payload) {
  if (status === 401) return 'login';
  if (status === 403 && payload?.code === 'EMAIL_NOT_VERIFIED') return 'verify-email';
  if (status !== 200) return 'unavailable';
  if (payload?.session?.kind !== 'user' || !payload?.user?.id) return 'login';
  if (payload.user.emailVerified === false || payload.user.emailVerifiedAt === null) return 'verify-email';
  return 'allowed';
}

/**
 * @param {string | null | undefined} pathname
 * @param {string | null | undefined} search
 * @returns {string}
 */
export function citizenBookingLoginUrl(pathname, search) {
  const path = String(pathname || '');
  const safePath = /^\/rdv\/[^/?#]+\/booking$/.test(path) ? path : '/annuaire';
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  // A capability or appointment identifier never goes into an auth redirect.
  query.delete('appointment');
  query.delete('token');
  const suffix = query.toString();
  const next = safePath + (suffix.length > 0 && suffix.length <= 2000 ? `?${suffix}` : '');
  return `/auth/login?next=${encodeURIComponent(next)}`;
}
