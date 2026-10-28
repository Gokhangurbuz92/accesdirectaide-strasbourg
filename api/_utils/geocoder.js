// Native fetch used
import logger from './logger.js';

/**
 * Geocode an address string using the official French "API Adresse" (BAN).
 * @param {string} address - Full address string (e.g. "1 Place de l'Étoile, Strasbourg")
 * @returns {Promise<{lat: number, lng: number, score: number} | null>}
 */
export async function geocodeAddress(address) {
    if (!address) return null;

    try {
        const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
        // R12 (N11): bounded (a stalled request held the whole import run)
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

        if (!res.ok) {
            logger.error(`Geocoding error: ${res.status} ${res.statusText}`);
            return null;
        }

        const data = await res.json();

        if (data.features && data.features.length > 0) {
            const feature = data.features[0];
            const [lng, lat] = feature.geometry.coordinates;
            const score = feature.properties.score;

            return {
                lat,
                lng,
                score
            };
        }

        return null;
    } catch (error) {
        // R12 (N11): the address itself is never logged (only its length)
        logger.error({ err: { name: /** @type {any} */ (error)?.name, message: /** @type {any} */ (error)?.message }, addressLength: String(address).length }, 'Geocoding failed');
        return null;
    }
}
