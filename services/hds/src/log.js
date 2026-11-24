// @ts-check
/**
 * G14-R3 — the ONLY logger of the HDS service. Deny by default: it accepts a closed set of fields (no free text from a request, no body, no query
 * string, no header, no ticket, no identifier in clear). The route is the TEMPLATE (/v1/vault/documents/:id), never the concrete path. An error is
 * logged by its code/name only (a PostgreSQL error message may quote a value). Output: one JSON line on stdout — Scalingo platform logs only; no log
 * drain and no error tracker on the HDS app (G14_HDS_MIGRATION_PLAN.md § 8).
 */
const ALLOWED = new Set(['evt', 'rid', 'm', 'route', 's', 'ms', 'code', 'n', 'reason']);
const SAFE_VALUE = /^[A-Za-z0-9_.:/\-]{0,80}$/;

/** @type {(line: string) => void} */
let sink = (line) => { process.stdout.write(`${line}\n`); };
/** tests capture the output @param {(line: string) => void} fn */
export function setLogSink(fn) { sink = fn; }

/** @param {Record<string, unknown>} fields */
export function log(fields) {
  /** @type {Record<string, string | number>} */
  const out = { t: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && SAFE_VALUE.test(v)) out[k] = v;
    else out[k] = '[redacted]';
  }
  sink(JSON.stringify(out));
}
