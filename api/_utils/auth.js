// @ts-nocheck
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import logger from './logger.js';
import { db } from '../../src/db/index.js';
import { AdminUser, AuditLog, AuthToken } from '../../src/db/schema.js';
import { checkRateLimit as checkRateLimitUtil } from './rateLimit.js';
import { eq, and, sql } from 'drizzle-orm';

const ADMIN_SESSION_ISSUER = 'accesdirectaide';
const ADMIN_SESSION_AUDIENCE = 'accesdirectaide-admin';
const PRO_SESSION_ISSUER = 'accesdirectaide';
const PRO_SESSION_AUDIENCE = 'accesdirectaide-pro';

export const AUTH_ROLE = {
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
  STRUCTURE_ADMIN: 'structure_admin',
  PRO: 'pro',
  USER: 'user',
};

export const ROLE = {
    SUPERADMIN: 'SUPERADMIN',
    STRUCTURE_ADMIN: 'STRUCTURE_ADMIN',
    PRO: 'PRO'
};

const NO_STORE_VALUE = 'private, no-store, max-age=0, must-revalidate';

function getJwtSecret() {
    return env.secrets.jwtSecret;
}

export function signJwt(/** @type {Record<string, string | number | boolean | null | undefined>} */ payload, /** @type {string | number | boolean | null | undefined} */ secret, options = {}) {
    return jwt.sign(payload, secret, options);
}

/**
 * @param {string} token
 * @param {string} secret
 */
export function verifyJwt(token, secret, options = {}) {
    return jwt.verify(token, secret, options);
}

/**
* @param {{ id: any; email?: any; structureId?: any; role: any; }} user
*/
/** @param {any} user @param {{ mfa?: boolean }} [opts] mfa: the session passed the second factor (set by mfa-verify / mfa-setup, kept by refresh) */
export function signProToken(user, opts = {}) {
    const JWT_SECRET = getJwtSecret();
    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET is missing");
    }

    const jti = crypto.randomUUID();

    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            structureId: user.structureId,
            role: user.role,
            scope: 'pro',
            jti,
            ...(opts.mfa === true ? { mfa: true } : {}),
        },
        JWT_SECRET,
        {
            expiresIn: '8h',
            issuer: PRO_SESSION_ISSUER,
            audience: PRO_SESSION_AUDIENCE,
            algorithm: 'HS256',
        }
    );
}

/**
 * @param {string} token
 */
export function verifyProToken(token) {
    const JWT_SECRET = getJwtSecret();
    if (!JWT_SECRET) return null;

    try {
        const strictDecoded = jwt.verify(token, JWT_SECRET, {
            algorithms: ['HS256'],
            issuer: PRO_SESSION_ISSUER,
            audience: PRO_SESSION_AUDIENCE,
        });
        return validateProClaims(strictDecoded);
    } catch {
        try {
            const legacyDecoded = jwt.verify(token, JWT_SECRET, {
                algorithms: ['HS256'],
            });
            return validateProClaims(legacyDecoded);
        } catch {
            return null;
        }
    }
}

function validateProClaims(/** @type {string | number | boolean | null | undefined} */ decoded) {
    if (!decoded || typeof decoded !== 'object') return null;

    const payload = /** @type {Record<string, any>} */ (decoded);
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    const userId = String(payload.userId || '').trim();
    const structureId = String(payload.structureId || '').trim();
    const roleRaw = String(payload.role || '').toUpperCase();

    if (scope && scope !== 'pro') return null;
    if (!userId || !structureId) return null;
    if (![ROLE.PRO, ROLE.STRUCTURE_ADMIN, ROLE.SUPERADMIN].includes(roleRaw)) return null;

    return {
        userId,
        structureId,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        role: roleRaw,
        scope: scope || undefined,
        iat: typeof payload.iat === 'number' ? payload.iat : undefined,   // issue time: a session revoked after it is refused (sessionsValidAfter)
        mfa: payload.mfa === true,
    };
}

