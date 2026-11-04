/**
 * R42-POLISH (R41 review F8) — staged, privacy-preserving CSP violation reporting.
 *
 * The CSP headers (vercel.json, page-head.js) send violation reports to /api/monitor/csp-report. During the restricted beta that route answered 503
 * (edge middleware + api/index.js allowlist), so every report was lost. This module decides, from the environment only, whether reports are accepted:
 *
 *   ADA_CSP_REPORTS=log   reports are accepted and a minimised summary is written to the server log (Vercel log drain = the only sink; no external collector)
 *   ADA_CSP_REPORTS=off   reports are refused by the beta gate (503) and ignored by the handler (204, nothing logged)
 *   unset / other value   LAB (VERCEL_ENV development or preview): « log »; Production or an unknown environment: « off » (fail-closed)
 *
 * Opening the route never opens the « jobs » surface or any other monitor route: only POST monitor/csp-report (exact path) is concerned.
 * This file is imported by the edge middleware: no Node-only import.
 */

/** @typedef {Record<string, string | undefined>} EnvVars */

export const CSP_REPORT_PATH = 'monitor/csp-report';

/** @param {EnvVars} [envVars] @returns {'log' | 'off'} */
export function cspReportsMode(envVars = process.env) {
  const flag = String(envVars.ADA_CSP_REPORTS || '').trim().toLowerCase();
  if (flag === 'off') return 'off';
  if (flag === 'log') return 'log';
  const stage = String(envVars.VERCEL_ENV || '').trim().toLowerCase();
  return stage === 'development' || stage === 'preview' ? 'log' : 'off';
}

/** does the beta gate let this request through (POST to the exact report path, reporting on) @param {string} method @param {string} path normalized, no /api/ @param {EnvVars} [envVars] */
export function isCspReportRequest(method, path, envVars = process.env) {
  return String(method || '').toUpperCase() === 'POST' && String(path || '') === CSP_REPORT_PATH && cspReportsMode(envVars) === 'log';
}

/** the sampling rate (0..1], default 1; an invalid value means 1 @param {EnvVars} [envVars] */
export function cspSampleRate(envVars = process.env) {
  const n = Number(envVars.ADA_CSP_REPORT_SAMPLE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
}

// a path segment is kept only when it is a plain word or slug without digits (a section name: « aides », « mon-espace »); anything else — ids, uuids,
// tokens, slugs with digits, e-mail addresses, encoded text — becomes « :id ». At most 4 segments are kept.
const WORD = /^[a-z][a-z-]{0,59}$/;
const MAX_SEGMENTS = 4;
/** @param {string} segment */
const keepSegment = (segment) => {
  let s = segment;
  try { s = decodeURIComponent(segment); } catch { return ':id'; }
  if (!WORD.test(s)) return ':id';
  if (!s.includes('-') && s.length > 24) return ':id';   // a long letters-only run is more likely a token than a section name
  return s;
};

/** the page path of a report as a template: no origin, query string, fragment, id or token @param {unknown} value */
export function pageTemplate(value) {
  let pathname = '';
  try { pathname = new URL(String(value || '')).pathname; } catch { return ''; }
  const parts = pathname.split('/').filter(Boolean);
  const kept = parts.slice(0, MAX_SEGMENTS).map(keepSegment);
  return `/${kept.join('/')}${parts.length > MAX_SEGMENTS ? '/…' : ''}`;
}
