// @ts-nocheck
/**
 * PKG-5 / A16 — Super Admin / platform operations security model.
 *   - adminLogin: the SEPARATE administrator login surface (POST /api/admin/login). Named AdminUser accounts (scrypt hash, lockout); the single env identity
 *     (ADMIN_EMAIL / ADMIN_PASSWORD_HASH) still signs in but has no MFA secret, so it can never write, elevate or confirm a two-person action.
 *   - elevate (JIT): a superadmin with an MFA session + a FRESH TOTP code + a written reason gets a 15-minute elevation claim.
 *   - breakGlass: any named MFA administrator, fresh TOTP + reason, 30 minutes, flagged BREAK_GLASS and listed until a DIFFERENT administrator reviews it.
 *   - Neither elevation grants dossier access: no dossier / case / Coffre / share handler accepts an administrator session (tests/integration/pkg5-a16-ops-db.test.js).
 *   - Every step is written to AuditLog (no password, code or token is ever stored).
 *   - PKG-11 / ADM-10: sessions are checked against AdminUser on every request (api/_utils/auth.js adminSessionRefused); an administrator ends all of their
 *     sessions (logout), an ELEVATED superadmin ends another administrator's sessions or disables / re-enables the account (never their own), with a reason;
 *     a disabled administrator cannot sign in. The session events (sign-in, failure, lock, logout, revocation, disabling) are listed for administrators.
 */
import crypto from 'node:crypto';
import { verify as verifyTotp } from 'otplib';
import { eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AdminUser, AuditLog } from '../../src/db/schema.js';
import { env } from '../_utils/env.js';
import { decryptToken } from '../_utils/vault.js';
import { signAdminSessionToken } from '../_utils/auth.js';
import { verifyPassword } from '../_utils/user-auth.js';
import { claimAdminStep } from '../_utils/totp-guard.js';

export const JIT_MINUTES = 15;
export const BREAK_GLASS_MINUTES = 30;
const MAX_FAILED = 5; const LOCK_MS = 15 * 60 * 1000;
const bad = (status, code, message) => ({ ok: false, status, code, message });
const audit = (db, action, actor, details = {}, entityId = null) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'AdminSession', entity_id: entityId, details }).catch(() => {});

export async function adminLogin({ email, password }, { db = defaultDb } = {}) {
  const e = String(email || '').trim().toLowerCase(); const p = String(password || '');
  if (!e || !p) return bad(400, 'invalid_input', 'Email et mot de passe requis.');
  const [admin] = await db.select().from(AdminUser).where(eq(AdminUser.email, e)).limit(1);
  if (admin) {
    if (admin.disabledAt) { await audit(db, 'ADMIN_LOGIN_DISABLED', e); return bad(401, 'invalid_credentials', 'Identifiants invalides.'); }   // ADM-10: same answer as a wrong password
    if (admin.lockoutUntil && new Date(admin.lockoutUntil) > new Date()) { await audit(db, 'ADMIN_LOGIN_LOCKED', e); return bad(423, 'locked', 'Compte temporairement verrouillé.'); }
    const ok = await verifyPassword(p, admin.password).catch(() => false);
    if (!ok) {
      // R12 / Q11: atomic increment (concurrent failures on several instances all count)
      const [after] = await db.update(AdminUser).set({ failedLoginAttempts: sql`COALESCE(${AdminUser.failedLoginAttempts}, 0) + 1` }).where(eq(AdminUser.id, admin.id)).returning({ n: AdminUser.failedLoginAttempts });
      if ((after?.n || 0) >= MAX_FAILED) await db.update(AdminUser).set({ lockoutUntil: new Date(Date.now() + LOCK_MS) }).where(eq(AdminUser.id, admin.id));
      await audit(db, 'ADMIN_LOGIN_FAILED', e);
      return bad(401, 'invalid_credentials', 'Identifiants invalides.');
    }
    await db.update(AdminUser).set({ failedLoginAttempts: 0, lockoutUntil: null, lastLogin: new Date() }).where(eq(AdminUser.id, admin.id));
    await audit(db, 'ADMIN_LOGIN_SUCCEEDED', e, { mfaEnabled: admin.mfaEnabled === true });
    return { ok: true, token: signAdminSessionToken({ email: e, role: admin.role || 'admin', mfa_verified: false }), user: { email: e, role: admin.role || 'admin' },
      mfa_required: admin.mfaEnabled === true, mfa_setup_required: admin.mfaEnabled !== true };
  }
  // the single env identity (continuity): sign-in only, no MFA secret -> read-only in practice. Never in production (launch-readiness items 35/44): there every
  // administrator is a named account with MFA, the first one created by scripts/admin-bootstrap.mjs
  const production = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const envEmail = production ? '' : String(env.secrets.adminEmail || '').toLowerCase(); const hash = production ? null : env.secrets.adminPasswordHash;
  if (envEmail && e === envEmail && hash && await verifyPassword(p, hash).catch(() => false)) {
    await audit(db, 'ADMIN_LOGIN_SUCCEEDED', e, { identity: 'env', mfaAvailable: false });
    return { ok: true, token: signAdminSessionToken({ email: e, role: 'admin', mfa_verified: false }), user: { email: e, role: 'admin' }, mfa_required: false, mfa_setup_required: true, readOnly: true };
  }
  await audit(db, 'ADMIN_LOGIN_FAILED', e);
  return bad(401, 'invalid_credentials', 'Identifiants invalides.');
}

