// @ts-check
/**
 * G14-R3 — entry point of the HDS service (Scalingo: `web: node server.js`). Fail-closed boot: an invalid configuration stops the process with the
 * NAMES of what is missing (never a value).
 */
import http from 'node:http';
import { loadConfig } from './src/config.js';
import { createPool } from './src/db.js';
import { createApp } from './src/app.js';
import { log } from './src/log.js';

let cfg;
try { cfg = loadConfig(process.env); } catch (e) {
  process.stderr.write(`${/** @type {Error} */ (e).message}\n`);
  process.exit(1);
}
const pool = createPool(cfg.databaseUrl);
pool.on('error', (e) => log({ evt: 'pool_error', code: String(/** @type {any} */ (e).code || 'ERROR') }));
const server = http.createServer(createApp({ pool, cfg }));
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(cfg.port, () => log({ evt: 'listening', n: cfg.port }));
const stop = () => { server.close(() => { pool.end().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
