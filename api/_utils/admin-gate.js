// @ts-nocheck
import { resolveAuthContext, isAdminRole, isElevated } from './auth.js';
import { db } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

/**
 * PKG-5 — one gate for the K5 administrator surfaces. Only a named administrator session (admin_jwt; the legacy token only where it is still allowed outside
 * production, and never for writes). write: the session needs MFA. elevated: platform operation — MFA + an unexpired JIT / break-glass elevation (A16).
 * Professional, institutional and citizen sessions are always refused. Returns the auth context or null after answering.
 */
export async function adminGate(req, res, { write = false, elevated = false } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  if ((write || elevated) && (auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email)) {
    res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Cette action demande une session administrateur nominative avec MFA.' }); return null;
  }
  if (elevated && !isElevated(auth)) {
    res.status(403).json({ error: 'ELEVATION_REQUIRED', message: 'Opération de plateforme : demandez une élévation temporaire (ou l’accès d’urgence) avec un code MFA et un motif.' }); return null;
  }
  // PKG-5 / A16: every state-changing administrator request through this gate leaves an AuditLog row once answered (who, route, method, status, elevation)
  // — never the body, never a token. (Services also write their own business audit rows.)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase()) && typeof res.on === 'function') {
    const route = new URL(req.url || '/', 'http://x').pathname.replace(/^\/api\//, '');
    res.on('finish', () => {
      db.insert(AuditLog).values({ action: 'ADMIN_API_WRITE', actor: auth.email || null, actor_id: auth.email || null, entity: 'AdminRoute', entity_id: route,
        details: { method: String(req.method), status: res.statusCode, mfa: auth.mfa_verified === true, elevation: isElevated(auth) ? auth.elevationKind : null } }).catch(() => {});
    });
  }
  return auth;
}
