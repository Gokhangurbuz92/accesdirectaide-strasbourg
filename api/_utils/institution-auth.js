// @ts-nocheck
/**
 * PKG-5 / I01 — institutional sessions (collectivité, partners). A SEPARATE token family: own audience and a key derived for this purpose only, so no
 * administrator, professional or citizen verifier accepts it, and it accepts none of theirs. It opens aggregate statistics only (institution/*); no dossier,
 * case, Coffre, share or booking handler knows this token. Every request re-reads the account: ACTIVE and its agreement SIGNED (not ended), the password the
 * token was issued under (R21) and the last server logout.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { signJwt, verifyJwt, getBearerToken } from './auth.js';
import { env } from './env.js';
import { db as defaultDb } from '../../src/db/index.js';

const ISSUER = 'accesdirectaide'; const AUDIENCE = 'accesdirectaide-institution';
function key() {
  const base = env.auth.secret || env.secrets.jwtSecret;
  if (!base) throw new Error('Missing auth signing secret');
  return crypto.createHmac('sha256', String(base)).update('ada-institution-session-v1').digest('hex');
}
/** An institutional session lives 8 hours. */
export const INSTITUTION_SESSION_SECONDS = 8 * 3600;
/**
 * R21 — a password the partner has not chosen (the initial one, or one an administrator handed over for a lost password) is stored with this prefix in front
 * of its hash, like UNSET_PASSWORD_PREFIX for citizens: it signs in, and the space asks for a personal password before showing anything else.
 */
export const TEMPORARY_PASSWORD_PREFIX = 'temporary:';
export const isTemporaryPassword = (/** @type {unknown} */ h) => String(h || '').startsWith(TEMPORARY_PASSWORD_PREFIX);
export const storedHash = (/** @type {unknown} */ h) => String(h || '').slice(isTemporaryPassword(h) ? TEMPORARY_PASSWORD_PREFIX.length : 0);
/**
 * R21 — every token carries a fingerprint of the account's password hash (never the hash itself): changing or resetting the password ends every other session
 * at once (no column, no lookup), the session that changed it receives a new token. A token without a fingerprint (issued before R21) is refused.
 */
const fingerprint = (/** @type {unknown} */ passwordHash) => crypto.createHmac('sha256', key()).update(`pw:${String(passwordHash || '')}`).digest('hex').slice(0, 32);
export function signInstitutionToken({ id, email, passwordHash }) {
  return signJwt({ scope: 'institution', sub: String(id), email: String(email), pwf: fingerprint(passwordHash), iat_ms: Date.now() }, key(), { algorithm: 'HS256', expiresIn: INSTITUTION_SESSION_SECONDS, issuer: ISSUER, audience: AUDIENCE });
}
/**
 * R21 — server-side logout: a session issued before the account's last INSTITUTION_LOGOUT journal entry is refused. The journal is the record (PostgreSQL, no
 * schema change; kept far longer than a session's 8 h, so its purge can never revive a token); no KV on the authentication path: an unavailable KV used to
 * make every institutional request fail.
 */
const lastLogout = sql`(SELECT max(l.timestamp) FROM "AuditLog" l WHERE l.action = 'INSTITUTION_LOGOUT' AND l.entity = 'InstitutionAccount' AND l.entity_id = i.id)`;
export async function resolveInstitution(req, db = defaultDb) {
  const token = getBearerToken(req); if (!token) return null;
  let d; try { d = verifyJwt(token, key(), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }); } catch { return null; }
  if (!d || d.scope !== 'institution' || !d.sub || typeof d.pwf !== 'string') return null;
  const [a] = (await db.execute(sql`SELECT i.id, i.email, i."organisationName", i.territory, i."passwordHash" AS h, ${lastLogout} AS "loggedOutAt" FROM "InstitutionAccount" i JOIN "PartnerAgreement" g ON g.id = i."agreementId"
    WHERE i.id = ${String(d.sub)} AND i.status = 'ACTIVE' AND g.status = 'SIGNED' AND g."endedAt" IS NULL LIMIT 1`)).rows;
  if (!a) return null;
  const want = Buffer.from(fingerprint(a.h)); const got = Buffer.from(String(d.pwf));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (a.loggedOutAt && !(Number(d.iat_ms) > new Date(a.loggedOutAt).getTime())) return null;
  return { id: a.id, email: a.email, organisation: a.organisationName, territory: a.territory, temporaryPassword: isTemporaryPassword(a.h), authType: 'institution_jwt' };
}