/** A FRESH TOTP code of this named administrator (MFA must be active): valid now AND not used before (the code of the sign-in does not elevate). */
export async function checkFreshTotp(email, code, { db = defaultDb } = {}) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const [admin] = await db.select().from(AdminUser).where(eq(AdminUser.email, String(email || '').toLowerCase())).limit(1);
  if (!admin || !admin.mfaEnabled || !admin.mfaSecret || !admin.mfaIv) return null;
  const r = await verifyTotp({ token: String(code), secret: decryptToken(admin.mfaSecret, admin.mfaIv), epochTolerance: 30,
    ...(Number.isInteger(admin.mfaLastTimeStep) ? { afterTimeStep: admin.mfaLastTimeStep } : {}) }).catch(() => null);
  return r && r.valid && await claimAdminStep(db, admin.id, r.timeStep) ? admin : null;
}

function elevatedToken(auth, admin, kind, minutes, id) {
  const until = Math.floor(Date.now() / 1000) + minutes * 60;
  return { until, token: signAdminSessionToken({ email: auth.email, role: admin.role || 'admin', mfa_verified: true, elev_until: until, elev_kind: kind, elev_id: id }) };
}

/** @param {any} auth admin_jwt context with mfa_verified */
export async function elevate(auth, { code, reason, kind = 'JIT' }, { db = defaultDb } = {}) {
  if (!auth || auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email) return bad(403, 'HUMAN_MFA_SESSION_REQUIRED', 'Une session administrateur nominative avec MFA est requise.');
  const why = String(reason || '').trim();
  if (why.length < 15) return bad(400, 'REASON_REQUIRED', 'Indiquez pourquoi (au moins 15 caractères) : la raison est conservée dans le journal.');
  const admin = await checkFreshTotp(auth.email, code, { db });
  if (!admin) { await audit(db, 'ADMIN_ELEVATION_REFUSED', auth.email, { kind }); return bad(403, 'FRESH_MFA_CODE_REQUIRED', 'Code MFA invalide ou expiré.'); }
  const isBreakGlass = kind === 'BREAK_GLASS';
  if (!isBreakGlass && String(admin.role).toLowerCase() !== 'superadmin') return bad(403, 'SUPERADMIN_REQUIRED', 'L’élévation ordinaire est réservée aux super-administrateurs. En urgence, utilisez l’accès d’urgence (revu ensuite par un autre administrateur).');
  const id = crypto.randomUUID();
  const { until, token } = elevatedToken(auth, admin, isBreakGlass ? 'BREAK_GLASS' : 'JIT', isBreakGlass ? BREAK_GLASS_MINUTES : JIT_MINUTES, id);
  await db.insert(AuditLog).values({ action: isBreakGlass ? 'BREAK_GLASS_OPENED' : 'ADMIN_ELEVATION_GRANTED', actor: auth.email, actor_id: auth.email, entity: 'AdminElevation', entity_id: id,
    details: { reason: why.slice(0, 500), until: new Date(until * 1000).toISOString(), role: admin.role } });
  return { ok: true, token, elevation: { id, kind: isBreakGlass ? 'BREAK_GLASS' : 'JIT', until: new Date(until * 1000).toISOString() } };
}

