// @ts-nocheck
/** expiry (ms) of the stored professional session token, read from its payload (display only — the server decides) */
export function proTokenExpiry(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch { return null; }
}
