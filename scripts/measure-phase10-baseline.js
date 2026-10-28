import 'dotenv/config';
import { performance } from 'perf_hooks';

async function measureLatency(label, fn, iterations = 10) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;

  console.log(`[${label}] avg=${avg.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms min=${times[0].toFixed(2)}ms max=${times[times.length - 1].toFixed(2)}ms`);
  return { label, avg, p50, p95, min: times[0], max: times[times.length - 1] };
}

async function main() {
  console.log('=== Phase 10 Baseline Performance Measurement ===\n');

  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost')) {
      console.log('ENVIRONMENT ACTION REQUIRED: Staging Database URL not provided or using localhost.');
      console.log('REAL STAGING P50/P95/THROUGHPUT = ENVIRONMENT ACTION REQUIRED');
      console.log('Running local DB test instead...\n');
  }

  const { db } = await import('../src/db/index.js');
  const { sql } = await import('drizzle-orm');
  const results = [];

  try {
      results.push(await measureLatency('DB-FTS-Aide', async () => {
          await db.execute(sql`
            SELECT id, titre FROM "Aide"
            WHERE to_tsvector('french', titre || ' ' || description) @@ to_tsquery('french', 'famille')
            LIMIT 10
          `);
      }, 50));

      results.push(await measureLatency('DB-SyncQueue-Claim', async () => {
          // Attempt an atomic claim just to measure latency (might return 0 rows if empty)
          await db.execute(sql`
            UPDATE "SyncRun"
            SET status = 'RUNNING'
            WHERE id = (
              SELECT id FROM "SyncRun" WHERE status = 'PENDING' LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            RETURNING id
          `);
      }, 50));

      console.log('\n=== Phase 10 Baseline Summary ===');
      for (const r of results) {
        console.log(`  ${r.label}: p95=${r.p95.toFixed(2)}ms`);
      }
  } catch(e) {
      console.log('DB queries failed, verify DATABASE_URL', e.message);
  }
}

main().catch(console.error);
