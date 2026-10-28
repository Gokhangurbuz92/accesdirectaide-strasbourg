#!/usr/bin/env node

/**
 * Fix Relative Source URLs
 *
 * Updates aides with relative source_url to use absolute URLs.
 *
 * Usage:
 *   npx tsx scripts/fix-source-urls.js
 *
 * Requires DATABASE_URL to be set.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PREFIX_MAP = [
    { pattern: /^\/aides\//,  prefix: 'https://aides-territoires.beta.gouv.fr' },
    { pattern: /^\/finess\//, prefix: 'https://finess.sante.gouv.fr' },
    { pattern: /^\/api\//,    prefix: 'https://aides-territoires.beta.gouv.fr' },
];

async function main() {
    const { db } = await import('../src/db/index.ts');
    const { Aide } = await import('../src/db/schema.ts');
    const { eq, sql } = await import('drizzle-orm');

    console.log('🔗 Fixing relative source_url for aides...\n');

    // Find aides with relative URLs (not starting with http)
    const allAides = await db.select({
        id: Aide.id,
        source_url: Aide.source_url,
        titre: Aide.titre,
    }).from(Aide);

    let fixed = 0;
    const examples = [];

    for (const aide of allAides) {
        const url = aide.source_url;
        if (!url || url.startsWith('http://') || url.startsWith('https://')) {
            continue; // already absolute or null
        }

        // Find matching prefix
        let newUrl = null;
        for (const { pattern, prefix } of PREFIX_MAP) {
            if (pattern.test(url)) {
                newUrl = `${prefix}${url}`;
                break;
            }
        }

        // Default: assume aides-territoires
        if (!newUrl && url.startsWith('/')) {
            newUrl = `https://aides-territoires.beta.gouv.fr${url}`;
        }

        if (newUrl) {
            await db.update(Aide).set({
                source_url: newUrl,
                source_url_exact: newUrl,
            }).where(eq(Aide.id, aide.id));

            if (examples.length < 5) {
                examples.push({ titre: aide.titre, before: url, after: newUrl });
            }
            fixed++;
        }
    }

    console.log('═══════════════════════════════════════════');
    console.log('       SOURCE URL FIX SUMMARY              ');
    console.log('═══════════════════════════════════════════');
    console.log(`  Total aides:     ${allAides.length}`);
    console.log(`  URLs corrigées:  ${fixed}`);
    console.log(`  Déjà absolues:   ${allAides.length - fixed}`);

    if (examples.length > 0) {
        console.log('\n  Exemples avant/après:');
        for (const ex of examples) {
            console.log(`    "${ex.titre}"`);
            console.log(`      AVANT : ${ex.before}`);
            console.log(`      APRÈS : ${ex.after}\n`);
        }
    } else {
        console.log('\n  ✅ Toutes les URLs étaient déjà absolues !');
    }

    console.log('═══════════════════════════════════════════');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
