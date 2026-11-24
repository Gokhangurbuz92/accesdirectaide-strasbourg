// @ts-check
/**
 * G14-R4 — the keys unlocked in THIS page (memory only: never in localStorage, sessionStorage, IndexedDB, a cookie or a request). A reload forgets them.
 *   citizen: the Mon Coffre vault key (unlocked with the passphrase) and the person's receiving key (box key, wrapped by the vault key)
 *   professional: the member's own private key (unlocked with their passphrase) and the organisation private keys it opens, by kid
 * All are non-extractable CryptoKeys.
 */
/** @type {{ vaultKey: CryptoKey | null, boxKey: CryptoKey | null, memberKey: CryptoKey | null, orgKeys: Map<string, CryptoKey>, listeners: Set<() => void> }} */
const state = { vaultKey: null, boxKey: null, memberKey: null, orgKeys: new Map(), listeners: new Set() };
const emit = () => { for (const l of state.listeners) l(); };

export const getVaultKey = () => state.vaultKey;
/** @param {CryptoKey | null} k */
export const setVaultKey = (k) => { state.vaultKey = k; if (!k) state.boxKey = null; emit(); };
export const getBoxKey = () => state.boxKey;
/** @param {CryptoKey | null} k */
export const setBoxKey = (k) => { state.boxKey = k; emit(); };
export const getMemberKey = () => state.memberKey;
/** @param {CryptoKey | null} k */
export const setMemberKey = (k) => { state.memberKey = k; if (!k) state.orgKeys.clear(); emit(); };
/** @param {string} kid */
export const getOrgKey = (kid) => state.orgKeys.get(kid) || null;
/** @param {string} kid @param {CryptoKey} k */
export const setOrgKey = (kid, k) => { state.orgKeys.set(kid, k); emit(); };
/** forget every key (sign-out, « verrouiller ») */
export const lockAll = () => { state.vaultKey = null; state.boxKey = null; state.memberKey = null; state.orgKeys.clear(); emit(); };
/** @param {() => void} fn */
export const subscribeKeys = (fn) => { state.listeners.add(fn); return () => { state.listeners.delete(fn); }; };
