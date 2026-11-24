// @ts-check
/**
 * G14-R4 — END-TO-END encryption of shared dossiers, organisation keys and message attachments (WebCrypto only; runs in the browser and in Node ≥ 22).
 * Nothing here talks to the network. The HDS service only ever receives the boxes and public keys produced here (services/hds/src/sharing.js).
 *
 *   dossier key   32 random bytes per dossier. The content, each thread message key and each file key are encrypted with it. Kept by the owner only
 *                 wrapped by their Mon Coffre vault key (`ownerKey`), and by each recipient organisation only wrapped to its public key (ECIES below).
 *   ECIES         ephemeral ECDH P-256 with the recipient's public key → HKDF-SHA-256 (info « ada-hds-ecies/v1 », the kid and the ephemeral key bound in
 *                 the AES-GCM additional data) → AES-256-GCM. Envelope { v: 1, kid?, epk, iv, ct }.
 *   organisation  an ECDH P-256 pair generated in an administrator's browser; its private JWK exists only wrapped (ECIES) for each member's own key pair,
 *                 whose private JWK exists only wrapped by that member's passphrase (PBKDF2-SHA-256, 600 000 iterations — as Mon Coffre).
 *   person's box  an ECDH P-256 pair whose private JWK is wrapped by the vault key: an organisation can encrypt FOR the person (attachments).
 *   re-key        after a revocation: a NEW dossier key; content re-encrypted; file and message keys re-wrapped (their bytes are not re-encrypted: a file key
 *                 never left the people who could already read it); every remaining organisation receives the new key.
 */
import { checkVerifier, decryptBytes, decryptJson, deriveKey, encryptBytes, encryptJson, KDF_ITERATIONS, makeVerifier, randomBytes, toB64, fromB64 } from './passeport/crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
/** @returns {SubtleCrypto} */
const subtle = () => /** @type {any} */ (globalThis).crypto.subtle;
/** @param {Uint8Array} b @returns {BufferSource} */
const bs = (b) => /** @type {BufferSource} */ (/** @type {unknown} */ (b));
/** @param {Uint8Array} raw @returns {Promise<CryptoKey>} */
const importAes = (raw) => subtle().importKey('raw', bs(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
export const ECIES_INFO = 'ada-hds-ecies/v1';

/** @param {any} jwk */
export const publicJwkOf = (jwk) => ({ kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) });
/** @param {any} jwk @returns {Promise<CryptoKey>} */
const importPublic = (jwk) => subtle().importKey('jwk', publicJwkOf(jwk), ECDH, true, []);
/** a NON-extractable private key from its JWK @param {any} jwk @returns {Promise<CryptoKey>} */
export const importPrivateJwk = (jwk) => subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, ECDH, false, ['deriveBits']);

/** a fresh ECDH P-256 pair: the public JWK and the private JWK (the caller wraps it at once and drops it) */
export async function generatePair() {
  const kp = /** @type {CryptoKeyPair} */ (await subtle().generateKey(ECDH, true, ['deriveBits']));
  const priv = await subtle().exportKey('jwk', kp.privateKey);
  return { publicJwk: publicJwkOf(await subtle().exportKey('jwk', kp.publicKey)), privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d } };
}

/** @param {CryptoKey} privateKey @param {CryptoKey} publicKey @param {string} aadText @returns {Promise<CryptoKey>} */
async function eciesKey(privateKey, publicKey, aadText) {
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
  const base = await subtle().importKey('raw', bs(shared), 'HKDF', false, ['deriveKey']);
  shared.fill(0);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bs(new Uint8Array(32)), info: bs(enc.encode(`${ECIES_INFO}|${aadText}`)) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** @param {any} epk @param {string | undefined} kid */
const eciesAad = (epk, kid) => `${kid || '-'}|${epk.x}.${epk.y}`;

/**
 * encrypt bytes FOR the holder of a public key
 * @param {any} recipientPublicJwk @param {Uint8Array} bytes @param {string} [kid]
 * @returns {Promise<{ v: 1, kid?: string, epk: any, iv: string, ct: string }>}
 */
export async function sealFor(recipientPublicJwk, bytes, kid) {
  const eph = /** @type {CryptoKeyPair} */ (await subtle().generateKey(ECDH, true, ['deriveBits']));
  const epk = publicJwkOf(await subtle().exportKey('jwk', eph.publicKey));
  const aad = eciesAad(epk, kid);
  const key = await eciesKey(eph.privateKey, await importPublic(recipientPublicJwk), aad);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: bs(iv), additionalData: bs(enc.encode(aad)) }, key, bs(bytes)));
  return { v: 1, ...(kid ? { kid } : {}), epk, iv: toB64(iv), ct: toB64(ct) };
}

