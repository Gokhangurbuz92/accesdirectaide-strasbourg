// @ts-check
/**
 * G14-R3 / R4 — browser client of the HDS service (services/hds). For each call: a single-use ticket from the main API (/api/citizen/hds-ticket or, for an
 * ADA Pro member, /api/pro/hds-ticket — cookie session), then the request goes DIRECTLY to the HDS origin with `Authorization: Bearer <ticket>` — no cookie
 * (credentials: 'omit'), no referrer, nothing in the URL. The main API never sees the document. When the main API answers HDS_GATEWAY_NOT_CONFIGURED (the LAB
 * without an HDS service), the caller keeps its legacy path (null is returned) and that answer is remembered for the page's life.
 */

/** @type {'hds' | 'legacy' | null} */
let mode = null;
/** @type {Promise<boolean | null> | null} the one /api/status read of this page */
let gatewayProbe = null;
/** the mode learnt from the last ticket request (null = not asked yet) */
export const hdsVaultMode = () => mode;
/** tests only */
export const resetHdsMode = () => { mode = null; gatewayProbe = null; };

/** @typedef {{ status: number, code: string, serverMessage: string }} HdsFailure */
/** @typedef {{ side?: 'citizen' | 'pro', conversation?: string }} TicketOptions */

/** @param {number} status @param {any} data @returns {HdsFailure} */
const failure = (status, data) => ({ status, code: typeof data?.error === 'string' ? data.error : '', serverMessage: typeof data?.message === 'string' ? data.message : '' });

/** the professional ticket goes through the ADA Pro client (its own session header) @param {string} cap @param {TicketOptions} o */
async function proTicket(cap, o) {
  const { proRdvRequest } = await import('@/api/pro-rdv-client');
  try {
    const data = await proRdvRequest('/api/pro/hds-ticket', { query: { cap, ...(o.conversation ? { conversation: o.conversation } : {}) } });
    return { status: 200, data };
  } catch (e) {
    const err = /** @type {any} */ (e);
    return { status: Number(err?.status) || 0, data: err?.payload || { error: err?.status ? '' : 'network' } };
  }
}

/** @param {string} cap @param {TicketOptions} [o] @returns {Promise<{ ticket: string, origin: string, role?: string } | null>} */
export async function hdsTicket(cap, o = {}) {
  if (mode === 'legacy') return null;
  if (mode === null && !gatewayProbe) {
    // QA v81 DTA-B33: a server without an HDS gateway says so in /api/status (features.hdsGateway === false) → legacy path without a ticket request
    // (no expected 503 in the console). Unknown (error, old server) → the ticket is asked as before (the server stays the authority).
    const { fetchServerFeatureState } = await import('./serverFeatures.js');
    gatewayProbe = fetchServerFeatureState('hdsGateway');
  }
  if (mode === null && (await gatewayProbe) === false) { mode = 'legacy'; return null; }
  let status = 0;
  /** @type {any} */
  let data = {};
  if (o.side === 'pro') { const r = await proTicket(cap, o); status = r.status; data = /** @type {any} */ (r.data); }
  else {
    const q = `cap=${encodeURIComponent(cap)}${o.conversation ? `&conversation=${encodeURIComponent(o.conversation)}` : ''}`;
    let res;
    try { res = await fetch(`/api/citizen/hds-ticket?${q}`, { credentials: 'same-origin' }); } catch { throw failure(0, { error: 'network' }); }
    status = res.status; data = /** @type {any} */ (await res.json().catch(() => ({})));
  }
  if ((status === 503 && data?.error === 'HDS_GATEWAY_NOT_CONFIGURED') || (status === 404 && !o.conversation)) { mode = 'legacy'; return null; }
  if (status !== 200 || typeof data?.ticket !== 'string' || typeof data?.origin !== 'string') throw failure(status, data);
  mode = 'hds';
  return { ticket: data.ticket, origin: data.origin, ...(data.role ? { role: String(data.role) } : {}) };
}

/**
 * @param {string} cap @param {string} path @param {{ method?: string, body?: unknown } & TicketOptions} [opts]
 * @returns {Promise<any | null>} null = no HDS service here (use the legacy path)
 */
export async function hdsRequest(cap, path, opts = {}) {
  const t = await hdsTicket(cap, opts);
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
