/**
 * Content-Security-Policy violation reports (launch-readiness item 49): the browser posts here when the policy blocks something (`report-uri` and
 * `report-to csp`, see vercel.json). Only what helps fix the policy is logged — the directive, the blocked ORIGIN, the page PATH — never a query string,
 * a full URL or the code sample, which could carry personal data. Nothing is stored. Always 204; rate-limited per address.
 */
import logger from '../../_utils/logger.js';
import { checkRateLimit } from '../../_utils/rateLimit.js';
import { clientIp } from '../../_utils/client-ip.js';

const KEYWORDS = new Set(['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const originOf = (/** @type {unknown} */ v) => {
  const s = String(v || '').trim();
  if (!s || KEYWORDS.has(s)) return s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.origin : `${u.protocol}`; } catch { return 'other'; }
};
const pathOf = (/** @type {unknown} */ v) => { try { return new URL(String(v || '')).pathname.slice(0, 120); } catch { return ''; } };

/** Legacy `application/csp-report` ({ "csp-report": {…} }) and Reporting API (`[{ type: "csp-violation", body: {…} }]`) bodies → safe summaries. @param {any} body */
export function summarizeCspReports(body) {
  let data = body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) data = data.toString('utf8');
  if (typeof data === 'string') {
    if (data.length > 65536) return [];
    try { data = JSON.parse(data); } catch { return []; }
  }
  const list = Array.isArray(data) ? data.filter((r) => !r?.type || r.type === 'csp-violation').map((r) => r?.body) : [data?.['csp-report']];
  return list.slice(0, 10).filter((r) => r && typeof r === 'object').map((r) => ({
    directive: String(r.effectiveDirective || r['effective-directive'] || r['violated-directive'] || '').split(/\s+/)[0].slice(0, 40),
    blocked: originOf(r.blockedURL ?? r['blocked-uri']),
    page: pathOf(r.documentURL ?? r['document-uri']),
    disposition: String(r.disposition || 'enforce').slice(0, 10),
  }));
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const limit = await checkRateLimit('CSP_REPORT', clientIp(req, '127.0.0.1')).catch(() => null);
  if (limit && limit.allowed !== false) for (const r of summarizeCspReports(req.body)) logger.warn({ msg: 'csp.violation', ...r });
  res.status(204);
  return res.end();
}
