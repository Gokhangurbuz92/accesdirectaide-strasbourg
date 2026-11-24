// @ts-check
/**
 * G14-R3 — the main (non-HDS) API signs a short-lived, single-use ES256 ticket so the browser can call the HDS service directly
 * (CONTROL/master/G14_HDS_MIGRATION_PLAN.md § 4). The ticket carries identifiers and capability names only — never a document, a file name, a dossier
 * content, an e-mail address or a session secret. The HDS service verifies it with the PUBLIC key (services/hds/src/ticket.js); JWT_SECRET is never shared.
 *
 *   HDS_TICKET_PRIVATE_KEY   base64 PKCS#8 DER of a P-256 key (Vercel only; scripts/hds-keygen.mjs)
 *   HDS_TICKET_KID           key id announced in the header (the HDS side lists "<kid>:<public key>")
 */
import crypto from 'node:crypto';

export const HDS_TICKET_TTL_SEC = 60;
export const HDS_TICKET_ISSUER = 'ada-main';
export const HDS_TICKET_AUDIENCE = 'ada-hds';
/** the only claims a ticket may carry (the HDS service refuses any other) */
export const HDS_TICKET_CLAIMS = Object.freeze(['iss', 'aud', 'sub', 'typ', 'caps', 'str', 'role', 'jti', 'iat', 'nbf', 'exp']);

/** @param {Buffer | string} b */
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @param {string | undefined} raw @returns {crypto.KeyObject | null} */
export function parseTicketPrivateKey(raw) {
  const v = String(raw || '').trim();
  if (!v || !/^[A-Za-z0-9+/=\s]+$/.test(v)) return null;
  try {
    const key = crypto.createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
  } catch { return null; }
}

export const TICKET_KID_FORMAT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * @param {{ sub: string, typ: 'citizen' | 'pro' | 'system', caps: string[], str?: string, role?: string }} who
 * @param {{ privateKey: crypto.KeyObject, kid: string, now?: number, ttlSec?: number }} o
 * @returns {{ ticket: string, expiresAt: string, jti: string }}
 */
export function signHdsTicket(who, o) {
  const iat = Math.floor((o.now ?? Date.now()) / 1000);
  const ttl = Math.min(120, Math.max(10, o.ttlSec ?? HDS_TICKET_TTL_SEC));
  const jti = crypto.randomBytes(18).toString('base64url');
  /** @type {Record<string, unknown>} */
  const claims = { iss: HDS_TICKET_ISSUER, aud: HDS_TICKET_AUDIENCE, sub: String(who.sub), typ: who.typ, caps: [...who.caps], jti, iat, exp: iat + ttl };
  if (who.str) claims.str = String(who.str);
  if (who.role) claims.role = String(who.role);
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: o.kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: o.privateKey, dsaEncoding: 'ieee-p1363' });
  return { ticket: `${head}.${body}.${b64url(sig)}`, expiresAt: new Date((iat + ttl) * 1000).toISOString(), jti };
}

/** a P-256 key pair in the formats the two sides expect (key generation script and tests) */
export function generateTicketKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyB64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKeyB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}
