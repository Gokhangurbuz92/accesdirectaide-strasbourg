// @ts-nocheck
import { csrfFetch } from '@/lib/csrf';

/**
 * K0: logout is a protected POST like every mutation. It used to be sent WITHOUT the CSRF header: the API answered 403, the session cookie stayed, and the page
 * reloaded as if the person had left (dangerous on a shared device). Now the CSRF pair is sent and a refused logout is said, never hidden.
 * @returns {Promise<boolean>}
 */
export async function logoutOnServer() {
    try {
        const res = await csrfFetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (res.ok) { await endFranceConnectSession(); return true; }
    } catch {
        // network failure: same message below
    }
    window.alert('La déconnexion a échoué. Réessayez ; sur un appareil partagé, fermez aussi le navigateur.');
    return false;
}

/**
 * R46 / N08: after a FranceConnect sign-in (marker cookie « ada_fc=1 », no secret) the provider's session is ended too (RP-initiated logout): the server
 * clears its id_token cookie and returns the provider's end-session address, where the browser goes (the provider sends it back to the home page).
 */
async function endFranceConnectSession() {
    if (typeof document === 'undefined' || !/(?:^|;\s*)ada_fc=1(?:;|$)/.test(document.cookie)) return;
    try {
        const res = await csrfFetch('/api/auth/franceconnect/logout', { method: 'POST', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (data?.endSessionUrl) window.location.assign(data.endSessionUrl);
    } catch {
        // the ADA session is already revoked; the provider's own session ends with its own timeout
    }
}
