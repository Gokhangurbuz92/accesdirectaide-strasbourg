// @ts-check
import { useEffect, useState } from 'react';

/**
 * G14-R4 (live-checked review of 395a8abe) — the build switch (VITE_PUBLIC_BETA_OPEN_SURFACES) says a screen MAY be shown; whether the server really serves
 * dossier sharing depends on its capabilities (citizen.shared_dossier, citizen.saved_diagnostic, the HDS-only routes). With « documents » open and the
 * capability closed, /diagnostic offered « Partager le dossier » and the server answered 503. The browser now asks GET /api/status once (no personal data,
 * the server caches it 30 s) and offers sharing only when the server says it serves it. Unknown (loading, error, old server) = not offered (fail closed).
 * @typedef {'sharedDossiers' | 'diagnosticShare' | 'hdsGateway'} ServerFeature
 */

/** @param {unknown} body @param {ServerFeature} name @returns {boolean} */
export function featureOf(body, name) {
  const f = body && typeof body === 'object' ? /** @type {any} */ (body).features : null;
  return Boolean(f && typeof f === 'object' && f[name] === true);
}

/** @param {ServerFeature} name @param {typeof fetch} [fetchImpl] @returns {Promise<boolean>} */
export async function fetchServerFeature(name, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/api/status', { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return false;
    return featureOf(await r.json(), name);
  } catch {
    return false;
  }
}

/**
 * true once the server confirmed the feature; false while unknown. Nothing is requested when `enabled` is false (the build keeps the screen closed anyway).
 * @param {ServerFeature} name @param {boolean} enabled @returns {boolean}
 */
export function useServerFeature(name, enabled) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) { setOn(false); return undefined; }
    let alive = true;
    fetchServerFeature(name).then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, [name, enabled]);
  return enabled && on;
}

/**
 * tri-state read: true / false only when the server said so explicitly; null when unknown (error, old server, field absent).
 * @param {ServerFeature} name @param {typeof fetch} [fetchImpl] @returns {Promise<boolean | null>}
 */
export async function fetchServerFeatureState(name, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/api/status', { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    const f = /** @type {any} */ (await r.json())?.features;
    return f && typeof f === 'object' && typeof f[name] === 'boolean' ? f[name] : null;
  } catch {
    return null;
  }
}
