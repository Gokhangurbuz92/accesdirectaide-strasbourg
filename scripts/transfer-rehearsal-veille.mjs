#!/usr/bin/env node
/**
 * Step 8 of scripts/transfer-rehearsal.mjs: the target's own automatic verification, in a process bound to the TARGET database (DATABASE_URL is the
 * rehearsal database the parent created). « network »: the official sources are read like a staging would read them; « offline »: only the FINESS files already
 * in the LAB cache (no request), every other source unreadable — what depends on it stays unpublished (fail-closed). Prints one JSON line.
 */
import fs from 'node:fs';
import path from 'node:path';

const [mode, cache] = process.argv.slice(2);
const { runVeille } = await import('../api/_services/verification/chain.js');
const { db } = await import('../src/db/index.js');
const file = (k) => path.join(cache || '', `finess-${k}.json.gz`);
const meta = (k) => { try { return JSON.parse(fs.readFileSync(`${file(k)}.json`, 'utf8')); } catch { return null; } };
const finessFiles = mode === 'offline' && cache && fs.existsSync(file('structures')) ? { structures: { file: file('structures'), ...meta('structures') }, activites: fs.existsSync(file('activites')) ? { file: file('activites'), ...meta('activites') } : null } : undefined;
const r = await runVeille({ db, trigger: 'rehearsal', texts: false, ignorePause: true, only: ['finess', 'structure', 'aide', 'demarche', 'dispositif'], limits: { newFiness: 0 },
  ...(mode === 'offline' ? { fetchImpl: async () => { throw new TypeError('rehearsal offline'); }, finessFiles } : {}) });
console.log(JSON.stringify({ ok: r.ok, status: r.status, mode, counts: r.counts, durationMs: r.durationMs }));
process.exit(0);
