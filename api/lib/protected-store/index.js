// @ts-check
/**
 * R46 — ProtectedStore: the single storage boundary of the HDS-relevant blobs (Mon Coffre C09, shared-dossier files C14 / C17).
 *
 * Contract: api/lib/protected-store/CONTRACT.md (what a future certified health-data host must implement). Two drivers, chosen by ADA_PROTECTED_STORE:
 *   lab        (default)  the existing object storage of api/lib/storage.js (local filesystem in the LAB, S3-compatible bucket otherwise). NOT an HDS host.
 *   certified             api/lib/protected-store/certified-host.js — the HTTP contract of CONTRACT.md, at ADA_PROTECTED_STORE_ENDPOINT.
 *
 * Fail-closed selection (resolveProtectedStore):
 *   - in production / preview (VERCEL_ENV) NOTHING is served unless the HDS attestation token (ADA_HDS_CERTIFIED_HOSTING, api/_utils/capabilities.js) is valid;
 *   - there, the lab driver is ALWAYS refused (it is not a certified host), whatever the token says;
 *   - an unknown driver name, or a certified driver without its configuration, is refused everywhere.
 * The capability gate (citizen.vault, citizen.shared_dossier: requiresHds) already closes these features in production without the token: this is the second,
 * storage-level lock, so that no code path can put such a blob on a non-certified host by mistake.
 *
 * Callers never handle bytes in clear here: they seal before put and open after get (api/lib/data-keys.js envelope encryption). Every operation is audited
 * in the log with the driver, the operation and a hash of the key (never the key, never content).
 */
import crypto from 'node:crypto';
import { hdsAttestation } from '../../_utils/capabilities.js';
import { logger } from '../logger.js';
import { certifiedHostConfig, createCertifiedHostStore, CERTIFIED_KEY_PREFIX } from './certified-host.js';

export const PROTECTED_STORE_DRIVERS = Object.freeze(['lab', 'certified']);
export const PROTECTED_STORE_REFUSED = 'PROTECTED_STORE_REFUSED';
export const PROTECTED_STORE_REFUSED_MESSAGE = 'Le stockage protégé de ces documents n’est pas disponible sur ce service : aucun document n’a été lu ni enregistré.';

/** @typedef {{ upload: (buffer: Buffer, mimeType?: string) => Promise<string>, download: (key: string) => Promise<Buffer>, delete: (key: string) => Promise<void> }} BlobStore */
/** @typedef {{ ok: true, driver: string, hdsCertified: boolean, store: BlobStore } | { ok: false, driver: string, reason: string }} Resolution */

export class ProtectedStoreRefusedError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`${PROTECTED_STORE_REFUSED}: ${reason}`);
    this.name = 'ProtectedStoreRefusedError';
    this.code = PROTECTED_STORE_REFUSED;
    this.reason = reason;
    this.statusCode = 503;
  }
}

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
/** @param {Record<string, string | undefined>} envVars */
export const isDeployedEnvironment = (envVars) => ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());
/** @param {Record<string, string | undefined>} envVars */
export const selectedDriver = (envVars) => flag(envVars.ADA_PROTECTED_STORE).toLowerCase() || 'lab';

/** @type {BlobStore | null} */
let labStoreCache = null;
/** @returns {Promise<BlobStore>} */
async function labStore() {
  if (!labStoreCache) labStoreCache = /** @type {BlobStore} */ ((await import('../storage.js')).storage);
  return labStoreCache;
}

/**
 * Which driver may serve, in this environment (no I/O, never a value).
 * @param {Record<string, string | undefined>} [envVars] @param {Date} [now]
 * @returns {{ ok: boolean, driver: string, reason: string | null, hdsCertified: boolean }}
 */
export function protectedStoreState(envVars = process.env, now = new Date()) {
  const driver = selectedDriver(envVars);
  if (!PROTECTED_STORE_DRIVERS.includes(driver)) return { ok: false, driver, reason: 'UNKNOWN_DRIVER', hdsCertified: false };
  const deployed = isDeployedEnvironment(envVars);
  const hds = hdsAttestation(envVars, now);
  if (deployed && !hds.valid) return { ok: false, driver, reason: hds.reason || 'HDS_HOSTING_NOT_ATTESTED', hdsCertified: false };
  if (driver === 'lab') {
    if (deployed) return { ok: false, driver, reason: 'LAB_DRIVER_NOT_ALLOWED_IN_DEPLOYED_ENVIRONMENT', hdsCertified: false };
    return { ok: true, driver, reason: null, hdsCertified: false };
  }
  const cfg = certifiedHostConfig(envVars);
  if (!cfg.ok) return { ok: false, driver, reason: cfg.reason, hdsCertified: false };
  return { ok: true, driver, reason: null, hdsCertified: hds.valid };
}