/**
 * R34 (R33 audit G4): professionals read social and possibly health data, so in PRODUCTION every ADA Pro route needs a session that passed the second factor —
 * deny by default; only signing in, the account summary and setting up the second factor are open to a password-only session. Outside production it is
 * opt-in (PRO_MFA_REQUIRED=true), so LAB journeys and tests keep their password-only sessions. There is no switch to turn it off in production.
 */
export const PRO_MFA_OPEN_ROUTES = Object.freeze([/^\/api\/pro\/auth\//, /^\/api\/pro\/mfa-setup\/?$/, /^\/api\/pro\/me\/?$/]);
export function proMfaRequired() {
    return process.env.VERCEL_ENV === 'production' || process.env.PRO_MFA_REQUIRED === 'true';
}
/** @param {string} url */
export function proRouteNeedsMfa(url) {
    const p = String(url || '').split('?')[0];
    return !PRO_MFA_OPEN_ROUTES.some((re) => re.test(p));
}

export async function checkRateLimit(/** @type {string | number | boolean | null | undefined} */ identifier) {
    const result = await checkRateLimitUtil('LOGIN_PRO', identifier);
    if (!result.allowed) {
        return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: 1 };
}

/**
 * @param {crypto.BinaryLike} ip
 */
function hashIp(ip) {
    if (!ip) return 'unknown';
    return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
* @param {string | null} ip
*/
export async function logProAudit(/** @type {string} */ action, /** @type {string} */ actorId, /** @type {string | number | boolean | null | undefined} */ structureId, /** @type {Record<string, string | number | boolean | null | undefined>} */ details, ip) {
    try {
        await db.insert(AuditLog).values({
            action,
            actor_id: actorId, 
            actor: actorId, 
            entity: 'ProUser', 
            details: { ...details, structureId },
            ip,
            ip_hash: hashIp(ip)
        });
    } catch (e) {
        logger.error("Audit Log Error", e);
    }
}

/**
 * Revoke a pro JWT by storing its jti in the AuthToken table.
 * @param {string} jti - JWT ID to revoke
 * @param {string} userId - User who owns the token
 * @param {number} exp - Token expiration timestamp (unix seconds)
 */
export async function revokeProToken(jti, userId, exp) {
    // PKG-11 audit: this per-token helper was never called and could not work (AuthToken.userId references CitizenUser, not ProUser). Revocation of a
    // professional session is account-level: revokeProSessions(). Kept as a delegate so no caller can silently rely on a no-op.
    void exp; if (userId) return revokeProSessions(userId);
    if (!jti) return;
    try {
        const tokenHash = crypto.createHash('sha256').update(jti).digest('hex');
        await db.insert(AuthToken).values({
            userId,
            type: 'revoked_pro',
            tokenHash,
            expiresAt: new Date(exp * 1000),
        }).onConflictDoNothing();
        logger.info('[Auth] Token revoked', { jti: jti.slice(0, 8) });
    } catch (e) {
        logger.error('[Auth] Token revocation failed', e);
    }
}

/**
 * Check if a JWT has been revoked.
 * @param {string} jti - JWT ID to check
 * @returns {Promise<boolean>} true if revoked
 */
export async function isTokenRevoked(jti) {
    if (!jti) return false;
    try {
        const tokenHash = crypto.createHash('sha256').update(jti).digest('hex');
        const found = await db.query.AuthToken.findFirst({
            where: and(eq(AuthToken.tokenHash, tokenHash), eq(AuthToken.type, 'revoked_pro')),
        });
        return !!found;
    } catch (err) {
        logger.error('[Auth] Token revocation check failed — failing closed', { error: err?.message });
        return true; // Fail-closed: if DB is down, treat as revoked for safety
    }
}

export function getBearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = String(match[1] || '').trim();
  return token || null;
}

/**
 * @param {string} left
 * @param {string} right
 */
function timingSafeEquals(left, right) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

/**
 * @param {string} token
 */
function verifyLegacyAdminToken(token) {
  // PKG-5 / A01: the shared ADMIN_TOKEN is RETIRED. A value with this name was found in the public repository history, and a shared secret is not a named person
  // with MFA. It is refused everywhere except the frozen RC4 test suites (NODE_ENV=test) or an explicit, non-production opt-in (ADA_ALLOW_LEGACY_ADMIN_TOKEN=1).
  if (!legacyAdminTokenAllowed()) return false;
  const adminToken = env.secrets.adminToken;
  if (!token || !adminToken) return false;
  return timingSafeEquals(token, adminToken);
}
export function legacyAdminTokenAllowed() {
  if (env.runtime.vercelEnv === 'production' || process.env.NODE_ENV === 'production') return false;
  return process.env.NODE_ENV === 'test' || process.env.ADA_ALLOW_LEGACY_ADMIN_TOKEN === '1';
}

function getAdminSessionSecret() {
  return env.auth.secret || env.secrets.jwtSecret;
}

export function signAdminSessionToken(payload = {}) {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error('Missing admin auth signing secret (AUTH_SECRET/AUTH_JWT_SECRET/JWT_SECRET)');
  }

  const role = payload.role || AUTH_ROLE.ADMIN;
  const email = payload.email || env.secrets.adminEmail || 'admin@accesdirectaide.fr';
  const mfa_verified = payload.mfa_verified === true;
  // PKG-5 / A16: just-in-time elevation (JIT or BREAK_GLASS) is a short-lived claim inside the session; it never outlives elev_until and never grants dossier access.
  const elevation = mfa_verified && payload.elev_until && payload.elev_kind ? { elev_until: Number(payload.elev_until), elev_kind: String(payload.elev_kind), elev_id: String(payload.elev_id || '') } : {};

  return signJwt(
    {
      scope: 'admin',
      role,
      email,
      mfa_verified,
      ...elevation,
      iat_ms: Date.now(),   // PKG-11 / ADM-10: issue time to the millisecond, compared with AdminUser.sessionsValidAfter
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: '8h',
      issuer: ADMIN_SESSION_ISSUER,
      audience: ADMIN_SESSION_AUDIENCE,
    },
  );
}

/**
 * @param {string} token
 */
export function verifyAdminSessionToken(token) {
  if (!token) return null;

  const secret = getAdminSessionSecret();
  if (!secret) return null;

  try {
    const decoded = verifyJwt(token, secret, {
      algorithms: ['HS256'],
      issuer: ADMIN_SESSION_ISSUER,
      audience: ADMIN_SESSION_AUDIENCE,
    });

    if (!decoded || typeof decoded !== 'object') return null;
    if (decoded.scope !== 'admin') return null;
    if (typeof decoded.role !== 'string') return null;

    return {
      scope: decoded.scope,
      role: decoded.role,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      mfa_verified: decoded.mfa_verified === true,
      elev_until: typeof decoded.elev_until === 'number' ? decoded.elev_until : 0,
      elev_kind: typeof decoded.elev_kind === 'string' ? decoded.elev_kind : '',
      elev_id: typeof decoded.elev_id === 'string' ? decoded.elev_id : '',
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      iatMs: typeof decoded.iat_ms === 'number' ? decoded.iat_ms : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * PKG-11 / ADM-10 — an administrator session is checked against its AdminUser row on EVERY request (it used to stay valid for 8 h whatever happened): a disabled
 * administrator, or a session issued before AdminUser.sessionsValidAfter (logout, password change, revocation by another administrator), is refused. A token
 * whose e-mail has no AdminUser row is either the single env identity (read-only by construction, allowed) or a test fixture; in production — or with
 * ADMIN_SESSION_REGISTRY_STRICT=true — an unknown e-mail is refused, and a failed lookup refuses too (fail-closed).
 * @param {{ email?: string, iat?: number, iatMs?: number } | null} session @param {{ db?: any }} [deps]
 */
export async function adminSessionRefused(session, deps = {}) {
  const strict = String(process.env.ADMIN_SESSION_REGISTRY_STRICT || '') === 'true' || String(process.env.VERCEL_ENV || '') === 'production';
  const email = String(session?.email || '').trim().toLowerCase();
  try {
    const [row] = await (deps.db || db).select({ disabledAt: AdminUser.disabledAt, sessionsValidAfter: AdminUser.sessionsValidAfter }).from(AdminUser).where(eq(AdminUser.email, email)).limit(1);
    if (!row) return strict && email !== String(env.secrets.adminEmail || '').trim().toLowerCase();
    if (row.disabledAt) return true;
    if (!row.sessionsValidAfter) return false;
    const issued = typeof session?.iatMs === 'number' ? session.iatMs : Number(session?.iat || 0) * 1000;   // a token without iat_ms: the start of its second (revoked if in doubt)
    return issued < new Date(row.sessionsValidAfter).getTime();
  } catch {
    return strict;
  }
}

/**
 * @param {string} role
 */
function normalizeRole(role) {
  switch (String(role || '').toUpperCase()) {
    case 'SUPERADMIN':
      return AUTH_ROLE.SUPERADMIN;
    case 'STRUCTURE_ADMIN':
      return AUTH_ROLE.STRUCTURE_ADMIN;
    case 'PRO':
      return AUTH_ROLE.PRO;
    case 'ADMIN':
      return AUTH_ROLE.ADMIN;
    default:
      return AUTH_ROLE.USER;
  }
}

/**
 * @param {string} role
 */
export function isAdminRole(role) {
  const normalized = normalizeRole(role);
  return normalized === AUTH_ROLE.ADMIN || normalized === AUTH_ROLE.SUPERADMIN;
}

/**
 * @param {string} role
 */
export function isProRole(role) {
  const normalized = normalizeRole(role);
  return (
    normalized === AUTH_ROLE.PRO ||
    normalized === AUTH_ROLE.STRUCTURE_ADMIN ||
    normalized === AUTH_ROLE.SUPERADMIN
  );
}

export async function resolveAuthContext(/** @type {unknown} */ req) {
  const token = getBearerToken(req);
  if (!token) return null;

  if (verifyLegacyAdminToken(token)) {
    logger.warn('[Auth] DEPRECATED: Legacy ADMIN_TOKEN used. Migrate to JWT/MFA admin authentication.');
    return {
      role: AUTH_ROLE.ADMIN,
      authType: 'admin_token',
      email: env.secrets.adminEmail || 'admin@accesdirectaide.fr',
      _deprecated: true,
    };
  }

  const adminSession = verifyAdminSessionToken(token);
  if (adminSession) {
    if (await adminSessionRefused(adminSession)) return null;   // PKG-11 / ADM-10: disabled administrator or revoked session
    return {
      role: normalizeRole(adminSession.role),
      authType: 'admin_jwt',
      email: adminSession.email || env.secrets.adminEmail || 'admin@accesdirectaide.fr',
      mfa_verified: adminSession.mfa_verified === true,
      elevatedUntil: adminSession.mfa_verified === true ? adminSession.elev_until : 0,
      elevationKind: adminSession.elev_kind,
      elevationId: adminSession.elev_id,
    };
  }

  const proClaims = verifyProToken(token);
  if (proClaims && typeof proClaims === 'object') {
    // Enforce JWT revocation for pro tokens
    const jti = /** @type {any} */ (proClaims).jti;
    if (jti && await isTokenRevoked(jti)) {
      logger.info('[Auth] Pro token revoked, denying access', { jti: String(jti).slice(0, 8) });
      return null;
    }

    return {
      role: normalizeRole(/** @type {any} */(proClaims).role),
      authType: 'pro_jwt',
      email: /** @type {any} */ (proClaims).email,
      userId: String(/** @type {any} */(proClaims).userId || ''),
      structureId: String(/** @type {any} */(proClaims).structureId || ''),
      iat: /** @type {any} */ (proClaims).iat,
      mfa: /** @type {any} */ (proClaims).mfa === true,
    };
  }

  return null;
}

/**
* @param {unknown} req
*/
export async function verifyAdmin(req) {
  // PKG-5 / A01 A16: an ADMIN session (named administrator, admin_jwt) — never a professional token, even one claiming SUPERADMIN (separate security model);
  // and any state-changing request needs that session's MFA. (The retired legacy token is only accepted where legacyAdminTokenAllowed().)
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role)) return false;
  const method = String(/** @type {any} */ (req)?.method || 'GET').toUpperCase();
  const reading = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  // R12 (A01): outside the frozen test suites the legacy token (a shared secret, no MFA) may only READ — the non-production opt-in never writes
  if (auth.authType === 'admin_token') return reading || process.env.NODE_ENV === 'test';
  if (auth.authType !== 'admin_jwt') return false;
  return reading || auth.mfa_verified === true;
}

/**
 * PKG-5 / A16 — platform operations need a named MFA administrator session with an UNEXPIRED elevation (JIT or break-glass).
 * @param {any} auth resolved auth context
 */
export function isElevated(auth, now = Date.now()) {
  return Boolean(auth && auth.authType === 'admin_jwt' && auth.mfa_verified === true && auth.email && Number(auth.elevatedUntil || 0) * 1000 > now);
}

export async function getAuthenticatedUser(/** @type {string | number | boolean | null | undefined} */ req) {
  const auth = await resolveAuthContext(req);
  if (!auth) return null;
  return auth;
}

/**
* @param {{ (req: any, res: any): Promise<any>; (arg0: any, arg1: any): any; }} handler
*/
export function requireAuth(handler, allowedRolesLegacy = []) {
  // @ts-ignore
  return async function wrapped(req, res) {
    const auth = await resolveAuthContext(req);
    if (!auth) {
      logger.warn('[Auth] requireAuth rejected request', { endpoint: req.url, reason: 'No auth context' });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Support legacy allowedRoles array from pro-auth
    if (allowedRolesLegacy && allowedRolesLegacy.length > 0) {
        if (!allowedRolesLegacy.includes(auth.role) && auth.role !== AUTH_ROLE.SUPERADMIN) {
           logger.warn('[Auth] requireAuth forbidden', { endpoint: req.url, expected: allowedRolesLegacy, actual: auth.role });
           return res.status(403).json({ error: 'Forbidden' });
        }
    }

    req.auth = auth;
    if (auth.authType === 'pro_jwt') {
      req.user = {
        userId: auth.userId,
        role: auth.role,
        structureId: auth.structureId,
        email: auth.email,
      };
    }
    return handler(req, res);
  };
}

export function requireRole(/** @type {(...args: unknown[]) => unknown} */ handler, /** @type {unknown} */ roles, options = {}) {
  const expected = Array.isArray(roles) ? roles : [];
  const allowAdminBypass = options.allowAdminBypass !== false;

  // @ts-ignore
  return requireAuth(async function roleWrapped(req, res) {
    const auth = req.auth || await resolveAuthContext(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const role = normalizeRole(auth.role);
    const isAdmin = isAdminRole(role);
    const allowed = expected.length === 0 || expected.includes(role) || (allowAdminBypass && isAdmin);

    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return handler(req, res);
  });
}

/**
* @param {{ (req: any, res: any): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (arg0: any, arg1: any): any; }} handler
*/
export function requireAdminAuth(handler) {
  // @ts-ignore
  return async function wrapped(req, res) {
    if (res.setHeader) res.setHeader('Cache-Control', NO_STORE_VALUE);

    const auth = await resolveAuthContext(req);
    if (!auth) {
      logger.warn('[Auth] requireAdminAuth rejected request', { endpoint: req.url, reason: 'No auth context' });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isAdminAuthType = auth.authType === 'admin_token' || auth.authType === 'admin_jwt';
    if (!isAdminAuthType || !isAdminRole(auth.role)) {
      logger.warn('[Auth] requireAdminAuth forbidden', { endpoint: req.url, role: auth.role, authType: auth.authType });
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.auth = {
      ...auth,
      role: normalizeRole(auth.role),
      mfa_verified: auth.mfa_verified === true,
    };
    return handler(req, res);
  };
}

export function requireAdminMfa(/** @type {(...args: unknown[]) => unknown} */ handler) {
  // @ts-ignore
  return requireAdminAuth(async function mfaWrapped(req, res) {
    if (!req.auth?.mfa_verified) {
      return res.status(403).json({ error: 'MFA required', mfa_required: true });
    }
    return handler(req, res);
  });
}

/**
* @param {{ (req: any, res: any): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: any, res: any): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (arg0: any, arg1: any): any; method?: string; user?: { role: string; structureId: number; } | { userId: string; } | { userId: string; }; body?: { shareId: string; } | { category: string; } | { poleId: string; categoryId: string; }; headers?: {} | {}; }} handler
*/
/**
 * PKG-4 / D2: the CURRENT membership of a professional. The token is only a claim (8 h, refreshable); the database is the authority on whether the person still belongs to the
 * structure, with which role. Returns null when the account does not exist; throws on a database failure (callers fail closed).
 * @param {string} userId
 * @returns {Promise<{ role: string, status: string, structureId: string } | null>}
 */
export async function currentProMembership(userId) {
  // a database handle without raw SQL (isolated unit-test doubles of src/db) cannot answer: membership UNKNOWN, the token's claims stay authoritative there
  if (typeof db.execute !== 'function') return undefined;
  const rows = (await db.execute(sql`SELECT role, status, "structureId", "sessionsValidAfter" FROM "ProUser" WHERE id = ${String(userId)} LIMIT 1`)).rows;
  return rows[0] ? { role: String(rows[0].role || ''), status: String(rows[0].status || ''), structureId: String(rows[0].structureId || ''), sessionsValidAfter: rows[0].sessionsValidAfter || null } : null;
}

/**
 * PKG-11 audit (session lifecycle): a professional session issued BEFORE the account's sessionsValidAfter (server logout, password reset) is dead, on every pro
 * route and on refresh. Before: « Déconnexion » only cleared the browser (the 8 h token stayed valid and refreshable) and a password reset left every session alive.
 * Granularity is the token's issue second. A token without an issue time is refused once a revocation exists.
 * @param {number | undefined} iat token issue time (seconds) @param {{ sessionsValidAfter?: Date | string | null } | null | undefined} membership
 */
export function proSessionRevoked(iat, membership) {
  const after = membership?.sessionsValidAfter ? new Date(membership.sessionsValidAfter).getTime() : NaN;
  if (!Number.isFinite(after)) return false;
  if (!Number.isFinite(iat)) return true;
  return /** @type {number} */ (iat) < Math.floor(after / 1000);
}

/** Ends every session of a professional (server-side logout, password reset). @param {string} userId @param {any} [dbh] */
export async function revokeProSessions(userId, dbh = db) {
  await dbh.execute(sql`UPDATE "ProUser" SET "sessionsValidAfter" = NOW() WHERE id = ${String(userId)}`);
}
export const PRO_SESSION_STATUSES = ['active', 'pending'];

export function requireProAuth(handler) {
  // @ts-ignore
  return async function wrapped(req, res) {
    if (res.setHeader) res.setHeader('Cache-Control', NO_STORE_VALUE);

    const auth = await resolveAuthContext(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (auth.authType !== 'pro_jwt') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const role = normalizeRole(auth.role);
    if (!isProRole(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const userId = String(auth.userId || '').trim();
    const structureId = String(auth.structureId || '').trim();
    if (!userId || !structureId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // PKG-4 / D2: a disabled or moved account, or one whose role is no longer a professional role, loses access AT ONCE (not when the 8 h token expires); a demotion
    // applies at once (the database role wins). The answer is the same uniform 404 as "no grant" (RC5 contract: no oracle on membership state). Accounts are never
    // hard-deleted by the API (departure = status disabled); a token whose account row does not exist keeps its claims.
    let membership;
    try { membership = await currentProMembership(userId); } catch (err) {
      logger.error({ err: { name: err?.name } }, '[Auth] pro membership check failed');
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    if (membership && proSessionRevoked(/** @type {any} */ (auth).iat, membership)) {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.', code: 'SESSION_REVOKED' });
    }
    if (proMfaRequired() && /** @type {any} */ (auth).mfa !== true && proRouteNeedsMfa(req.url)) {
      return res.status(403).json({ error: 'Double authentification requise', code: 'PRO_MFA_REQUIRED', message: 'Activez la double authentification puis reconnectez-vous pour accéder aux dossiers.' });
    }
    let currentRole = role;
    let scopedStructureId = structureId;
    if (membership) {
      if (!PRO_SESSION_STATUSES.includes(membership.status) || membership.structureId !== structureId || !isProRole(normalizeRole(membership.role))) {
        // The request continues with a context that belongs to NO organization: every query is organization-scoped, so nothing is read or written, and each route
        // answers its OWN not-found (byte-identical to "no grant" / unknown id — RC5 contract), while admin-only routes refuse the role.
        scopedStructureId = `revoked:${userId}`;
        currentRole = 'revoked';
      } else {
        currentRole = normalizeRole(membership.role);
      }
    }

    req.auth = {
      ...auth,
      role: currentRole,
      structureId: scopedStructureId,
    };
    req.user = {
      userId,
      role: currentRole,
      structureId: scopedStructureId,
      email: auth.email || null,
      mfa: /** @type {any} */ (auth).mfa === true,
    };

    return handler(req, res);
  };
}

/**
* @param {{ (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (req: import("./http-types.js").ApiRequest, res: import("./http-types.js").ApiResponse): Promise<any>; (arg0: any, arg1: any): any; }} handler
*/
export function requireProRole(handler, /** @type {unknown} */ roles) {
  const expected = Array.isArray(roles) ? roles : [];

  // @ts-ignore
  return requireProAuth(async function wrapped(/** @type {{ user: { role: any; }; }} */ req, /** @type {{ status: (arg0: number) => { (): any; new (): any; json: { (arg0: { error: string; }): any; new (): any; }; }; }} */ res) {
    if (expected.length > 0 && !expected.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return handler(req, res);
  });
}

/**
* @param {{ [x: string]: any; method?: string; url?: string; headers?: Record<string, any>; query?: Record<string, any>; body?: any; cookies?: Record<string, any>; user?: any; }} req
* @param {{ [x: string]: any; statusCode?: number; getHeader?: (name: string) => any; setHeader?: (name: string, value: any) => any; set?: (name: string, value: any) => any; writeHead?: (statusCode: number, headers?: any) => any; end?: (...args: any[]) => any; status: any; json?: (body: any) => any; send?: (body: any) => any; redirect?: (codeOrUrl: any, url?: any) => any; }} res
*/
export function requireProStructureContext(req, res, targetStructureId = null) {
  const structureId = String(req?.user?.structureId || '').trim();
  const userId = String(req?.user?.userId || '').trim();
  const role = normalizeRole(req?.user?.role);

  if (!structureId || !userId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const target = String(targetStructureId || '').trim();
  if (target && target !== structureId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return { structureId, userId, role };
}
