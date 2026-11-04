/**
 * Content-Security-Policy violation reports (launch-readiness item 49; R42-POLISH staged reporting, R41 review F8): the browser posts here when the policy
 * blocks something (`report-uri` and `report-to csp`, see vercel.json). Whether reports are accepted at all is decided by api/_utils/csp-reporting.js
 * (LAB: on; Production: off unless ADA_CSP_REPORTS=log). When on, only what helps fix the policy is logged — the directive, the blocked ORIGIN, the page
 * PATH TEMPLATE (ids, tokens, query string and fragment removed) and the disposition — never a full URL, a code sample, a referrer, a source file, the
 * address, a cookie or a header. Nothing is stored and nothing is sent to an external collector. Always 204.
 * Volume: per-address rate limit (CSP_REPORT; when the limiter is unavailable nothing is logged), optional sampling (ADA_CSP_REPORT_SAMPLE), the same
 * summary logged at most once per 10 minutes per instance (repeats are counted), and at most 60 log lines per minute per instance.
 */
import logger from '../../_utils/logger.js';
import { checkRateLimit } from '../../_utils/rateLimit.js';
import { clientIp } from '../../_utils/client-ip.js';
import { cspReportsMode, cspSampleRate, pageTemplate } from '../../_utils/csp-reporting.js';

const KEYWORDS = new Set(['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const originOf = (/** @type {unknown} */ v) => {
  const s = String(v || '').trim();
  if (!s || KEYWORDS.has(s)) return s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.origin : `${u.protocol}`; } catch { return 'other'; }
};

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
    directive: String(r.effectiveDirective || r['effective-directive'] || r['violated-directive'] || '').split(/\s+/)[0].replace(/[^a-z-]/g, '').slice(0, 40),
    blocked: originOf(r.blockedURL ?? r['blocked-uri']).slice(0, 120),
    page: pageTemplate(r.documentURL ?? r['document-uri']),
    disposition: String(r.disposition || 'enforce') === 'report' ? 'report' : 'enforce',
  }));
}

const DEDUPE_MS = 10 * 60 * 1000;
const MAX_KEYS = 500;
const MAX_LINES_PER_MINUTE = 60;
/** @type {Map<string, { at: number, repeats: number }>} */
const seen = new Map();
let minute = { start: 0, lines: 0 };

/** test helper: forget the per-instance state */
export function resetCspReportState() { seen.clear(); minute = { start: 0, lines: 0 }; }

/** @param {{ directive: string, blocked: string, page: string, disposition: string }} r @param {number} now */
function logOnce(r, now) {
  const key = `${r.directive}|${r.blocked}|${r.page}|${r.disposition}`;
  const prev = seen.get(key);
  if (prev && now - prev.at < DEDUPE_MS) { prev.repeats += 1; return; }
  if (now - minute.start >= 60000) minute = { start: now, lines: 0 };
  if (minute.lines >= MAX_LINES_PER_MINUTE) return;
  minute.lines += 1;
  if (!prev && seen.size >= MAX_KEYS) { const oldest = seen.keys().next().value; if (oldest !== undefined) seen.delete(oldest); }
  seen.delete(key);
  seen.set(key, { at: now, repeats: 0 });
  logger.warn({ msg: 'csp.violation', ...r, ...(prev?.repeats ? { repeatsSinceLast: prev.repeats } : {}) });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  if (cspReportsMode() === 'log' && Math.random() < cspSampleRate()) {
    const limit = await checkRateLimit('CSP_REPORT', clientIp(req, '127.0.0.1')).catch(() => null);
    if (limit && limit.allowed !== false) { const now = Date.now(); for (const r of summarizeCspReports(req.body)) logOnce(r, now); }
  }
  res.status(204);
  return res.end();
}
