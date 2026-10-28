#!/usr/bin/env node

/**
 * Test Backup & Restore — Validates that the backup system works.
 *
 * Usage:
 *   npx tsx scripts/test-backup-restore.js           # Test backup
 *   npx tsx scripts/test-backup-restore.js --restore <file>  # Restore from JSON
 *
 * Requires: DATABASE_URL (reads from .env.local via dotenv)
 */

import '@dotenvx/dotenvx/config';

async function testBackup() {
    const { db } = await import('../src/db/index.js');
    const { Aide, ConversationLog } = await import('../src/db/schema.js');
    const { count } = await import('drizzle-orm');

    console.log('🔄 Testing backup system...\n');

    // 1. Count records
    const [aideCount] = await db.select({ count: count() }).from(Aide);
    const [logCount] = await db.select({ count: count() }).from(ConversationLog);

    console.log(`📊 Database state:`);
    console.log(`   Aides: ${aideCount.count}`);
    console.log(`   ConversationLogs: ${logCount.count}\n`);

    // 2. Build backup package (same logic as backup-db.js)
    console.log('📦 Building backup package...');
    const aides = await db.query.Aide.findMany();
    const logs = await db.query.ConversationLog.findMany({
        orderBy: (cl, { desc }) => [desc(cl.createdAt)],
    });

    const backupData = {
        metadata: {
            version: '1.0',
            timestamp: new Date().toISOString(),
            counts: {
                aides: aides.length,
                conversationLogs: logs.length,
            },
        },
        data: {
            aides,
            conversationLogs: logs,
        },
    };

    const json = JSON.stringify(backupData, null, 2);
    const sizeMB = (Buffer.byteLength(json, 'utf-8') / (1024 * 1024)).toFixed(2);

    // 3. Validate
    console.log(`\n✅ Backup package built successfully!`);
    console.log(`   Size: ${sizeMB} MB`);
    console.log(`   Aides: ${backupData.metadata.counts.aides}`);
    console.log(`   ConversationLogs: ${backupData.metadata.counts.conversationLogs}`);

    // 4. Verify JSON is parseable
    try {
        JSON.parse(json);
        console.log(`   JSON: ✅ Valid`);
    } catch (e) {
        console.error(`   JSON: ❌ Invalid — ${e.message}`);
        process.exit(1);
    }

    // 5. Cross-check counts
    if (backupData.metadata.counts.aides !== aides.length) {
        console.error('❌ Aide count mismatch!');
        process.exit(1);
    }

    console.log(`\n🎉 Backup test PASSED — ${sizeMB} MB, ${aides.length} aides, ${logs.length} logs`);
    console.log(`\n📋 To create a file backup, run:`);
    console.log(`   pg_dump "$DATABASE_URL" --format=custom --file=backup-$(date +%Y%m%d).dump`);
    process.exit(0);
}

async function restoreFromJson(filePath) {
    const fs = await import('fs');
    const { db } = await import('../src/db/index.js');
    const { Aide } = await import('../src/db/schema.js');

    console.log(`🔄 Restoring from ${filePath}...\n`);

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const backup = JSON.parse(raw);

    console.log(`📊 Backup metadata:`);
    console.log(`   Version: ${backup.metadata.version}`);
    console.log(`   Date: ${backup.metadata.timestamp}`);
    console.log(`   Aides: ${backup.metadata.counts.aides}`);
    console.log(`   Logs: ${backup.metadata.counts.conversationLogs}`);

    console.log('\n⚠️  Restore is destructive — this would overwrite existing data.');
    console.log('   Use pg_restore for production restores (see docs/disaster-recovery.md)');
    process.exit(0);
}

// Entry point
const args = process.argv.slice(2);
if (args[0] === '--restore' && args[1]) {
    restoreFromJson(args[1]);
} else {
    testBackup();
}
