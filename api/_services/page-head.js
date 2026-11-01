// @ts-nocheck
/**
 * P22 — source-aware prerendering of the public record pages (/aides/<slug>, /demarches/<slug>, /dispositifs/<slug>, /structures/<slug>): the INITIAL HTML a
 * crawler or a browser receives already carries the page's canonical address, title, description and a short readable summary — computed at request time
 * from the database with the same visibility rule as the API (api/lib/publicVisibility.js visibleWhere), never at build time:
 *  - a record shown to the public: 200, its own title and published summary (the text the automatic veille verified for the accepted source version), index;
 *  - a record withdrawn or no longer current (it was published, it is not now): 410 Gone, noindex, and NOTHING of the record (no title, no reason);
 *  - no such record, or a record never published (a draft, a record held before any publication): 404, noindex — the same answer as an unknown address;
 *  - /annuaire/<slug>: 301 to /structures/<slug> (the canonical address of a place).
 * Invalidation follows the sources: nothing is built in advance, the shared cache keeps an answer at most MAX_AGE seconds (ETag from the record's state), so a
 * correction or a withdrawal by the veille reaches the HTML within minutes. Build time and size: zero (one template, read once). The SPA then renders the page.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Aide, Demarche, Dispositif, Structure } from '../../src/db/schema.js';
import { visibleWhere } from '../lib/publicVisibility.js';

export const MAX_AGE = 300;
const KINDS = {
  aides: { kind: 'aide', table: Aide, title: 'titre', desc: 'description', updated: 'updatedAt', label: 'Aide' },
  demarches: { kind: 'demarche', table: Demarche, title: 'titre', desc: 'description_courte', updated: 'updatedAt', label: 'Démarche' },
  dispositifs: { kind: 'dispositif', table: Dispositif, title: 'titre', desc: 'summary_falc', updated: 'updatedAt', label: 'Dispositif' },
  structures: { kind: 'structure', table: Structure, title: 'nom', desc: 'description_courte', updated: 'updatedAt', label: 'Lieu d’accueil' },
};
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const SITE = 'AccesDirectAide';

/** which record page an address is: { section, slug } | { redirect } | null (not a record page) */
export function recordPath(pathname) {
  const m = String(pathname || '').match(/^\/(aides|demarches|dispositifs|structures|annuaire)\/([^/?#]+)\/?$/);
  if (!m) return null;
  let slug; try { slug = decodeURIComponent(m[2]); } catch { return { section: m[1], slug: null }; }
  if (m[1] === 'annuaire') return SLUG.test(slug) ? { redirect: `/structures/${encodeURIComponent(slug)}` } : { section: 'structures', slug: null };
  return { section: m[1], slug: SLUG.test(slug) ? slug : null };
}

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = squash(s); return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`; };
export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The head of a page: { status, location?, title, description, canonical, robots, summary?, etag }.
 * @param {{ db: any, pathname: string, origin: string, now?: Date }} o
 */
export async function pageHead({ db, pathname, origin, now = new Date() }) {
  const p = recordPath(pathname);
  if (!p) return null;
  if (p.redirect) return { status: 301, location: p.redirect };
  const notFound = { status: 404, title: `Page introuvable — ${SITE}`, description: 'Cette page n’existe pas ou n’est pas publiée.', canonical: null, robots: 'noindex, nofollow' };
  if (!p.slug) return { ...notFound, etag: tag('404', pathname) };
  const k = KINDS[p.section]; const t = k.table;
  const [row] = await db.select({ id: t.id, slug: t.slug, name: t[k.title], description: t[k.desc], statut: t.statut, publishedAt: t.published_at, updatedAt: t[k.updated],
    verifiedAt: t.date_verification, hold: t.publication_hold, sourceUrl: t.source_url }).from(t).where(eq(t.slug, p.slug)).limit(1);
  if (!row) return { ...notFound, etag: tag('404', pathname) };
  const [visible] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, row.id), visibleWhere(t, k.kind, { now }))).limit(1);
  const iso = (d) => (d ? new Date(d).toISOString() : '');
  const state = [row.id, row.statut, row.hold ? 'h' : '', iso(row.updatedAt), iso(row.verifiedAt), crypto.createHash('sha256').update(`${row.name}|${row.description || ''}|${row.sourceUrl || ''}`).digest('hex')].join('|');
  if (!visible) {
    // once public, now withdrawn or expired: Gone (a search engine drops it); never published: as unknown. Nothing of the record is said either way.
    return row.publishedAt ? { status: 410, title: `Page retirée — ${SITE}`, description: 'Cette information a été retirée : elle n’est plus vérifiée ou n’est plus d’actualité.', canonical: null, robots: 'noindex, nofollow', etag: tag('410', state) }
      : { ...notFound, etag: tag('404', state) };
  }
  const canonical = `${origin}/${p.section}/${encodeURIComponent(row.slug)}`;
  const name = cut(row.name, 90);
  const description = cut(row.description || `${k.label} : ${row.name}. Information vérifiée auprès de sources officielles.`, 160);
  return { status: 200, title: `${name} — ${SITE}`, description, canonical, robots: 'index, follow', summary: { label: k.label, name: squash(row.name), text: squash(row.description || ''), source: officialUrl(row.sourceUrl), verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null }, etag: tag('200', state) };
}
/** the record's official page, only as an http(s) address @param {unknown} u */
const officialUrl = (u) => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x : null; } catch { return null; } };
const frDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
/** the provenance line of the readable summary: where the information comes from and when it was last checked (visible without JavaScript) */
const provenance = (s) => {
  const parts = [];
  if (s.source) parts.push(`Source officielle : <a href="${escapeHtml(s.source.href)}" rel="noopener">${escapeHtml(s.source.hostname.replace(/^www\./, ''))}</a>.`);
  if (s.verifiedAt && !Number.isNaN(s.verifiedAt.getTime())) parts.push(`Vérifiée le ${escapeHtml(frDate(s.verifiedAt))}.`);
  return parts.length ? `<p>${parts.join(' ')}</p>` : '';
};
const tag = (...parts) => `"${crypto.createHash('sha256').update(parts.join('#')).digest('hex').slice(0, 32)}"`;

/** the template with the page's head (title, description, canonical, robots, Open Graph) and a readable summary the SPA replaces when it starts */
export function renderPage(template, h) {
  let html = template;
  const set = (re, tagText) => { html = re.test(html) ? html.replace(re, tagText) : html.replace('</head>', `  ${tagText}\n</head>`); };
  set(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(h.title)}</title>`);
  set(/<meta\s+name="description"[\s\S]*?\/?>/, `<meta name="description" content="${escapeHtml(h.description)}" />`);
  set(/<meta\s+property="og:title"[\s\S]*?\/?>/, `<meta property="og:title" content="${escapeHtml(h.title)}" />`);
  set(/<meta\s+property="og:description"[\s\S]*?\/?>/, `<meta property="og:description" content="${escapeHtml(h.description)}" />`);
  set(/<meta\s+name="twitter:title"[\s\S]*?\/?>/, `<meta name="twitter:title" content="${escapeHtml(h.title)}" />`);
  set(/<meta\s+name="twitter:description"[\s\S]*?\/?>/, `<meta name="twitter:description" content="${escapeHtml(h.description)}" />`);
  if (h.canonical) {
    set(/<link\s+rel="canonical"[\s\S]*?\/?>/, `<link rel="canonical" href="${escapeHtml(h.canonical)}" data-rh="true" />`);
    set(/<meta\s+property="og:url"[\s\S]*?\/?>/, `<meta property="og:url" content="${escapeHtml(h.canonical)}" data-rh="true" />`);
  } else {
    html = html.replace(/\s*<link\s+rel="canonical"[\s\S]*?\/?>/, '').replace(/\s*<meta\s+property="og:url"[\s\S]*?\/?>/, '');
  }
  set(/<meta\s+name="robots"[\s\S]*?\/?>/, `<meta name="robots" content="${escapeHtml(h.robots)}" />`);
  const body = h.status === 200 && h.summary
    ? `<main data-prerender="${escapeHtml(h.summary.label)}"><h1>${escapeHtml(h.summary.name)}</h1>${h.summary.text ? `<p>${escapeHtml(h.summary.text)}</p>` : ''}${provenance(h.summary)}</main>`
    : `<main data-prerender="${h.status}"><h1>${escapeHtml(h.title.replace(` — ${SITE}`, ''))}</h1><p>${escapeHtml(h.description)}</p><p><a href="/">Retour à l’accueil</a></p></main>`;
  return html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

/**
 * Public beta (owner directive 29/10/2026): a record page is the SPA's HTML served by the API function, whose own API policy (no inline-script hash, no map
 * tiles) replaced the hosting's page policy and blocked the accessibility bootstrap script and the map. Same value as the vercel.json page header (tested).
 */
export const PAGE_CSP = "default-src 'self'; script-src 'self' 'sha256-Ji1RDZFcXHYwXORx2Mz2R71m8j2Y73X371QJqvYvIHQ='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests; report-uri /api/monitor/csp-report; report-to csp;";

/** the headers of the answer: a shared cache of at most MAX_AGE seconds (a withdrawal by the veille is seen within minutes), never for an error page */
export function pageHeaders(h) {
  const base = { 'Content-Type': 'text/html; charset=utf-8', ETag: h.etag, 'X-Robots-Tag': h.robots, 'Content-Security-Policy': PAGE_CSP };
  if (h.status === 200) return { ...base, 'Cache-Control': `public, max-age=0, s-maxage=${MAX_AGE}, stale-while-revalidate=60` };
  return { ...base, 'Cache-Control': 'public, max-age=0, s-maxage=60' };
}

let cachedTemplate = null;
/** the built index.html (dist/ on the hosting, the LAB's build directory) — read once */
export function loadTemplate(candidates = [path.resolve('dist', 'index.html'), path.resolve('index.html')]) {
  if (cachedTemplate) return cachedTemplate;
  for (const f of candidates) { try { const t = fs.readFileSync(f, 'utf8'); if (t.includes('<div id="root"></div>')) { cachedTemplate = t; return t; } } catch { /* next */ } }
  return null;
}
export const resetTemplate = () => { cachedTemplate = null; };