/** Ends the elevation early (a plain MFA session again). */
export async function endElevation(auth, { db = defaultDb } = {}) {
  if (!auth || auth.authType !== 'admin_jwt' || !auth.email) return bad(401, 'unauthorized', 'Session requise.');
  // R12 (A16): ending the elevation now ends the ELEVATED token itself (it used to stay usable until elev_until): every session issued before now is refused
  // (sessionsValidAfter, checked on each request), and the plain MFA session returned here is issued after that instant. Other open sessions of this
  // administrator end too (they sign in again).
  await db.update(AdminUser).set({ sessionsValidAfter: new Date() }).where(eq(AdminUser.email, String(auth.email).toLowerCase()));
  await audit(db, 'ADMIN_ELEVATION_ENDED', auth.email, { sessionsEnded: true }, auth.elevationId || null);
  return { ok: true, otherSessionsEnded: true, token: signAdminSessionToken({ email: auth.email, role: auth.role, mfa_verified: auth.mfa_verified === true }) };
}

export async function pendingBreakGlass({ db = defaultDb } = {}) {
  const rows = (await db.execute(sql`SELECT o.entity_id AS id, o.actor, o.timestamp AS "openedAt", o.details->>'reason' AS reason, o.details->>'until' AS until FROM "AuditLog" o
    WHERE o.action = 'BREAK_GLASS_OPENED' AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = 'BREAK_GLASS_REVIEWED' AND r.entity_id = o.entity_id) ORDER BY o.timestamp`)).rows;
  // owner LAB audit: the reviewer sees what was DONE during the emergency window (journal entries of that administrator), not only who opened it and why
  for (const r of rows) {
    r.actions = (await db.execute(sql`SELECT a.action, a.entity, a.entity_id AS "entityId", a.timestamp AS at FROM "AuditLog" a JOIN "AuditLog" o ON o.action = 'BREAK_GLASS_OPENED' AND o.entity_id = ${r.id}
      WHERE a.actor = o.actor AND a.timestamp >= o.timestamp AND a.timestamp <= COALESCE((o.details->>'until')::timestamptz AT TIME ZONE 'UTC', o.timestamp + interval '30 minutes')
        AND a.action <> 'BREAK_GLASS_OPENED' ORDER BY a.timestamp LIMIT 100`)).rows;
  }
  return rows;
}

/** A DIFFERENT MFA administrator reviews a break-glass use (what was done is in the audit log). */
export async function reviewBreakGlass(auth, { id, note }, { db = defaultDb } = {}) {
  if (!auth || auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email) return bad(403, 'HUMAN_MFA_SESSION_REQUIRED', 'Une session administrateur nominative avec MFA est requise.');
  const [o] = (await db.execute(sql`SELECT actor FROM "AuditLog" WHERE action = 'BREAK_GLASS_OPENED' AND entity_id = ${String(id || '')} LIMIT 1`)).rows;
  if (!o) return bad(404, 'not_found', 'Accès d’urgence introuvable.');
  if (String(o.actor).toLowerCase() === String(auth.email).toLowerCase()) return bad(403, 'TWO_PERSON_RULE', 'L’accès d’urgence doit être revu par un autre administrateur.');
  if (String(note || '').trim().length < 10) return bad(400, 'NOTE_REQUIRED', 'Décrivez la revue (au moins 10 caractères).');
  const [done] = (await db.execute(sql`SELECT 1 AS x FROM "AuditLog" WHERE action = 'BREAK_GLASS_REVIEWED' AND entity_id = ${String(id)} LIMIT 1`)).rows;
  if (done) return bad(409, 'already_reviewed', 'Déjà revu.');
  await db.insert(AuditLog).values({ action: 'BREAK_GLASS_REVIEWED', actor: auth.email, actor_id: auth.email, entity: 'AdminElevation', entity_id: String(id), details: { note: String(note).trim().slice(0, 1000) } });
  return { ok: true };
}

