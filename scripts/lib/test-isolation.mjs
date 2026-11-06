/**
 * R47 — LAB / test isolation. R46: a worker's mock run reached the owner's LAB on :3000 through the Vite dev proxy (hard-coded to localhost:3000).
 * Port 3000 is the owner's LAB; a test (Playwright, CI, Vitest, a LAB harness with ADA_TEST_ISOLATION=1, NODE_ENV=test, a mock run) never talks to it,
 * and a test server only ever uses the disposable test cluster (127.0.0.1:55434, a *_test database), never Neon or any remote host.
 *
 *   resolveDevApiTarget(env)       the Vite dev proxy target (vite.config.js): the owner's default (localhost:3000) outside tests; in a test context
 *                                  only an explicit loopback VITE_DEV_API_TARGET on another port, otherwise a refusal
 *   assertTestServer({ host, port, databaseUrl, … })   throws unless loopback host, port ≠ 3000, test database (see below)
 */

export const OWNER_LAB_PORT = 3000;
export const TEST_DB_PORT = 55434;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** @param {Record<string, string | undefined>} env @returns {string[]} the names of the test-context signals that are set */
export function testContextSignals(env = process.env) {
  const on = (/** @type {string | undefined} */ v) => v !== undefined && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';
  const signals = [];
  for (const k of ['PLAYWRIGHT_TEST', 'CI', 'VITEST']) if (on(env[k])) signals.push(k);
  if (env.ADA_TEST_ISOLATION === '1') signals.push('ADA_TEST_ISOLATION');
  if (env.NODE_ENV === 'test') signals.push('NODE_ENV=test');
  for (const k of ['VITE_USE_MOCKS', 'USE_MOCKS']) if (String(env[k] || '').toLowerCase() === 'true') signals.push(k);
  return signals;
}

export const isTestContext = (/** @type {Record<string, string | undefined>} */ env = process.env) => testContextSignals(env).length > 0;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, hostname: string, port: number, origin: string } | { ok: false, reason: string }}
 */
export function resolveDevApiTarget(env = process.env) {
  const signals = testContextSignals(env);
  const raw = String(env.VITE_DEV_API_TARGET || '').trim();
  if (!raw) {
    if (signals.length) return { ok: false, reason: `test context (${signals.join(', ')}): the dev API proxy never targets the owner LAB on :${OWNER_LAB_PORT}; set VITE_DEV_API_TARGET=http://127.0.0.1:<port ≠ ${OWNER_LAB_PORT}>` };
    return { ok: true, hostname: 'localhost', port: OWNER_LAB_PORT, origin: `http://localhost:${OWNER_LAB_PORT}` };
  }
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: `VITE_DEV_API_TARGET is not a URL: ${raw}` }; }
  if (u.protocol !== 'http:') return { ok: false, reason: 'VITE_DEV_API_TARGET must be http://<loopback>:<port>' };
  if (!LOOPBACK.has(u.hostname)) return { ok: false, reason: `VITE_DEV_API_TARGET must be a loopback host, not ${u.hostname}` };
  if (!u.port) return { ok: false, reason: 'VITE_DEV_API_TARGET must name its port' };
  const port = Number(u.port);
  if (signals.length && port === OWNER_LAB_PORT) return { ok: false, reason: `test context (${signals.join(', ')}): VITE_DEV_API_TARGET may not be the owner LAB port ${OWNER_LAB_PORT}` };
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  return { ok: true, hostname, port, origin: `http://${u.host}` };
}

/**
 * The checks of a test server (LAB harness). Throws an Error naming the first violation.
 * @param {{ host?: string, port: number | string, databaseUrl?: string, requireDatabase?: boolean, label?: string }} o
 */
export function assertTestServer(o) {
  const label = o.label || 'test server';
  const host = String(o.host ?? '127.0.0.1');
  if (!LOOPBACK.has(host)) throw new Error(`${label}: host ${host} is not loopback`);
  const port = Number(o.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`${label}: invalid port ${o.port}`);
  if (port === OWNER_LAB_PORT) throw new Error(`${label}: port ${OWNER_LAB_PORT} is the owner LAB`);
  const dbUrl = String(o.databaseUrl || '');
  if (!dbUrl) { if (o.requireDatabase !== false) throw new Error(`${label}: DATABASE_URL missing`); return; }
  assertTestDatabaseUrl(dbUrl, label);
}

/** @param {string} dbUrl @param {string} [label] */
export function assertTestDatabaseUrl(dbUrl, label = 'test server') {
  let u;
  try { u = new URL(dbUrl); } catch { throw new Error(`${label}: DATABASE_URL is not a URL`); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`${label}: DATABASE_URL is not PostgreSQL`);
  if (/neon\.tech|neon\.build|amazonaws\.com|supabase|render\.com|vercel/i.test(u.hostname)) throw new Error(`${label}: remote/managed database host refused`);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error(`${label}: the database host must be 127.0.0.1 (got a non-loopback host)`);
  if (Number(u.port) !== TEST_DB_PORT) throw new Error(`${label}: the test database is on port ${TEST_DB_PORT}, not ${u.port || 'default'}`);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+_test$/i.test(name)) throw new Error(`${label}: the database name must end with _test`);
  const host = u.searchParams.get('host');
  if (host && host !== '127.0.0.1') throw new Error(`${label}: DATABASE_URL host override refused`);
}
