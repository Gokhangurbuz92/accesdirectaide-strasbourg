// @ts-nocheck
/**
 * G14-AID — the router-level gate of an assisted session (« mode accompagnant », api/_services/assisted-mode.js). Every route of api/routes.js passes here
 * (before the capability gate's handler runs the route's own code). A request WITHOUT an assisted session token is passed through untouched.
 * With one:
 *   - the capability citizen.assisted_mode closed, or the session ended / expired → 401 ASSIST_ENDED and the session cookie is cleared (fail-closed: never
 *     a fallback to a full session);
 *   - a route of the account families that the person did not open to the helper (and every route of the account's security) → 403 ASSIST_NOT_ALLOWED,
 *     logged for the person (once per route per 10 minutes);
 *   - an allowed read of an area → logged (once per area per 10 minutes); an allowed write → logged BEFORE it runs, its HTTP outcome added after. When the
 *     log cannot be written the request is refused (503): no unlogged helper access.
 */
import { capabilityOpen } from './capabilities.js';
import logger from './logger.js';
// the session reader and the service (database) are loaded only for a request that carries a citizen session cookie: the route table stays light
const userAuth = () => import('./user-auth.js');
const service = () => import('../_services/assisted-mode.js');
const SESSION_COOKIE = 'ada_user_session';

export const ASSIST_ENDED_MESSAGE = 'Le mode accompagnant est terminé : reconnectez-vous pour continuer.';
export const ASSIST_NOT_ALLOWED_MESSAGE = 'En mode accompagnant, cette partie du compte n’est pas accessible. La personne peut la consulter seule, après avoir terminé le mode accompagnant.';

function requestPath(req) {
  let p = '';
  try { p = new URL(String(req?.url || '/'), 'http://localhost').pathname; } catch { p = ''; }
  return p.replace(/^\/api(\/|$)/, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** @param {any} req @returns {Promise<any>} the verified session claims when the request carries an ASSISTED session, else null */
export async function assistedClaims(req) {
  const raw = req?.headers?.cookie || req?.headers?.Cookie || '';
  if (!String(Array.isArray(raw) ? raw.join(';') : raw).includes(SESSION_COOKIE) && !(req?.cookies && req.cookies[SESSION_COOKIE])) return null;
  const { getUserSessionTokenFromRequest, verifyUserSessionToken } = await userAuth();
  const claims = verifyUserSessionToken(getUserSessionTokenFromRequest(req));
  return claims && claims.assist ? claims : null;
}

/** @param {any} req @param {any} res @param {(req: any, res: any) => any} inner @param {{ db?: any }} [deps] */
export async function handleAssisted(req, res, inner, deps = {}) {
  const claims = await assistedClaims(req);
  if (!claims) return inner(req, res);
  const { assistActionLabel, assistDecision, assistSessionLive, recordAssistEvent, recordAssistOutcome } = await service();
  const { buildUserSessionCookieClear } = await userAuth();
  const db = deps.db;
  res.setHeader?.('Cache-Control', 'no-store');
  let live = false;
  try { live = capabilityOpen('citizen.assisted_mode') && (await assistSessionLive(claims.userId, claims.assist, ...(db ? [db] : []))); } catch (err) {
    logger.error({ err: { name: err?.name } }, '[assist-gate] liveness check failed (refused)');
    return res.status(503).json({ error: 'ASSIST_UNAVAILABLE', message: 'Le mode accompagnant est momentanément indisponible.' });
  }
  if (!live) {
    res.setHeader?.('Set-Cookie', buildUserSessionCookieClear());
    return res.status(401).json({ error: 'ASSIST_ENDED', message: ASSIST_ENDED_MESSAGE });
  }
  const path = requestPath(req); const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return inner(req, res);
  const d = assistDecision(path, method, claims.assist);
  const log = (kind, what) => recordAssistEvent(claims.userId, claims.assist, kind, what, ...(db ? [db] : []));
  if (!d.allow) {
    await log('REFUSED', { area: d.area, route: path.split('/').slice(0, 2).join('/'), method }).catch(() => null);
    return res.status(403).json({ error: 'ASSIST_NOT_ALLOWED', message: ASSIST_NOT_ALLOWED_MESSAGE });
  }
  if (d.kind !== 'AREA') return inner(req, res);
  let id = null;
  try {
    id = method === 'GET' || method === 'HEAD' ? await log('VIEW', { area: d.area }) : await log('ACTION', { area: d.area, label: assistActionLabel(path, method), method });
  } catch (err) {
    logger.error({ err: { name: err?.name } }, '[assist-gate] audit write failed (refused)');
    return res.status(503).json({ error: 'ASSIST_AUDIT_UNAVAILABLE', message: 'Cette action n’a pas pu être enregistrée dans votre historique : elle n’a pas été faite.' });
  }
  const out = await inner(req, res);
  if (id && method !== 'GET' && method !== 'HEAD') await recordAssistOutcome(id, res.statusCode, ...(db ? [db] : []));
  return out;
}

/**
 * Wraps a route of api/routes.js (same shape as capabilities.js gateRoute: the module is loaded, its default export replaced by the gated one).
 * @template {{ path: string, match: string, handler: Function }} R @param {R} route @returns {R}
 */
export function assistGateRoute(route) {
  const load = route.handler;
  const handler = async () => {
    const mod = await load();
    const inner = mod?.default || mod;
    if (typeof inner !== 'function') return mod;
    const gated = async (req, res) => handleAssisted(req, res, inner);
    return { ...mod, default: gated };
  };
  // route introspection (tests, inventories) reads the loader's source to know which module a route serves — keep it visible
  handler.toString = () => String(load);
  return /** @type {R} */ ({ ...route, handler });
}
