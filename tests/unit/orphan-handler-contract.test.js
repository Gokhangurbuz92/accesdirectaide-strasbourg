/**
 * Orphan-handler contract: every api/_handlers/**\/*.js (non-test) is either reachable through api/routes.js or listed here with a reason.
 * An unrouted handler is dead code at best and a latent unreviewed endpoint at worst (cf. the 2026-03-14 deletion of live messaging handlers).
 * Adding to KNOWN_ORPHANS needs an owner decision recorded in docs/release — never to "make the test pass".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const KNOWN_ORPHANS = new Set([
  // admin tooling without a route (admin UI "versions" is referenced by the frontend and is in the route-contract allowlist)
  '_handlers/admin/export.js', '_handlers/admin/import.js', '_handlers/admin/mark-fresh.js', '_handlers/admin/override-reputation.js', '_handlers/admin/rollback.js',
  '_handlers/admin/source-trigger.js', '_handlers/admin/sources.js', '_handlers/admin/versions.js',
  // diagnostics / test endpoints
  '_handlers/blocked.js', '_handlers/ratelimit-test.js', '_handlers/sentry-test.js', '_handlers/version.js', '_handlers/categories.js',
  // legacy / superseded
  '_handlers/cron/ingest-actualites-rss.js', '_handlers/cron/reset-lock.js',   // launch-readiness item 57: the mock OTP handlers (« mock-jwt ») were deleted
  '_handlers/pro/ai/assist.js', '_handlers/pro/appointments/index.js', '_handlers/pro/messages/conversations.js',
  // (PKG-4, 2026-10-20: '_handlers/pro/structure.js' rewritten as the Espace Structure proposals endpoint and routed)
  '_handlers/public/appointments/cancel.js', '_handlers/public/appointments/create.js', '_handlers/public/consent.js', '_handlers/public/messages.js',
  // retired: answers 410; replaced by the routed pro/appointments/visio.js (owner decision 2026-10-19, PKG-3)
  '_handlers/pro/appointments/start-visio.js',
]);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.js$/.test(n) && !/\.(test|regression\.test)\.js$/.test(n) && !/\.regression\./.test(n) ? [p] : [];
  });
}

describe('orphan handler contract', () => {
  const routed = new Set([...readFileSync('api/routes.js', 'utf8').matchAll(/import\('\.\/(_handlers\/[^']+)'\)/g)].map((m) => m[1]));
  const all = walk('api/_handlers').map((p) => relative('api', p));
  const orphans = all.filter((h) => !routed.has(h)).sort();

  it('every unrouted handler is a documented orphan', () => { expect(orphans.filter((o) => !KNOWN_ORPHANS.has(o))).toEqual([]); });
  it('the orphan allowlist has no stale entries', () => { expect([...KNOWN_ORPHANS].filter((o) => !orphans.includes(o)).sort()).toEqual([]); });
  it('every routed handler file exists', () => { expect([...routed].filter((h) => !all.includes(h))).toEqual([]); });
});
