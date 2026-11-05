/**
 * R46 / P07 — public territory lookups from the committed official references (no database, no network, nothing stored by this handler; the router's request log records the query string like any GET):
 *   GET /api/territory/postal?code=67100  → La Poste postal code → candidate communes (INSEE COG 2026), each with « in the Eurométropole » and its QPV
 *   GET /api/territory/qpv?commune=67482  → the 2024 quartiers prioritaires that list the commune (ANCT), never whether an address lies in one
 * Answers: 200 with a status (SINGLE / MULTIPLE / UNKNOWN_POSTAL_CODE / OK), 400 INVALID, 503 UNAVAILABLE (reference file missing), 405, 429.
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { qpvForCommune, resolvePostalCode } from '../lib/geography/postalReference.js';

/** @param {any} req */
function routePath(req) {
  try { return new URL(String(req.url || ''), 'http://local').pathname.replace(/^\/api\//, '').replace(/\/$/, ''); } catch { return ''; }
}

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const rl = await checkRateLimit('TERRITORY_LOOKUP', getClientIp(req));
  if (!rl.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (rl))).json(rl.error || { error: 'Trop de demandes.', code: 'RATE_LIMITED' });

  const q = req.query || {};
  const path = routePath(req);
  // the reference changes only with a release: a short public cache, never a personal one
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (path.endsWith('territory/qpv')) {
    const out = qpvForCommune(String(Array.isArray(q.commune) ? q.commune[0] : q.commune || ''));
    if (out.status === 'INVALID') return res.status(400).json({ status: 'INVALID', error: 'Code commune Insee attendu (5 caractères).' });
    if (out.status === 'UNAVAILABLE') return res.status(503).json({ status: 'UNAVAILABLE', error: 'Référence indisponible.' });
    return res.status(200).json(out);
  }

  const out = resolvePostalCode(String(Array.isArray(q.code) ? q.code[0] : q.code || ''));
  if (out.status === 'INVALID') return res.status(400).json({ status: 'INVALID', error: 'Code postal attendu (5 chiffres).' });
  if (out.status === 'UNAVAILABLE') return res.status(503).json({ status: 'UNAVAILABLE', error: 'Référence indisponible.' });
  return res.status(200).json(out);
}
