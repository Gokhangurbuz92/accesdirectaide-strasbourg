#!/usr/bin/env node
/**
 * R47 quality — the load acceptance of the integrated candidate, in the method of scripts/load-budget.mjs (each virtual user is one person: own client
 * address in X-Forwarded-For — the server must run with LAB_LOAD_FORWARDED=1 on a port other than 3000 —, own session, a 1.25–3.75 s pause between two
 * requests, the pages of a visit in turn), extended to the signed-in paths: homepage, search, directory, postal lookup, citizen sign-in, booking slots,
 * the professional agenda, the administration dashboards and the provider-status page. Per scenario p50 / p95 / p99, throughput, errors (5xx / network),
 * 429s and other refusals; the server's CPU and resident memory sampled every second (--pid). LAB / synthetic database ONLY: refuses a non-loopback base
 * and port 3000. Never point it at Production.
 *   node e2e-r47/quality/load.mjs --base http://127.0.0.1:5195 --accounts <load-accounts.json> --seed <seed.json> [--users 150] [--duration 60] [--pid <server pid>]
 *     [--only <regexp> | --skip <regexp> on scenario names] [--out report.json]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (/** @type {string} */ n, /** @type {string | null} */ d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = String(arg('base', 'http://127.0.0.1:5195')).replace(/\/$/, '');
const bu = new URL(BASE);
if (!['127.0.0.1', 'localhost'].includes(bu.hostname) || bu.port === '3000') { console.error('load: loopback LAB only, never :3000'); process.exit(2); }
const USERS = Number(arg('users', '150')); const DURATION_S = Number(arg('duration', '60')); const THINK_MS = Number(arg('think', '2500'));
const A = JSON.parse(fs.readFileSync(String(arg('accounts')), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(String(arg('seed')), 'utf8'));
const PID = arg('pid');
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const parisDay = (/** @type {number} */ n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + n * 86400000));
const BOOKABLE = Array.from({ length: 400 }, (_, i) => (i + 1) * 4);   // seed.mjs: every 4th structure takes appointments
const POSTCODES = ['67000', '67100', '67200', '67300', '67400', '67500', '67600', '67700'];
const QUERIES = ['logement', 'aide au loyer', 'santé', 'emploi', 'famille', 'énergie', 'handicap', 'transport'];