/**
 * @param {Record<string, string | undefined>} [envVars]
 * @param {{ now?: Date, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<Resolution>}
 */
export async function resolveProtectedStore(envVars = process.env, opts = {}) {
  const state = protectedStoreState(envVars, opts.now);
  if (!state.ok) return { ok: false, driver: state.driver, reason: /** @type {string} */ (state.reason) };
  if (state.driver === 'lab') return { ok: true, driver: 'lab', hdsCertified: false, store: await labStore() };
  return { ok: true, driver: 'certified', hdsCertified: state.hdsCertified, store: createCertifiedHostStore(envVars, { fetchImpl: opts.fetchImpl }) };
}

/** @param {string} key */
const keyRef = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16);

/**
 * The store the services use. Same shape as api/lib/storage.js (upload / download / delete), so it replaces it where the blobs are HDS-relevant.
 * The driver is resolved on EVERY call (configuration changes and expired tokens take effect at once). A key written by the certified driver is
 * prefixed (CERTIFIED_KEY_PREFIX) and is only ever read back through it; an unprefixed key belongs to the lab driver.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, now?: () => Date }} [deps]
 * @returns {BlobStore & { state: () => ReturnType<typeof protectedStoreState> }}
 */
export function createProtectedStore(deps = {}) {
  const envOf = () => deps.env || process.env;
  /** @param {string} op @param {string | null} key */
  const resolveFor = async (op, key) => {
    const r = await resolveProtectedStore(envOf(), { fetchImpl: deps.fetchImpl, now: deps.now ? deps.now() : undefined });
    if (!r.ok) {
      logger.warn(`[ProtectedStore] ${op} refused (${r.driver}: ${r.reason})`);
      throw new ProtectedStoreRefusedError(r.reason);
    }
    // a key always goes back to the driver that wrote it: a certified key is never handed to the lab store and vice versa
    if (key !== null && String(key).startsWith(CERTIFIED_KEY_PREFIX) !== (r.driver === 'certified')) {
      logger.warn(`[ProtectedStore] ${op} refused: key ${keyRef(key)} belongs to another driver than ${r.driver}`);
      throw new ProtectedStoreRefusedError('KEY_OF_ANOTHER_DRIVER');
    }
    return r;
  };
  return {
    state: () => protectedStoreState(envOf(), deps.now ? deps.now() : undefined),
    async upload(buffer, mimeType = 'application/octet-stream') {
      const r = await resolveFor('put', null);
      const key = await r.store.upload(buffer, mimeType);
      logger.info(`[ProtectedStore] put ${r.driver} ${keyRef(key)} ${buffer.length}B`);
      return key;
    },
    async download(key) {
      const r = await resolveFor('get', key);
      const bytes = await r.store.download(key);
      logger.info(`[ProtectedStore] get ${r.driver} ${keyRef(key)}`);
      return bytes;
    },
    /**
     * Erasure is never blocked by the HDS gate (a person's deletion must work even when reads and writes are closed): the key's own driver deletes it —
     * an unprefixed key through the object storage it was written to, a certified key through the certified client when it is configured.
     */
    async delete(key) {
      const certified = String(key).startsWith(CERTIFIED_KEY_PREFIX);
      if (certified && !certifiedHostConfig(envOf()).ok) {
        logger.warn(`[ProtectedStore] delete refused: key ${keyRef(key)} needs the certified host configuration`);
        throw new ProtectedStoreRefusedError('CERTIFIED_HOST_NOT_CONFIGURED_FOR_ERASURE');
      }
      const store = certified ? createCertifiedHostStore(envOf(), { fetchImpl: deps.fetchImpl }) : await labStore();
      await store.delete(key);
      logger.info(`[ProtectedStore] delete ${certified ? 'certified' : 'lab'} ${keyRef(key)}`);
    },
  };
}

/** the process-wide instance (reads process.env on each call) */
export const protectedStore = createProtectedStore();

/** the refusal as a service result (no data) */
export const protectedStoreRefusal = () => ({ ok: false, status: 503, code: PROTECTED_STORE_REFUSED, message: PROTECTED_STORE_REFUSED_MESSAGE });

/** status line for the readiness doctor / admin (never a secret, never an endpoint value) @param {Record<string, string | undefined>} [envVars] */
export function protectedStoreStatus(envVars = process.env) {
  const s = protectedStoreState(envVars);
  return { driver: s.driver, available: s.ok, reason: s.reason, hdsCertified: s.hdsCertified, deployed: isDeployedEnvironment(envVars) };
}
