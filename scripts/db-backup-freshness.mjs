#!/usr/bin/env node
/**
 * V2 (Neon Free, unattended backups) — the missed-backup detector of the scheduled backup workflow. Each run first looks at the artifacts the previous
 * runs left (GitHub API « list artifacts », read with the run's own token) and fails LOUDLY when the newest backup is older than --max-hours: a run that
 * never happened (runner outage, schedule dropped, workflow disabled then re-enabled) is reported by the next one, by GitHub's failure e-mail.
 *
 *   gh api repos/<owner>/<repo>/actions/artifacts --paginate --jq '.artifacts[]' > artifacts.ndjson
 *   node scripts/db-backup-freshness.mjs --artifacts artifacts.json --prefix ada-prod-backup --max-hours 36
 *
 * Output: one JSON line (names, ages, sizes — no content). Exit 0 = fresh (or the very first run: --first-run-ok), 1 = stale or none.
 */
import fs from 'node:fs';
import { isMainModule } from './lib/is-main.mjs';

/**
 * @param {{ artifacts?: { name: string, created_at: string, expired?: boolean, size_in_bytes?: number }[] } | { name: string, created_at: string }[]} data
 * @param {{ prefix: string, maxHours: number, now?: number }} opts
 */
export function backupFreshness(data, { prefix, maxHours, now = Date.now() }) {
  const list = (Array.isArray(data) ? data : data?.artifacts || []).filter((a) => a && !a.expired && String(a.name || '').startsWith(prefix));
  const times = list.map((a) => ({ name: a.name, t: Date.parse(a.created_at), bytes: Number(a.size_in_bytes || 0) })).filter((a) => Number.isFinite(a.t)).sort((a, b) => b.t - a.t);
  const newest = times[0] || null;
  const ageHours = newest ? Math.round(((now - newest.t) / 3600000) * 10) / 10 : null;
  return { fresh: Boolean(newest) && ageHours <= maxHours, newest: newest?.name || null, ageHours, count: times.length, totalBytes: times.reduce((s, a) => s + a.bytes, 0), maxHours };
}

if (isMainModule(import.meta.url)) {
  const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const raw = fs.readFileSync(arg('artifacts') || 0, 'utf8');
  // one JSON document, or newline-delimited artifacts (`gh api --paginate --jq '.artifacts[]'`)
  let all; try { const d = JSON.parse(raw); all = Array.isArray(d) ? d : d.artifacts || []; } catch { all = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); }
  const r = backupFreshness(all, { prefix: arg('prefix', 'ada-prod-backup'), maxHours: Number(arg('max-hours', '36')) });
  const firstRun = r.count === 0 && process.argv.includes('--first-run-ok');
  console.log(JSON.stringify({ ...r, firstRun }));
  process.exitCode = r.fresh || firstRun ? 0 : 1;
}
