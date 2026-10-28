import { parseArgs } from "node:util";
const BASE_URL = process.env.PUBLIC_BASE_URL || "https://accesdirectaide.fr";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");
const sitemapPath = path.join(distPath, "sitemap.xml");





/**
 * @param {number} limit
 * @returns {Promise<{aides: Array, demarches: Array, structures: Array}>}
 */
async function fetchSlugsFromDB(limit) {
    try {
        const { db } = await import('../src/db/index.ts');
        const { Aide, Demarche, Structure } = await import('../src/db/schema.ts');
        const { and, isNotNull, eq, desc } = await import('drizzle-orm');
        const { visibleWhere } = await import('../api/lib/publicVisibility.js');   // D-5: only publicly visible (verified, current, eligible) records are listed

        const aides = await db.select({
                slug: Aide.slug,
                date_verification: Aide.date_verification,
                updatedAt: Aide.updatedAt,
            })
            .from(Aide)
            .where(and(isNotNull(Aide.slug), visibleWhere(Aide, 'aide')))
            .orderBy(desc(Aide.date_verification), desc(Aide.updatedAt))
            .limit(limit);
            
        const demarches = await db.select({
                slug: Demarche.slug,
                updatedAt: Demarche.updatedAt,
            })
            .from(Demarche)
            .where(and(isNotNull(Demarche.slug), visibleWhere(Demarche, 'demarche')))
            .limit(limit);
            
        const structures = await db.select({
                slug: Structure.slug,
                updatedAt: Structure.updatedAt,
            })
            .from(Structure)
            .where(and(isNotNull(Structure.slug), visibleWhere(Structure, 'structure')))
            .limit(limit);

        return {
            aides: aides.filter((a) => a.slug),
            demarches: demarches.filter((d) => d.slug),
            structures: structures.filter((s) => s.slug)
        };
    } catch (error) {
        console.warn(`⚠ Cannot connect to DB for slugs: ${error.message}`);
        console.warn('  Sitemap will contain static routes only.');
        return { aides: [], demarches: [], structures: [] };
    }
}

// ---------------------------------------------------------------------------
// XML builder
// ---------------------------------------------------------------------------

/**
 * @param {string} loc
 * @param {string} [lastmod]
 * @param {string} [changefreq]
 * @param {string} [priority]
 */
function urlEntry(loc, lastmod, changefreq = 'weekly', priority = '0.5') {
    let xml = `  <url>\n    <loc>${loc}</loc>\n`;
    if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += `    <changefreq>${changefreq}</changefreq>\n`;
    xml += `    <priority>${priority}</priority>\n`;
    xml += `  </url>`;
    return xml;
}

/**
 * @param {Date | null | undefined} date
 * @param {string} fallback
 */
function toISODate(date, fallback) {
    if (!date) return fallback;
    try {
        return date.toISOString().split('T')[0];
    } catch {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Fetch theme x territory combinations for programmatic SEO.
 * @returns {Promise<{ categories: string[], territories: string[] }>}
 */
async function fetchSeoCombinations() {
    try {
        const { db } = await import('../src/db/index.ts');
        const { AidCategory } = await import('../src/db/schema.ts');

        const cats = await db.select({ slug: AidCategory.slug }).from(AidCategory);

        // Key territories for SEO rollout
        const territories = ['paris', 'strasbourg', 'lyon', 'marseille', 'bas-rhin', 'haute-garonne', 'gironde'];

        return { categories: cats.map(c => c.slug).filter(Boolean), territories };
    } catch (error) {
        console.warn(`⚠ Cannot connect to DB for SEO combinations: ${error.message}`);
        return { categories: [], territories: [] };
    }
}


async function main() {
    // DTA S9 (review T1): parseArgs() was called without options, so `limit` was always undefined and `--limit` would have thrown. No argument = unbounded (unchanged); --limit=N bounds each list.
    const { values } = parseArgs({ options: { limit: { type: 'string' }, static: { type: 'boolean' } }, strict: true });
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer');
    const buildDate = new Date().toISOString().split('T')[0];

    console.log(`Generating sitemap (limit=${limit})...`);

    // Static routes
    const entries = [
        urlEntry(`${BASE_URL}/`, buildDate, 'daily', '1.0'),
        urlEntry(`${BASE_URL}/aides`, buildDate, 'daily', '0.9'),
    ];


    // Dynamic routes
    const { aides, demarches, structures } = await fetchSlugsFromDB(limit);
    for (const aide of aides) {
        const lastmod = toISODate(aide.date_verification, toISODate(aide.updatedAt, buildDate));
        entries.push(
            urlEntry(`${BASE_URL}/aides/${encodeURIComponent(aide.slug)}`, lastmod, 'weekly', '0.7')
        );
    }
    for (const demarche of demarches) {
        const lastmod = toISODate(demarche.updatedAt, buildDate);
        entries.push(
            urlEntry(`${BASE_URL}/demarches/${encodeURIComponent(demarche.slug)}`, lastmod, 'weekly', '0.6')
        );
    }
    for (const structure of structures) {
        const lastmod = toISODate(structure.updatedAt, buildDate);
        entries.push(
            urlEntry(`${BASE_URL}/structures/${encodeURIComponent(structure.slug)}`, lastmod, 'monthly', '0.5')
        );
    }

    let seoLinksCount = 0;
    // Programmatic SEO routes
    const { categories, territories } = await fetchSeoCombinations();
    for (const cat of categories) {
        entries.push(urlEntry(`${BASE_URL}/aides/theme/${cat}`, buildDate, 'weekly', '0.8'));
        seoLinksCount++;
        for (const terr of territories) {
            entries.push(urlEntry(`${BASE_URL}/aides/theme/${cat}/${terr}`, buildDate, 'weekly', '0.8'));
            seoLinksCount++;
        }
    }

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries,
        '</urlset>',
        '',
    ].join('\n');

    // Write to dist/
    fs.mkdirSync(distPath, { recursive: true });
    const sitemapPath = path.resolve(distPath, 'sitemap.xml');
    fs.writeFileSync(sitemapPath, xml, 'utf-8');

    console.log(`✓ Sitemap written to ${sitemapPath}`);
    console.log(`  Static routes: 2`);
    console.log(`  Aide routes: ${aides.length}`);
    console.log(`  SEO programmatic links: ${seoLinksCount}`);
    console.log(`  Total URLs: ${entries.length}`);
}

// P22: the sitemap is computed at request time (api/_handlers/sitemap.js, /sitemap.xml rewritten to it): a copy written at build time would be served instead
// (static files come first) and keep listing records the veille withdrew since. This script only removes such a copy; --static writes one for inspection.
if (!process.argv.includes('--static')) {
    fs.rmSync(sitemapPath, { force: true });
    console.log('Sitemap: served at request time (api/_handlers/sitemap.js); no build-time copy.');
    process.exit(0);
}

main().catch((err) => {
    console.error('Sitemap generation failed:', err);
    // Non-fatal: don't kill the build
    process.exit(0);
});