/** open an ECIES envelope with the matching private key (throws with a wrong key or altered data) @param {CryptoKey} privateKey @param {any} env @returns {Promise<Uint8Array>} */
export async function openFrom(privateKey, env) {
  const aad = eciesAad(env.epk, env.kid);
  const key = await eciesKey(privateKey, await importPublic(env.epk), aad);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bs(fromB64(env.iv)), additionalData: bs(enc.encode(aad)) }, key, bs(fromB64(env.ct))));
}

// ───────────── dossiers
/** @returns {Promise<{ raw: Uint8Array, key: CryptoKey }>} */
export async function newDossierKey() { const raw = randomBytes(32); return { raw, key: await importAes(raw) }; }

/** a new dossier: its content box and the owner's copy of its key @param {CryptoKey} vaultKey @param {unknown} content */
export async function createDossier(vaultKey, content) {
  const k = await newDossierKey();
  return { body: { content: await encryptJson(k.key, content), ownerKey: await encryptBytes(vaultKey, k.raw) }, raw: k.raw, key: k.key };
}
/** the dossier key from the owner's copy @param {CryptoKey} vaultKey @param {{ iv: string, ct: string }} ownerKey */
export async function openOwnerKey(vaultKey, ownerKey) { const raw = await decryptBytes(vaultKey, ownerKey); return { raw, key: await importAes(raw) }; }
/** the dossier key from an organisation's wrapped copy @param {CryptoKey} orgPrivateKey @param {any} wrappedKey */
export async function openGrantKey(orgPrivateKey, wrappedKey) { const raw = await openFrom(orgPrivateKey, wrappedKey); return { raw, key: await importAes(raw) }; }
/** the dossier key wrapped for an organisation's CURRENT public key @param {Uint8Array} raw @param {{ kid: string, publicJwk: any }} org */
export const wrapForOrg = (raw, org) => sealFor(org.publicJwk, raw, org.kid);
/** @param {CryptoKey} key @param {unknown} value */
export const encryptContent = (key, value) => encryptJson(key, value);
/** @param {CryptoKey} key @param {{ iv: string, ct: string }} box */
export const decryptContent = (key, box) => decryptJson(key, box);

/** a thread message / referral note: its own key wrapped by the dossier key @param {CryptoKey} dossierKey @param {string} text */
export async function encryptMessage(dossierKey, text) {
  const raw = randomBytes(32); const k = await importAes(raw);
  const out = { dek: await encryptBytes(dossierKey, raw), body: await encryptBytes(k, enc.encode(String(text))) };
  raw.fill(0);
  return out;
}
/** @param {CryptoKey} dossierKey @param {{ dek: any, body: any }} m */
export async function decryptMessage(dossierKey, m) {
  const raw = await decryptBytes(dossierKey, m.dek); const k = await importAes(raw); raw.fill(0);
  return dec.decode(await decryptBytes(k, m.body));
}

/**
 * the atomic re-key payload after a revocation
 * @param {{ vaultKey: CryptoKey, oldKey: CryptoKey, dossier: { keyEpoch: number, content: any, files: { id: string, dek: any }[] }, messages: { id: string, dek: any }[], orgs: { structureId: string, kid: string, publicJwk: any }[] }} a
 */
export async function rekeyPayload(a) {
  const content = await decryptJson(a.oldKey, a.dossier.content);
  const next = await newDossierKey();
  const rewrap = async (/** @type {any} */ box) => { const raw = await decryptBytes(a.oldKey, box); const out = await encryptBytes(next.key, raw); raw.fill(0); return out; };
  const payload = {
    fromEpoch: a.dossier.keyEpoch,
    content: await encryptJson(next.key, content),
    ownerKey: await encryptBytes(a.vaultKey, next.raw),
    files: await Promise.all(a.dossier.files.map(async (f) => ({ id: f.id, dek: await rewrap(f.dek) }))),
    messages: await Promise.all(a.messages.map(async (m) => ({ id: m.id, dek: await rewrap(m.dek) }))),
    grants: await Promise.all(a.orgs.map(async (o) => ({ structureId: o.structureId, wrappedKey: await wrapForOrg(next.raw, o) }))),
  };
  return { payload, raw: next.raw, key: next.key };
}

