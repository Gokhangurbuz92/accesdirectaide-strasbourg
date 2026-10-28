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
        if (res.ok) return true;
    } catch {
        // network failure: same message below
    }
    window.alert('La déconnexion a échoué. Réessayez ; sur un appareil partagé, fermez aussi le navigateur.');
    return false;
}
