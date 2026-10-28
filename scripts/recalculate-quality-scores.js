#!/usr/bin/env node

/**
 * Recalculate Quality Scores
 *
 * Reads all aides from the database, recomputes quality_score,
 * and updates each record. Prints a summary with distribution.
 *
 * Usage:
 *   npx tsx scripts/recalculate-quality-scores.js
 *
 * Requires DATABASE_URL to be set (reads from .env.local).
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

async function main() {
    // Dynamic imports AFTER dotenv has loaded env vars
    const { db } = await import('../src/db/index.ts');
    const { Aide } = await import('../src/db/schema.ts');
    const { eq } = await import('drizzle-orm');
    const { computeQualityScore } = await import('../api/lib/quality-score.js');

    console.log('🔄 Recalculating quality scores for all aides...\n');

    const allAides = await db.select().from(Aide);
    console.log(`📊 Found ${allAides.length} aides in database.\n`);

    if (allAides.length === 0) {
        console.log('⚠️  No aides found. Nothing to recalculate.');
        process.exit(0);
    }

    let updated = 0;
    let totalScore = 0;
    const distribution = {
        '0-20': 0,
        '21-40': 0,
        '41-60': 0,
        '61-80': 0,
        '81-100': 0,
    };

    for (const aide of allAides) {
        const { score } = computeQualityScore(aide);
        totalScore += score;

        // Categorize into distribution buckets
        if (score <= 20) distribution['0-20']++;
        else if (score <= 40) distribution['21-40']++;
        else if (score <= 60) distribution['41-60']++;
        else if (score <= 80) distribution['61-80']++;
        else distribution['81-100']++;

        // Only update if score actually changed
        if (aide.quality_score !== score) {
            await db.update(Aide).set({ quality_score: score }).where(eq(Aide.id, aide.id));
            updated++;
        }
    }

    const avgScore = Math.round(totalScore / allAides.length);

    console.log('═══════════════════════════════════════════');
    console.log('           QUALITY SCORE SUMMARY           ');
    console.log('═══════════════════════════════════════════');
    console.log(`  Total aides:     ${allAides.length}`);
    console.log(`  Updated:         ${updated}`);
    console.log(`  Score moyen:     ${avgScore}/100`);
    console.log('');
    console.log('  Distribution:');
    console.log(`    0-20  (très faible) : ${distribution['0-20'].toString().padStart(4)} aides`);
    console.log(`    21-40 (faible)      : ${distribution['21-40'].toString().padStart(4)} aides`);
    console.log(`    41-60 (moyen)       : ${distribution['41-60'].toString().padStart(4)} aides`);
    console.log(`    61-80 (bon)         : ${distribution['61-80'].toString().padStart(4)} aides`);
    console.log(`    81-100 (excellent)  : ${distribution['81-100'].toString().padStart(4)} aides`);
    console.log('═══════════════════════════════════════════');

    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
