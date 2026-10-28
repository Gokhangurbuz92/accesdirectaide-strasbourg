import { build } from "vite";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');
const serverOutDir = path.resolve(distPath, 'server');


const DEFAULT_LIMIT = 10;




/**
 * Fetch theme x territory combinations for programmatic SEO.
 * @returns {Promise<{ categories: string[], territories: string[] }>}
 */
async function fetchSeoCombinations() {
    try {
        const { db } = await import('../src/db/index.ts');
        const { AidCategory } = await import('../src/db/schema.ts');

        const cats = await db.select({ slug: AidCategory.slug }).from(AidCategory);

        // PKG-11 audit: only the territory the service covers (Strasbourg / Eurométropole). The former list (Paris, Lyon, Marseille, Gironde…) generated pages
        // claiming aides « disponibles » where the service has no verified content at all.
        const territories = ['strasbourg', 'bas-rhin'];

        return { categories: cats.map(c => c.slug).filter(Boolean), territories };
    } catch (error) {
        console.warn(`⚠ Cannot connect to DB for SEO combinations: ${error.message}`);
        return { categories: [], territories: [] };
    }
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
    const args = process.argv.slice(2);
    let limit = DEFAULT_LIMIT;
    const limitIdx = args.indexOf('--limit');
    if (limitIdx !== -1 && args[limitIdx + 1]) {
        const n = parseInt(args[limitIdx + 1], 10);
        if (Number.isFinite(n) && n > 0) limit = n;
    }
    return { limit };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function prerender() {
    parseArgs();   // --limit is no longer used (P22: no record page at build time)
    console.log("Starting SSG Prerender...");

    // 1. Build the server bundle
    // logLevel 'silent' prevents chunk-size warnings from flooding Vercel logs
    // (the SSR bundle bundles all node_modules → large chunks are expected)
    await build({
        logLevel: 'silent',
        build: {
            ssr: 'src/entry-server.jsx',
            outDir: 'dist/server',
            emptyOutDir: true,
            chunkSizeWarningLimit: 5000,
        },
        ssr: { noExternal: true, external: ['leaflet'] },
    });

    // 2. Load the exported render function and seo object
    const serverPath = path.resolve(serverOutDir, 'entry-server.js');
    const { render, seo } = await import(serverPath);

    // 3. Read the client-built index.html as a template
    const templatePath = path.resolve(distPath, 'index.html');
    const template = fs.readFileSync(templatePath, 'utf-8');

    // 4. Static routes first
    const staticRoutes = ['/', '/aides'];

    for (const url of staticRoutes) {
        try {
            console.log(`Prerendering ${url} ...`);
            const html = renderRoute(url, template, render, seo);
            writeHtml(url, await html);
        } catch (e) {
            console.error(`Error prerendering ${url}:`, e);
            process.exit(1);
        }
    }

    // 5. P22: NO record page is rendered at build time — a page built once would keep a verified claim after the veille corrects or withdraws the record. The
    //    record pages' initial HTML (canonical, title, description, 404 / 410) is computed at request time (api/_services/page-head.js, /api/public/page).
    let rendered = 0;
    let skipped = 0;

    // 5.1 Programmatic SEO routes
    const { categories, territories } = await fetchSeoCombinations();
    for (const cat of categories) {
        // Theme only
        const urlCat = `/aides/theme/${cat}`;
        console.log(`Prerendering SEO Route ${urlCat} ...`);
        try {
            const html = await renderRoute(urlCat, template, render, seo, {
                title: `Aides : ${cat} | AccesDirectAide`,
                description: `Aides sociales de la catégorie ${cat} : seules les fiches vérifiées sont affichées.`
            });
            writeHtml(urlCat, html);
            rendered++;
        } catch (e) { skipped++; }

        // Theme + Territory
        for (const terr of territories) {
            const urlCatTerr = `/aides/theme/${cat}/${terr}`;
            console.log(`Prerendering SEO Route ${urlCatTerr} ...`);
            try {
                const html = await renderRoute(urlCatTerr, template, render, seo, {
                    title: `Aides ${cat} en ${terr} | AccesDirectAide`,
                    description: `Aides de la catégorie ${cat} pour ${terr} : seules les fiches vérifiées sont affichées.`
                });
                writeHtml(urlCatTerr, html);
                rendered++;
            } catch (e) { skipped++; }
        }
    }

    // 6. Cleanup the temporary server bundle
    fs.rmSync(serverOutDir, { recursive: true, force: true });

    console.log("SSG Prerender complete.");
    console.log(`  Static: ${staticRoutes.length}`);
    console.log(`  Aides: ${rendered} rendered, ${skipped} skipped`);
    console.log(`  Total: ${staticRoutes.length + rendered}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {string} template
 * @param {Function} render
 * @param {Record<string, { title: string, description: string }>} seo
 * @param {{ title: string, description: string }} [overrideSeo]
 * @returns {Promise<string>}
 */
async function renderRoute(url, template, render, seo, overrideSeo) {
    const appHtml = await render(url);

    let html = template.replace(
        '<div id="root"></div>',
        `<div id="root">${appHtml}</div>`
    );

    const routeSeo = overrideSeo || seo[url] || {
        title: "AccesDirectAide",
        description: "Accéder à vos droits simplement."
    };

    html = html.replace(
        /<title>.*?<\/title>/,
        `<title>${escapeHtml(routeSeo.title)}</title>`
    );

    const descTag = `<meta name="description" content="${escapeHtml(routeSeo.description)}" />`;
    if (html.includes('<meta name="description"')) {
        html = html.replace(/<meta\s+name="description"[\s\S]*?>/, descTag);
    } else {
        html = html.replace('</head>', `  ${descTag}\n</head>`);
    }

    return html;
}

/**
 * @param {string} url
 * @param {string} html
 */
function writeHtml(url, html) {
    const isHome = url === '/';
    const outputDir = isHome ? distPath : path.resolve(distPath, url.substring(1));

    if (!isHome) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.resolve(outputDir, 'index.html');
    fs.writeFileSync(filePath, html);
    console.log(`✓ Prerendered ${filePath}`);
}

/**
 * @param {string} str
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

prerender();
