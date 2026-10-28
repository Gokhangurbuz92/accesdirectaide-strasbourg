// @ts-nocheck
import logger from '../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { isFeatureOn } from '../_services/feature-flags.js';
import { createRequest } from '../_services/support.js';

/** PKG-5 / A19 — POST /api/support { category, message, contact? }: a help request, stored sealed; abuse-limited; the administrator kill switch applies. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!(await isFeatureOn('SUPPORT_FORM'))) return res.status(503).json({ error: 'FEATURE_DISABLED', message: 'Le formulaire est momentanément fermé.' });
    const rl = await checkRateLimit('FEEDBACK', `support:${getClientIp(req)}`);
    if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many requests' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.website) return res.status(201).json({ ok: true });   // honeypot: silently ignored
    const out = await createRequest(b);
    return out.ok ? res.status(201).json({ ok: true, reference: out.id.slice(0, 8), privacy: out.privacy }) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Support] failed');
    return res.status(500).json({ error: 'SUPPORT_FAILED' });
  }
}
