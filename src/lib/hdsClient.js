// @ts-check
/**
 * G14-R3 — browser client of the HDS service (services/hds). For each call: a single-use ticket from the main API (/api/citizen/hds-ticket, cookie
 * session), then the request goes DIRECTLY to the HDS origin with `Authorization: Bearer <ticket>` — no cookie (credentials: 'omit'), no referrer, nothing
 * in the URL. The main API never sees the document. When the main API answers HDS_GATEWAY_NOT_CONFIGURED (the LAB without an HDS service), the caller
 * keeps its legacy path (null is returned) and that answer is remembered for the page's life.
 */

/** @type {'hds' | 'legacy' | null} */
let mode = null;
/** the mode learnt from the last ticket request (null = not asked yet) */
export const hdsVaultMode = () => mode;
/** tests only */
export const resetHdsMode = () => { mode = null; };

/** @typedef {{ status: number, code: string, serverMessage: string }} HdsFailure */

/** @param {number} status @param {any} data @returns {HdsFailure} */
const failure = (status, data) => ({ status, code: typeof data?.error === 'string' ? data.error : '', serverMessage: typeof data?.message === 'string' ? data.message : '' });

/** @param {string} cap @returns {Promise<{ ticket: string, origin: string } | null>} */
export async function hdsTicket(cap) {
  if (mode === 'legacy') return null;
  let res;
  try { res = await fetch(`/api/citizen/hds-ticket?cap=${encodeURIComponent(cap)}`, { credentials: 'same-origin' }); } catch { throw failure(0, { error: 'network' }); }
  const data = await res.json().catch(() => ({}));
  if ((res.status === 503 && data.error === 'HDS_GATEWAY_NOT_CONFIGURED') || res.status === 404) { mode = 'legacy'; return null; }
  if (!res.ok || typeof data.ticket !== 'string' || typeof data.origin !== 'string') throw failure(res.status, data);
  mode = 'hds';
  return { ticket: data.ticket, origin: data.origin };
}

/**
 * @param {string} cap @param {string} path @param {{ method?: string, body?: unknown }} [opts]
 * @returns {Promise<any | null>} null = no HDS service here (use the legacy path)
 */
export async function hdsRequest(cap, path, opts = {}) {
  const t = await hdsTicket(cap);
  if (!t) return null;
  let res;
  try {
    res = await fetch(`${t.origin}${path}`, {
      method: opts.method || 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { Authorization: `Bearer ${t.ticket}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch { throw failure(0, { error: 'network' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res.status, data);
  return data;
}

/** save a Blob as a download (no URL of the document ever leaves the page) @param {Blob} blob @param {string} fileName */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
