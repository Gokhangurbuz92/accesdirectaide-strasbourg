#!/usr/bin/env node
/**
 * Launch readiness (Q05) — load budgets of the public reading paths, measured against a RUNNING server (the LAB on this machine holds production-like data:
 * the records the automatic veille publishes). No dependency: Node's fetch. Each virtual user is a person browsing — its own client address, a pause (think
 * time) between two pages, the pages of a visit in turn (directory, a structure, aides, démarches, « J'ai besoin d'aide pour… ») — for a fixed time; per page
 * p50 / p95 / p99, throughput and errors, each compared with its budget. A 429 (rate limit) is counted apart: a person never reaches the per-address limits at
 * this pace, so a 429 here means the pace is wrong or a limit is too tight — the run is then « hors budget ». Read-only pages plus the anonymous search.
 * The client address is given in X-Forwarded-For, which a server outside Vercel takes as the first hop (api/_utils/client-ip.js): the LAB and a self-hosted
 * staging behind a proxy; on Vercel the edge overwrites it, so a load test there comes from real distinct clients.
 *
 *   node scripts/load-budget.mjs --base http://127.0.0.1:3000 [--duration 60] [--users 150] [--think 2500] [--out report.json]
 *
 * This measures one machine, not the hosting platform: it is evidence that the code paths stay within budget on production-like data; a staging measurement
 * on the chosen hosting (cold starts, region, database latency) is still needed before launch (docs/performance-budgets.md).
 */
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = String(arg('base', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const DURATION_S = Number(arg('duration', '60')); const USERS = Number(arg('users', '150')); const THINK_MS = Number(arg('think', '2500'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the budgets (ms, at the given number of users on this machine) and the error budget (share of 5xx / network errors) */
export const SCENARIOS = [
  { name: 'santé du service', method: 'GET', path: '/api/health', p95: 150, errors: 0 },
  { name: 'annuaire des structures (20)', method: 'GET', path: '/api/structures?limit=20', p95: 600, errors: 0 },
  { name: 'page d’une structure', method: 'GET', path: '/api/structures/{structureSlug}', p95: 400, errors: 0 },
  { name: 'liste des aides (20)', method: 'GET', path: '/api/aides?limit=20', p95: 600, errors: 0 },
  { name: 'liste des démarches (20)', method: 'GET', path: '/api/demarches?limit=20', p95: 600, errors: 0 },
  { name: '« J’ai besoin d’aide pour… » (logement)', method: 'POST', path: '/api/search-pro', body: { needs: ['logement'], page: 1 }, p95: 900, errors: 0 },
];

const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || !health.ok) { console.error(`load-budget : ${BASE} ne répond pas (/api/health).`); process.exit(2); }
  const list = await (await fetch(`${BASE}/api/structures?limit=50`)).json().catch(() => ({}));
  const ids = (list.data || list.items || list.structures || []).map((s) => s.slug || s.id).filter(Boolean);   // the page address carries the slug
  if (!ids.length) { console.error('load-budget : aucune structure publique à lire (données de production-like absentes).'); process.exit(2); }
  const stats = SCENARIOS.map(() => ({ lat: [], ok: 0, limited: 0, errors: 0, other: 0 }));
  const stop = Date.now() + DURATION_S * 1000;
  await Promise.all(Array.from({ length: USERS }, async (_, u) => {
    const ip = `10.${(u >> 16) & 255}.${(u >> 8) & 255}.${u & 255}`;
    await sleep(Math.floor((u / USERS) * THINK_MS));   // the visits start spread over one think time
    for (let k = u; Date.now() < stop; k += 1) {
      const i = k % SCENARIOS.length; const sc = SCENARIOS[i]; const st = stats[i];
      const p = sc.path.replace('{structureSlug}', encodeURIComponent(ids[(u + k) % ids.length]));
      const t = performance.now();
      try {
        const r = await fetch(`${BASE}${p}`, { method: sc.method, headers: { 'X-Forwarded-For': ip, ...(sc.body ? { 'Content-Type': 'application/json', Origin: BASE } : {}) }, body: sc.body ? JSON.stringify(sc.body) : undefined });
        await r.arrayBuffer();
        const ms = performance.now() - t;
        if (r.status === 429) st.limited += 1; else if (r.status >= 500) st.errors += 1; else if (r.status >= 200 && r.status < 400) { st.ok += 1; st.lat.push(ms); } else st.other += 1;
      } catch { st.errors += 1; }
      await sleep(THINK_MS * (0.5 + Math.random()));
    }
  }));
  const results = SCENARIOS.map((sc, i) => {
    const { lat, ok, limited, errors, other } = stats[i]; const total = ok + limited + errors + other;
    const row = { scenario: sc.name, path: sc.path, requests: total, ok, rateLimited: limited, otherRefusals: other, errors, rps: Math.round((total / DURATION_S) * 10) / 10,
      p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), p99: quantile(lat, 0.99), budgetP95: sc.p95 };
    row.withinBudget = ok > 0 && row.p95 !== null && row.p95 <= sc.p95 && errors / Math.max(1, total) <= sc.errors && other === 0 && limited === 0;
    console.log(`${row.withinBudget ? 'OK  ' : 'HORS'}  ${sc.name.padEnd(42)} p50 ${row.p50} ms  p95 ${row.p95} ms (budget ${sc.p95})  p99 ${row.p99} ms  ${row.rps} req/s  erreurs ${errors}  429 ${limited}  autres refus ${other}`);
    return row;
  });
  const report = { at: new Date().toISOString(), base: new URL(BASE).host, users: USERS, seconds: DURATION_S, thinkMs: THINK_MS, totalRps: Math.round(results.reduce((n, r) => n + r.rps, 0) * 10) / 10, node: process.version, publicStructuresSampled: ids.length, results, allWithinBudget: results.every((r) => r.withinBudget) };
  const out = arg('out', null); if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
  process.exit(report.allWithinBudget ? 0 : 1);
}
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