// ───────────── a professional's own key and the organisation key
/** @param {string} passphrase @param {number} [iterations] */
export async function createMemberKeyring(passphrase, iterations = KDF_ITERATIONS) {
  const pair = await generatePair();
  const salt = randomBytes(16);
  const kek = await deriveKey(passphrase, salt, iterations);
  const keyring = { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), wrapped: await encryptJson(kek, pair.privateJwk), verifier: await makeVerifier(kek) };
  return { keyring, publicJwk: pair.publicJwk, privateKey: await importPrivateJwk(pair.privateJwk) };
}
/** null = wrong passphrase @param {any} keyring @param {string} passphrase @returns {Promise<CryptoKey | null>} */
export async function unlockMemberKeyring(keyring, passphrase) {
  const kek = await deriveKey(passphrase, fromB64(keyring.salt), keyring.iterations);
  if (!(await checkVerifier(kek, keyring.verifier))) return null;
  return importPrivateJwk(await decryptJson(kek, keyring.wrapped));
}

/** a new organisation key, wrapped for each member's public key @param {{ memberRef: string, publicJwk: any }[]} members */
export async function createOrgKey(members) {
  const pair = await generatePair();
  const kid = `k${Date.now().toString(36)}${toB64(randomBytes(4)).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40);
  const bytes = enc.encode(JSON.stringify(pair.privateJwk));
  const wraps = await Promise.all(members.map(async (m) => ({ memberRef: m.memberRef, kid, wrappedPrivate: await sealFor(m.publicJwk, bytes, kid) })));
  bytes.fill(0);
  return { kid, publicJwk: pair.publicJwk, wraps, privateJwk: pair.privateJwk };
}
/** the organisation private JWK from a member's wrap @param {CryptoKey} memberPrivateKey @param {any} wrappedPrivate */
export async function openOrgPrivateJwk(memberPrivateKey, wrappedPrivate) { return JSON.parse(dec.decode(await openFrom(memberPrivateKey, wrappedPrivate))); }
/** an administrator wraps an organisation private key (kid) for one more member @param {any} orgPrivateJwk @param {string} kid @param {any} memberPublicJwk */
export const wrapOrgPrivateFor = (orgPrivateJwk, kid, memberPublicJwk) => sealFor(memberPublicJwk, enc.encode(JSON.stringify(orgPrivateJwk)), kid);

// ───────────── the person's receiving key (wrapped by the vault key)
/** @param {CryptoKey} vaultKey */
export async function createBoxKey(vaultKey) {
  const pair = await generatePair();
  return { publicJwk: pair.publicJwk, privateWrapped: await encryptJson(vaultKey, pair.privateJwk), privateKey: await importPrivateJwk(pair.privateJwk) };
}
/** @param {CryptoKey} vaultKey @param {{ iv: string, ct: string }} privateWrapped */
export async function openBoxKey(vaultKey, privateWrapped) { return importPrivateJwk(await decryptJson(vaultKey, privateWrapped)); }

// ───────────── attachments: one file key, wrapped for the person AND for the organisation
/**
 * @param {{ bytes: Uint8Array, name: string, type: string }} file
 * @param {{ citizen: { publicJwk: any }, org: { kid: string, publicJwk: any } }} keys
 */
export async function encryptAttachment(file, keys) {
  const raw = randomBytes(32); const k = await importAes(raw);
  const out = { content: await encryptBytes(k, file.bytes), meta: await encryptJson(k, { name: file.name, type: file.type }),
    keyCitizen: await sealFor(keys.citizen.publicJwk, raw), keyOrg: await sealFor(keys.org.publicJwk, raw, keys.org.kid) };
  raw.fill(0);
  return out;
}
/** @param {CryptoKey} privateKey the person's box key, or the organisation's key @param {{ content: any, meta: any, key: any }} a */
export async function decryptAttachment(privateKey, a) {
  const raw = await openFrom(privateKey, a.key); const k = await importAes(raw); raw.fill(0);
  const meta = await decryptJson(k, a.meta);
  return { bytes: await decryptBytes(k, a.content), name: String(meta.name || 'piece-jointe'), type: String(meta.type || 'application/octet-stream') };
}
