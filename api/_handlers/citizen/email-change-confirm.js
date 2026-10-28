import { confirmEmailChange } from '../../_services/email-change.js';
import { redirect } from '../../_utils/user-auth.js';
import logger from '../../_utils/logger.js';

/**
 * GET /api/citizen/email-change-confirm?token=… — the single-use link sent to the NEW address (launch-readiness item 66). It redirects to the account page with
 * the outcome (changed | expired | invalid | taken); the token is never echoed.
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const raw = typeof req.query?.token === 'string' ? req.query.token : (() => { try { return new URL(req.url || '', 'http://localhost').searchParams.get('token') || ''; } catch { return ''; } })();
  try {
    const out = await confirmEmailChange(raw);
    return redirect(res, `/auth/login?email_change=${encodeURIComponent(out.status)}`, 302);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.name : 'error' }, '[citizen/email-change-confirm] failed');
    return redirect(res, '/auth/login?email_change=error', 302);
  }
}
