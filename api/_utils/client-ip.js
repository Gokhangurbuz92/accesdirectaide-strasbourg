/**
 * The client address used by rate limits, consent proofs and audit lines (launch-readiness item 48).
 *
 * On Vercel (VERCEL=1) the edge writes x-vercel-forwarded-for, x-real-ip and x-forwarded-for from the connection and overwrites any value the client sent
 * (platform documentation). That is an OFFLINE ASSUMPTION until it is checked on the first preview deployment (docs/deployment.md § Client address).
 * Elsewhere (the LAB on 127.0.0.1, the tests) the first x-forwarded-for hop, then the socket; a self-hosted deployment must sit behind a proxy that
 * overwrites x-forwarded-for. Only an address-shaped value is returned (no header text ends up in a rate-limit key or a log line).
 */
const ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;
const firstHop = (/** @type {unknown} */ v) => String(Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0].trim();

/** @param {{ headers?: Record<string, any>, socket?: { remoteAddress?: string } } | undefined} req @param {string} [fallback] */
export function clientIp(req, fallback = 'unknown') {
  const h = req?.headers || {};
  const candidates = process.env.VERCEL === '1' ? [h['x-vercel-forwarded-for'], h['x-real-ip'], h['x-forwarded-for']] : [h['x-forwarded-for'] ?? h['X-Forwarded-For']];
  for (const c of candidates) { const ip = firstHop(c); if (ADDRESS.test(ip)) return ip; }
  const socket = String(req?.socket?.remoteAddress || '');
  return ADDRESS.test(socket) ? socket : fallback;
}
