/**
 * R46 (D10) — identity check of the OpenFisca engine, read from the engine itself (api/lib/openfiscaClient.js stays byte-identical, hash-pinned by
 * tests/unit/ws3-diagnostic-boundary.test.js; its isAvailable() remains the reachability probe).
 *
 * OpenFisca's Web API states its country package and version on every response (headers Country-Package / Country-Package-Version). When
 * OPENFISCA_FRANCE_VERSION pins a version (the one the request protocol was verified against — scripts/openfisca-local.sh, infrastructure/openfisca/Dockerfile,
 * tests/fixtures/openfisca-france-176-variables.json), an engine of ANOTHER version, one that does not state its version, or another country package is
 * treated as unavailable: the qualified estimate says « les règles de la version du moteur indiquée », so the version shown must be the engine's real one.
 * GET /spec only: nothing of the person is sent. Never throws; the codes are a closed vocabulary. The public prototype endpoint is never contacted here.
 */
const HEALTH_CACHE_TTL_MS = 60_000;
let cache = { at: 0, health: /** @type {EngineHealth | null} */ (null) };

/** codes that mean « reachable, but not the engine we verified » — the diagnostic fails closed on them */
export const IDENTITY_FAILURES = Object.freeze(['OPENFISCA_VERSION_MISMATCH', 'OPENFISCA_VERSION_UNKNOWN', 'OPENFISCA_WRONG_COUNTRY_PACKAGE']);

/** @typedef {{ ok: boolean, code: string, configured: boolean, reachable: boolean, countryPackage: string|null, version: string|null, expectedVersion: string|null }} EngineHealth */

function engineUrl() {
  const raw = process.env.OPENFISCA_URL || process.env.OPENFISCA_API_URL || '';
  return raw.replace(/\/+$/, '');
}

/** @returns {Promise<EngineHealth>} */
export async function engineHealth() {
  const expectedVersion = (process.env.OPENFISCA_FRANCE_VERSION || '').trim() || null;
  const url = engineUrl();
  const base = { configured: Boolean(url), reachable: false, countryPackage: null, version: null, expectedVersion };
  if (!url) return { ...base, ok: false, code: 'OPENFISCA_NOT_CONFIGURED' };
  if (/api\.fr\.openfisca\.org/i.test(url)) return { ...base, ok: false, code: 'OPENFISCA_PUBLIC_PROTOTYPE_NOT_CHECKED' };
  try {
    const res = await fetch(`${url}/spec`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ...base, ok: false, code: 'OPENFISCA_HEALTH_HTTP_ERROR' };
    const header = (/** @type {string} */ n) => (typeof res.headers?.get === 'function' ? res.headers.get(n) : null);
    const pkg = header('country-package'); const version = header('country-package-version');
    const out = { ...base, reachable: true, countryPackage: pkg ? String(pkg).slice(0, 64) : null, version: version ? String(version).slice(0, 32) : null };
    if (out.countryPackage && !/openfisca[-_]france/i.test(out.countryPackage)) return { ...out, ok: false, code: 'OPENFISCA_WRONG_COUNTRY_PACKAGE' };
    if (expectedVersion && !out.version) return { ...out, ok: false, code: 'OPENFISCA_VERSION_UNKNOWN' };
    if (expectedVersion && out.version !== expectedVersion) return { ...out, ok: false, code: 'OPENFISCA_VERSION_MISMATCH' };
    return { ...out, ok: true, code: 'OPENFISCA_OK' };
  } catch {
    return { ...base, ok: false, code: 'OPENFISCA_HEALTH_UNREACHABLE' };
  }
}

/** engineHealth() behind a 60 s cache (one probe per minute at most, like the client's own health cache) */
export async function cachedEngineHealth() {
  if (cache.health && Date.now() - cache.at < HEALTH_CACHE_TTL_MS) return cache.health;
  const health = await engineHealth();
  cache = { at: Date.now(), health };
  return health;
}

/** tests only */
export const _resetEngineHealthCache = () => { cache = { at: 0, health: null }; };
