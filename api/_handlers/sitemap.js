import { visibleWhere } from '../lib/publicVisibility.js';
import logger from '../_utils/logger.js';
import { randomUUID } from 'crypto';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { getCanonicalOrigin } from '../_utils/site-origin.js';
import { isPublicBetaRestricted } from '../_utils/public-beta.js';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

const CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
const MAX_DYNAMIC_URLS = 10000;

const STATIC_PUBLIC_PATHS = [
  '/',
  '/aides',
  '/demarches',
  '/structures',
  '/dispositifs',
  '/actualites',
  '/bonnes-pratiques',
  '/outils',
  '/orientation',
  '/mentions-legales',
  '/accessibilite',
  '/contact',
];

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {Date | null | undefined} value
 * @returns {string | null}
 */
function toLastMod(value) {
  if (!(value instanceof Date)) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {Date | null | undefined} updatedAt
 * @returns {string}
 */
function buildUrlNode(baseUrl, path, updatedAt) {
  const loc = `${baseUrl}${path}`;
  const lastmod = toLastMod(updatedAt);
  if (!lastmod) {
    return `  <url><loc>${escapeXml(loc)}</loc></url>`;
  }
  return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`;
}

/**
 * @param {string} baseUrl
 * @param {Array<{slug: string | null, updatedAt: Date}>} aides
 * @param {Array<{slug: string | null, updatedAt: Date}>} demarches
 * @param {Array<{slug: string | null, updatedAt: Date}>} structures
 * @param {Array<{slug: string | null, updatedAt: Date}>} [dispositifs]
 * @param {{ guides?: Array<{slug: string | null, updatedAt?: Date | null}>, actualites?: Array<{slug: string | null, updatedAt?: Date | null}> }} [more]
 * @returns {string}
 */
export function buildSitemapXml(baseUrl, aides, demarches, structures, dispositifs = [], more = {}) {
  /** @type {string[]} */
  const nodes = [];

  // Static pages
  // public beta: a closed screen (assistant, contact…) answers with a notice, not with content — it is not offered to crawlers
  for (const path of STATIC_PUBLIC_PATHS.filter((x) => !(isPublicBetaRestricted() && isBetaRestrictedPath(x)))) {
    nodes.push(buildUrlNode(baseUrl, path, null));
  }

  // Dynamic: aides
  for (const aide of aides) {
    if (!aide?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/aides/${aide.slug}`, aide.updatedAt));
  }

  // Dynamic: démarches
  for (const demarche of demarches) {
    if (!demarche?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/demarches/${demarche.slug}`, demarche.updatedAt));
  }

  // Dynamic: structures (annuaire)
  for (const structure of structures) {
    if (!structure?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/structures/${encodeURIComponent(structure.slug)}`, structure.updatedAt));   // P22: the canonical address of a place (/annuaire/<slug> answers 301 to it)
  }

  // Dynamic: dispositifs (P22: they have their own public page)
  for (const dispositif of dispositifs) {
    if (!dispositif?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/dispositifs/${encodeURIComponent(dispositif.slug)}`, dispositif.updatedAt));
  }

  // R29: the published official guides and the verified news items
  for (const guide of more.guides || []) {
    if (!guide?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/bonnes-pratiques/${encodeURIComponent(guide.slug)}`, guide.updatedAt));
  }
  for (const actu of more.actualites || []) {
    if (!actu?.slug) continue;
    nodes.push(buildUrlNode(baseUrl, `/actualites/${encodeURIComponent(actu.slug)}`, actu.updatedAt));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${nodes.join('\n')}
</urlset>`;
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();
  const baseUrl = getCanonicalOrigin(req);

  try {
    // Parallel queries for all dynamic content types
    const [aides, demarches, structures, dispositifs, guides, actualites] = await Promise.all([
      db.query.Aide.findMany({
        where: and(visibleWhere(schema.Aide, 'aide'), isNotNull(schema.Aide.slug)),
        columns: { slug: true, updatedAt: true },
        limit: MAX_DYNAMIC_URLS,
        orderBy: [desc(schema.Aide.updatedAt)],
      }),
      db.query.Demarche.findMany({
        where: and(visibleWhere(schema.Demarche, 'demarche'), isNotNull(schema.Demarche.slug)),
        columns: { slug: true, updatedAt: true },
        limit: MAX_DYNAMIC_URLS,
        orderBy: [desc(schema.Demarche.updatedAt)],
      }),
      db.query.Structure.findMany({
        where: and(visibleWhere(schema.Structure, 'structure'), isNotNull(schema.Structure.slug)),
        columns: { slug: true, updatedAt: true },
        limit: MAX_DYNAMIC_URLS,
        orderBy: [desc(schema.Structure.updatedAt)],
      }),
      db.query.Dispositif.findMany({
        where: and(visibleWhere(schema.Dispositif, 'dispositif'), isNotNull(schema.Dispositif.slug)),
        columns: { slug: true, updatedAt: true },
        limit: MAX_DYNAMIC_URLS,
        orderBy: [desc(schema.Dispositif.updatedAt)],
      }),
      db.query.Guide.findMany({ where: eq(schema.Guide.statut, 'publie'), columns: { slug: true, updatedAt: true }, limit: MAX_DYNAMIC_URLS }),
      db.query.Actualite.findMany({ where: eq(schema.Actualite.statut, 'publie'), columns: { slug: true, updatedAt: true }, limit: MAX_DYNAMIC_URLS, orderBy: [desc(schema.Actualite.date_publication)] }),
    ]);

    const xml = buildSitemapXml(baseUrl, aides, demarches, structures, dispositifs, { guides, actualites });

    res.setHeader('x-request-id', requestId);
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(xml);
  } catch {
    logger.warn({ requestId, route: 'sitemap.xml' }, 'sitemap.generation_failed');

    res.setHeader('x-request-id', requestId);
    res.writeHead(503, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end('<?xml version="1.0" encoding="UTF-8"?><error>service_unavailable</error>');
  }
}
