/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const aidesLatency = new Trend('aides_latency');
const searchLatency = new Trend('search_latency');
const healthLatency = new Trend('health_latency');

// Configuration
const BASE = __ENV.BASE_URL || 'https://www.accesdirectaide.fr';

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },  // Ramp to 10 VUs
        { duration: '1m', target: 50 },   // Ramp to 50 VUs
        { duration: '2m', target: 50 },   // Hold 50 VUs
        { duration: '30s', target: 0 },   // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],  // 95% under 3s
    http_req_failed: ['rate<0.05'],     // <5% failures
    errors: ['rate<0.1'],               // <10% custom errors
  },
};

export default function () {
  // 1. Health check
  const health = http.get(`${BASE}/api/health`);
  healthLatency.add(health.timings.duration);
  check(health, {
    'health: status 200': (r) => r.status === 200,
    'health: ok true': (r) => {
      try { return JSON.parse(r.body).ok === true; } catch { return false; }
    },
  }) || errorRate.add(1);
  sleep(1);

  // 2. List aides
  const aides = http.get(`${BASE}/api/aides?limit=10`);
  aidesLatency.add(aides.timings.duration);
  check(aides, {
    'aides: status 200': (r) => r.status === 200,
    'aides: has items': (r) => {
      try {
        const body = JSON.parse(r.body);
        return (body.items?.length > 0) || (body.data?.length > 0);
      } catch { return false; }
    },
    'aides: latency < 2s': (r) => r.timings.duration < 2000,
  }) || errorRate.add(1);
  sleep(1);

  // 3. Search aides
  const search = http.get(`${BASE}/api/aides?q=logement&limit=5`);
  searchLatency.add(search.timings.duration);
  check(search, {
    'search: status 200': (r) => r.status === 200,
    'search: latency < 3s': (r) => r.timings.duration < 3000,
  }) || errorRate.add(1);
  sleep(1);

  // 4. Structures (annuaire)
  const structures = http.get(`${BASE}/api/structures?limit=10`);
  check(structures, {
    'structures: status 200': (r) => r.status === 200,
  }) || errorRate.add(1);
  sleep(1);

  // 5. Démarches
  const demarches = http.get(`${BASE}/api/demarches?limit=10`);
  check(demarches, {
    'demarches: status 200': (r) => r.status === 200,
  }) || errorRate.add(1);
  sleep(1);

  // 6. Monitor core
  const monitor = http.get(`${BASE}/api/monitor/core`);
  check(monitor, {
    'monitor: status 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(Math.random() * 2);
}

// Summary handler
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    base_url: BASE,
    total_requests: data.metrics.http_reqs?.values?.count || 0,
    failed_requests: data.metrics.http_req_failed?.values?.passes || 0,
    avg_duration_ms: Math.round(data.metrics.http_req_duration?.values?.avg || 0),
    p95_duration_ms: Math.round(data.metrics.http_req_duration?.values?.['p(95)'] || 0),
    p99_duration_ms: Math.round(data.metrics.http_req_duration?.values?.['p(99)'] || 0),
    error_rate: ((data.metrics.errors?.values?.rate || 0) * 100).toFixed(2) + '%',
    aides_avg_ms: Math.round(data.metrics.aides_latency?.values?.avg || 0),
    search_avg_ms: Math.round(data.metrics.search_latency?.values?.avg || 0),
    health_avg_ms: Math.round(data.metrics.health_latency?.values?.avg || 0),
  };

  console.log('\n' + '='.repeat(50));
  console.log('📊 RÉSUMÉ TEST DE CHARGE');
  console.log('='.repeat(50));
  console.log(`Total requêtes    : ${summary.total_requests}`);
  console.log(`Requêtes échouées : ${summary.failed_requests}`);
  console.log(`Latence moyenne   : ${summary.avg_duration_ms}ms`);
  console.log(`Latence P95       : ${summary.p95_duration_ms}ms`);
  console.log(`Latence P99       : ${summary.p99_duration_ms}ms`);
  console.log(`Taux d'erreur     : ${summary.error_rate}`);
  console.log(`Aides avg         : ${summary.aides_avg_ms}ms`);
  console.log(`Search avg        : ${summary.search_avg_ms}ms`);
  console.log(`Health avg        : ${summary.health_avg_ms}ms`);
  console.log('='.repeat(50));

  return {
    'tests/load/results.json': JSON.stringify(summary, null, 2),
  };
}
