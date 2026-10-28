import { isIndexable, getCanonicalBaseUrl } from '../_utils/seo.js';
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const indexable = isIndexable(req);
    const canonicalUrl = getCanonicalBaseUrl(req);

    let txt;
    if (indexable) {
        // Production rules
        txt = `User-agent: *
Disallow: /admin
Disallow: /pro
Disallow: /__dev
Disallow: /api/admin
Disallow: /api/_*

Sitemap: ${canonicalUrl}/sitemap.xml
`;
    } else {
        // Non-production environments (Vercel previews, staging, etc.): block everything
        txt = `User-agent: *
Disallow: /

Sitemap: ${canonicalUrl}/sitemap.xml
`;
    }

    res.setHeader('Content-Type', 'text/plain');
    // Cache for 1 day, revalidate in background.
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');

    if (!indexable) {
        // Extra safety layer via HTTP Header
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }

    res.status(200).send(txt);
}