/** budgets: the public ones of docs/performance-budgets.md; the signed-in ones set here (an interactive screen: 800 ms p95 on one machine) */
const ALL_SCENARIOS = [
  { name: 'accueil (page)', p95: 400, req: () => ({ path: '/' }) },
  { name: 'accueil : actualités', p95: 600, req: () => ({ path: '/api/actualites?limit=3&sort=recent&statut=publie' }) },
  { name: 'recherche', p95: 900, req: (/** @type {number} */ u, /** @type {number} */ k) => ({ path: '/api/search', method: 'POST', csrf: true, body: { query: QUERIES[(u + k) % QUERIES.length], limit: 20, lang: 'fr' } }) },
  { name: 'annuaire (12)', p95: 600, req: (u, k) => ({ path: `/api/structures?sort=quality&page=${1 + ((u + k) % 20)}&limit=12` }) },
  { name: 'annuaire par code postal', p95: 600, req: (u, k) => ({ path: `/api/structures?sort=quality&page=1&limit=12&zip=${POSTCODES[(u + k) % 8]}` }) },
  { name: 'code postal → communes', p95: 300, req: (u, k) => ({ path: `/api/territory/postal?code=${POSTCODES[(u + k) % 8]}` }) },
  { name: 'connexion citoyenne', p95: 900, req: (u, k) => ({ path: '/api/auth/login', method: 'POST', body: { email: A.citizens[(u * 7 + k) % A.citizens.length], password: A.password } }) },
  { name: 'créneaux (14 jours)', p95: 800, req: (u, k) => { const s = BOOKABLE[(u + k) % BOOKABLE.length]; return { path: `/api/rdv/structures/r47q-structure-${s}/slots?serviceId=r47q-svc-${String(s).padStart(4, '0')}&from=${parisDay(3)}&to=${parisDay(16)}`, cookie: `ada_user_session=${encodeURIComponent(A.citizenSessions[u % A.citizenSessions.length])}` }; } },
  { name: 'agenda pro (semaine, 2 000 rdv)', p95: 800, req: (u, k) => ({ path: `/api/pro/appointments?from=${encodeURIComponent(new Date(Date.now() + ((k % 8) - 4) * 7 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + (((k % 8) - 4) * 7 + 7) * 86400000).toISOString())}&pageSize=50&page=1`, bearer: A.pro[u % A.pro.length] }) },
  { name: 'tableau de bord pro', p95: 800, req: (u) => ({ path: `/api/pro/appointments?limit=20&from=${encodeURIComponent(new Date().toISOString())}`, bearer: A.pro[u % A.pro.length] }) },
  { name: 'admin : tableau de bord', p95: 800, req: (u) => ({ path: '/api/admin/stats', bearer: A.admin[u % A.admin.length] }) },
  { name: 'admin : national', p95: 800, req: (u) => ({ path: '/api/admin/national-stats', bearer: A.admin[u % A.admin.length] }) },
  { name: 'admin : état des fournisseurs', p95: 800, req: (u) => ({ path: '/api/admin/provider-status', bearer: A.admin[u % A.admin.length] }) },
  { name: 'état du service (public)', p95: 300, req: () => ({ path: '/api/status' }) },
];
// --only <regexp> / --skip <regexp> on the scenario names: the back office is a handful of operators, not 150 visitors (run it apart with --users 5)
const ONLY = arg('only'); const SKIP = arg('skip');
const SCENARIOS = ALL_SCENARIOS.filter((s) => (!ONLY || new RegExp(ONLY).test(s.name)) && (!SKIP || !new RegExp(SKIP).test(s.name)));
const quantile = (/** @type {number[]} */ xs, /** @type {number} */ q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health || !health.ok) { console.error(`load: ${BASE} does not answer`); process.exit(2); }
const stats = SCENARIOS.map(() => ({ lat: /** @type {number[]} */ ([]), ok: 0, limited: 0, errors: 0, other: 0, codes: /** @type {Record<string, number>} */ ({}) }));
const samples = [];
const sampler = PID ? setInterval(() => { try { const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(PID)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number); samples.push({ cpu, rssMb: Math.round(rss / 1024) }); } catch { /* gone */ } }, 1000) : null;
const started = Date.now(); const stop = started + DURATION_S * 1000;
await Promise.all(Array.from({ length: USERS }, async (_, u) => {
  const ip = `10.${(u >> 16) & 255}.${(u >> 8) & 255}.${u & 255}`;
  await sleep(Math.floor((u / USERS) * THINK_MS));
  for (let k = u; Date.now() < stop; k += 1) {
    const i = k % SCENARIOS.length; const st = stats[i]; const r = SCENARIOS[i].req(u, k);
    /** @type {Record<string, string>} */ const h = { 'X-Forwarded-For': ip };
    if (r.body) h['Content-Type'] = 'application/json';
    if (r.bearer) h.Authorization = `Bearer ${r.bearer}`;
    const cookies = [r.cookie, r.csrf ? `__csrf=r47q${u}` : null].filter(Boolean); if (cookies.length) h.Cookie = cookies.join('; ');
    if (r.csrf) h['x-csrf-token'] = `r47q${u}`;
    const t = performance.now();
    try {
      const res = await fetch(`${BASE}${r.path}`, { method: r.method || 'GET', headers: h, body: r.body ? JSON.stringify(r.body) : undefined });
      await res.arrayBuffer(); const ms = performance.now() - t;
      st.codes[res.status] = (st.codes[res.status] || 0) + 1;
      if (res.status === 429) st.limited += 1; else if (res.status >= 500) st.errors += 1; else if (res.status < 400) { st.ok += 1; st.lat.push(ms); } else st.other += 1;
    } catch { st.errors += 1; }
    await sleep(THINK_MS * (0.5 + Math.random()));
  }
}));
if (sampler) clearInterval(sampler);
const seconds = (Date.now() - started) / 1000;
const results = SCENARIOS.map((sc, i) => {
  const { lat, ok, limited, errors, other, codes } = stats[i]; const total = ok + limited + errors + other;
  const row = { scenario: sc.name, requests: total, ok, rateLimited: limited, otherRefusals: other, errors, codes, rps: Math.round((total / seconds) * 10) / 10, p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), p99: quantile(lat, 0.99), budgetP95: sc.p95 };
  return { ...row, withinBudget: ok > 0 && row.p95 !== null && row.p95 <= sc.p95 && errors === 0 && other === 0 && limited === 0 };
});
for (const r of results) console.log(`${r.withinBudget ? 'OK  ' : 'HORS'}  ${r.scenario.padEnd(34)} n=${String(r.requests).padStart(5)}  p50 ${r.p50} ms  p95 ${r.p95} ms (budget ${r.budgetP95})  p99 ${r.p99} ms  ${r.rps} req/s  5xx ${r.errors}  429 ${r.rateLimited}  autres ${r.otherRefusals} ${JSON.stringify(r.codes)}`);
const cpu = samples.map((s) => s.cpu); const rss = samples.map((s) => s.rssMb);
const server = samples.length ? { cpuAvg: Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length), cpuMax: Math.max(...cpu), rssMbStart: rss[0], rssMbMax: Math.max(...rss), rssMbEnd: rss[rss.length - 1] } : null;
const report = { at: new Date().toISOString(), base: bu.host, users: USERS, seconds: Math.round(seconds), thinkMs: THINK_MS, totalRps: Math.round(results.reduce((n, r) => n + r.rps, 0) * 10) / 10, server, seed: SEED.counts, results, allWithinBudget: results.every((r) => r.withinBudget) };
console.log(`total ${report.totalRps} req/s; server ${JSON.stringify(server)}`);
const out = arg('out'); if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
process.exit(report.allWithinBudget ? 0 : 1);
