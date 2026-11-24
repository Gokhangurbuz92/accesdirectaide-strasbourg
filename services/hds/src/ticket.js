// @ts-check
/**
 * G14-R3 — verification of the short-lived ES256 ticket issued by the main (non-HDS) API (api/lib/hds-ticket.js).
 *
 * The HDS service holds PUBLIC keys only (HDS_TICKET_PUBLIC_KEYS = "<kid>:<base64 SPKI DER>,…"): it can check a ticket, never forge one, and it never
 * shares a secret with the main application (the main session secret JWT_SECRET stays on Vercel). Pinned: alg ES256 (no "none", no HS*), kid known,
 * iss, aud, a lifetime of at most maxTtlSec, a clock skew of at most skewSec. Single use (replay protection) is enforced by the caller with the jti
 * (table hds.ticket_use), because it needs the database.
 */
import crypto from 'node:crypto';

export const TICKET_TYPES = Object.freeze(['citizen', 'pro', 'system']);
export const TICKET_CLAIMS = Object.freeze(['iss', 'aud', 'sub', 'typ', 'caps', 'str', 'role', 'obj', 'jti', 'iat', 'nbf', 'exp']);

/** @param {string} s */
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** @param {string | undefined} raw @returns {Map<string, crypto.KeyObject>} */
export function parsePublicKeys(raw) {
  const out = new Map();
  for (const part of String(raw || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const kid = i > 0 ? part.slice(0, i) : '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(kid)) throw new Error('HDS_TICKET_PUBLIC_KEYS_MALFORMED');
    const key = crypto.createPublicKey({ key: Buffer.from(part.slice(i + 1), 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('HDS_TICKET_PUBLIC_KEY_NOT_P256');
    out.set(kid, key);
  }
  if (!out.size) throw new Error('HDS_TICKET_PUBLIC_KEYS_ABSENT');
  return out;
}

/**
 * @param {string} token
 * @param {{ keys: Map<string, crypto.KeyObject>, issuer: string, audience: string, now?: number, maxTtlSec?: number, skewSec?: number }} o
 * @returns {{ ok: true, claims: any } | { ok: false, reason: string }}
 */
export function verifyTicket(token, o) {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const maxTtl = o.maxTtlSec ?? 120; const skew = o.skewSec ?? 30;
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)) || token.length > 4096) return { ok: false, reason: 'TICKET_MALFORMED' };
  let header; let claims;
  try { header = JSON.parse(b64urlDecode(parts[0]).toString('utf8')); claims = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); } catch { return { ok: false, reason: 'TICKET_MALFORMED' }; }
  if (!header || header.alg !== 'ES256' || (header.typ !== undefined && header.typ !== 'JWT')) return { ok: false, reason: 'TICKET_ALG' };
  const key = o.keys.get(String(header.kid || ''));
  if (!key) return { ok: false, reason: 'TICKET_KID_UNKNOWN' };
  const sig = b64urlDecode(parts[2]);
  if (sig.length !== 64) return { ok: false, reason: 'TICKET_SIGNATURE' };
  const valid = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, sig);
  if (!valid) return { ok: false, reason: 'TICKET_SIGNATURE' };
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { ok: false, reason: 'TICKET_CLAIMS' };
  if (Object.keys(claims).some((k) => !TICKET_CLAIMS.includes(k))) return { ok: false, reason: 'TICKET_CLAIMS' };   // a closed claim set: nothing else rides along
  if (claims.iss !== o.issuer) return { ok: false, reason: 'TICKET_ISSUER' };
  if (claims.aud !== o.audience) return { ok: false, reason: 'TICKET_AUDIENCE' };
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(claims.sub)) return { ok: false, reason: 'TICKET_SUBJECT' };
  if (!TICKET_TYPES.includes(claims.typ)) return { ok: false, reason: 'TICKET_TYPE' };
  if (!Array.isArray(claims.caps) || claims.caps.length > 8 || claims.caps.some((/** @type {unknown} */ c) => typeof c !== 'string')) return { ok: false, reason: 'TICKET_CAPS' };
  if (typeof claims.jti !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(claims.jti)) return { ok: false, reason: 'TICKET_JTI' };
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return { ok: false, reason: 'TICKET_TIME' };
  if (claims.exp - claims.iat > maxTtl || claims.exp <= claims.iat) return { ok: false, reason: 'TICKET_TTL' };
  if (claims.iat > now + skew || (Number.isInteger(claims.nbf) && claims.nbf > now + skew)) return { ok: false, reason: 'TICKET_NOT_YET_VALID' };
  if (claims.exp < now - skew) return { ok: false, reason: 'TICKET_EXPIRED' };
  if (claims.str !== undefined && (typeof claims.str !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.str))) return { ok: false, reason: 'TICKET_STRUCTURE' };
  if (claims.typ === 'pro' && !claims.str) return { ok: false, reason: 'TICKET_STRUCTURE' };
  // G14-R4: role (closed list) and the object binding of an attachment ticket (rdvconv:<conversation>:<citizen>:<structure>)
  if (claims.role !== undefined && !['PRO', 'STRUCTURE_ADMIN'].includes(claims.role)) return { ok: false, reason: 'TICKET_ROLE' };
  if (claims.obj !== undefined && (typeof claims.obj !== 'string' || !/^rdvconv:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_-]{1,64}$/.test(claims.obj))) return { ok: false, reason: 'TICKET_OBJECT' };
  return { ok: true, claims };
}
