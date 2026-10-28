/**
 * Phase 9 — Baseline Performance Measurement
 * Measures current representative workloads to derive Phase 9 performance budgets.
 * Run: node scripts/measure-phase8-baseline.js
 */

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
  console.log('=== Phase 8 Baseline Performance Measurement ===\n');
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Node:', process.version);
  console.log('');

  const results = [];

  // 1. Territory Resolution (in-memory, no DB) — establishes overhead baseline
  const { resolvePostalCode } = await import('../api/lib/geography/TerritoryService.js');
  results.push(await measureLatency('PostalCode-Validation', async () => {
    await resolvePostalCode('99999'); // Will fail fast (no network in sandbox)
  }, 5));

  // 2. Applicability Engine — pure compute
  const { evaluateApplicability } = await import('../api/lib/geography/ApplicabilityEngine.js');
  const rules = [
    { territoryId: 'region-1', isExclusion: false },
    { territoryId: 'dept-1', isExclusion: true }
  ];
  const hierarchy = ['commune-1', 'dept-1', 'region-1', 'country-1'];
  const typeMap = new Map([['country-1', 'COUNTRY'], ['region-1', 'REGION'], ['dept-1', 'DEPARTEMENT'], ['commune-1', 'COMMUNE']]);

  results.push(await measureLatency('ApplicabilityEngine', async () => {
    evaluateApplicability(rules, hierarchy, typeMap);
  }, 1000));

  // 3. Pagination encoding/decoding
  const { encodeCursor, decodeCursor, parsePaginationParams } = await import('../api/lib/geography/CursorPagination.js');
  results.push(await measureLatency('CursorPagination', async () => {
    const cursor = encodeCursor({ id: 'test-uuid-12345' });
    decodeCursor(cursor);
    parsePaginationParams({ cursor, limit: '50' });
  }, 1000));

  console.log('\n=== Baseline Summary ===');
  for (const r of results) {
    console.log(`  ${r.label}: p95=${r.p95.toFixed(2)}ms`);
  }
  console.log('\nBaseline measurement complete. Derive Phase 9 numeric budgets from these values.');
}

main().catch(console.error);