export const SESSION_EVENTS = ['ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_DISABLED', 'ADMIN_LOGOUT', 'ADMIN_SESSIONS_REVOKED', 'ADMIN_DISABLED', 'ADMIN_ENABLED',
  'ADMIN_MFA_ENROLLED', 'ADMIN_MFA_VERIFIED', 'ADMIN_MFA_FAILED', 'ADMIN_ACCOUNT_CREATED_LOCAL', 'ADMIN_ACCOUNT_BOOTSTRAP', 'ADMIN_MFA_RESET_LOCAL', 'ADMIN_PASSWORD_RESET_LOCAL'];

/** ADM-10: the administrator ends every one of their sessions (this one included). */
export async function logoutAll(auth, { db = defaultDb } = {}) {
  const e = String(auth?.email || '').toLowerCase();
  const rows = await db.update(AdminUser).set({ sessionsValidAfter: new Date() }).where(eq(AdminUser.email, e)).returning({ id: AdminUser.id });
  await audit(db, 'ADMIN_LOGOUT', e, { registered: rows.length > 0 });
  return { ok: true, status: 200, ended: true };
}

/**
 * ADM-10: an ELEVATED superadmin (MFA session + JIT elevation) acts on ANOTHER administrator, with a written reason: 'revoke' ends their sessions, 'disable' also
 * forbids new sign-ins, 'enable' lifts the disabling (their old sessions stay ended).
 */
export async function actOnAdministrator(auth, { action, email, reason }, { db = defaultDb, elevated } = {}) {
  const me = String(auth?.email || '').toLowerCase(); const target = String(email || '').trim().toLowerCase(); const why = String(reason || '').trim();
  if (!elevated) return bad(403, 'ELEVATION_REQUIRED', 'Action réservée à un super-administrateur avec une élévation en cours.');
  if (!['revoke', 'disable', 'enable'].includes(action)) return bad(400, 'unknown_action', 'Action inconnue.');
  if (!target || target === me) return bad(400, 'NOT_ON_YOURSELF', 'Choisissez un autre administrateur (pour vous-même : « Terminer toutes mes sessions »).');
  if (why.length < 10) return bad(400, 'REASON_REQUIRED', 'Indiquez la raison (au moins 10 caractères).');
  const now = new Date();
  const patch = action === 'revoke' ? { sessionsValidAfter: now } : action === 'disable' ? { disabledAt: now, sessionsValidAfter: now } : { disabledAt: null };
  const rows = await db.update(AdminUser).set(patch).where(eq(AdminUser.email, target)).returning({ id: AdminUser.id });
  if (!rows.length) return bad(404, 'not_found', 'Administrateur introuvable.');
  const ACTION = { revoke: 'ADMIN_SESSIONS_REVOKED', disable: 'ADMIN_DISABLED', enable: 'ADMIN_ENABLED' }[action];
  await db.insert(AuditLog).values({ action: ACTION, actor: me, actor_id: me, entity: 'AdminUser', entity_id: rows[0].id, details: { target, reason: why.slice(0, 500) } });
  return { ok: true, status: 200, action, target };
}

/** ADM-10: the administrators (no secret) and the recent session events, for an administrator session. */
export async function sessionOverview({ db = defaultDb, limit = 50 } = {}) {
  const admins = (await db.execute(sql`SELECT email, "displayName" AS holder, role, "mfaEnabled" AS mfa, "lastLogin" AS "lastLogin", "disabledAt" AS "disabledAt", "sessionsValidAfter" AS "sessionsValidAfter"
    FROM "AdminUser" ORDER BY email LIMIT 200`)).rows;
  const events = (await db.execute(sql`SELECT action, actor, timestamp AS at, details->>'target' AS target FROM "AuditLog"
    WHERE action IN (${sql.join(SESSION_EVENTS.map((a) => sql`${a}`), sql`, `)}) ORDER BY timestamp DESC LIMIT ${Math.min(Number(limit) || 50, 200)}`)).rows;
  return { ok: true, admins, events };
}
