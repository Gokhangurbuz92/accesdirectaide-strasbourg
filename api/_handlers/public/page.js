// @ts-nocheck
/**
 * P22 — GET /api/public/page?path=/aides/<slug> (the hosting rewrites the record pages here; the LAB server calls api/_services/page-head.js directly): the SPA's
 * index.html with the record's canonical address, title, description and summary in the INITIAL HTML, 404 / 410 / 301 as the record's state says (page-head.js).
 * HEAD and If-None-Match are answered without a body. A failure of the database answers the plain SPA (503, not cached, noindex): the page itself still works.
 */
import { db } from '../../../src/db/index.js';
import { getCanonicalOrigin } from '../../_utils/site-origin.js';
import { pageHead, renderPage, pageHeaders, loadTemplate } from '../../_services/page-head.js';
import logger from '../../_utils/logger.js';

let fetchedTemplate = null;
/**
 * R12 (P22): where the hosting's static copy is fetched from — the deployment itself (production origin, or the platform-set VERCEL_URL of a preview),
 * NEVER the request's Host header (outside production that header is the caller's: a forged Host made the instance fetch and cache another site's page
 * and serve it to everyone). Outside the hosting (LAB, tests) nothing is fetched.
 */
function templateOrigin() {
  if (process.env.VERCEL_ENV === 'production') return getCanonicalOrigin({ headers: {} });
  const own = String(process.env.VERCEL_URL || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return own && /^[a-z0-9.-]+$/i.test(own) ? `https://${own}` : null;
}
/** the built index.html: from the function's files, else the hosting's own static copy (fetched once per instance) */
async function template() {
  const local = loadTemplate();
  if (local) return local;
  if (fetchedTemplate) return fetchedTemplate;
  const origin = templateOrigin();
  if (!origin) return null;
  const r = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  const t = r.ok ? await r.text() : null;
  if (t && t.includes('<div id="root"></div>')) fetchedTemplate = t;
  return fetchedTemplate;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const origin = getCanonicalOrigin(req);
  const pathname = String(req.query?.path || '').slice(0, 300);
  let tpl = null;
  try {
    tpl = await template();
    const h = await pageHead({ db, pathname, origin });
    if (!h) return res.status(404).json({ error: 'Not a record page' });
    if (h.status === 301) { res.writeHead(301, { Location: h.location, 'Cache-Control': 'public, max-age=3600' }); return res.end(); }
    if (!tpl) throw new Error('template unavailable');
    const headers = pageHeaders(h);
    if (req.headers?.['if-none-match'] === h.etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(h.status, headers);
    return res.end(req.method === 'HEAD' ? undefined : renderPage(tpl, h));
  } catch (e) {
    logger.warn({ err: e?.message }, '[page] head not computed: plain page');
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Retry-After': '60' });
    return res.end(req.method === 'HEAD' ? undefined : (tpl || '<!doctype html><title>AccesDirectAide</title><p>Service momentanément indisponible.</p>'));
  }
}
