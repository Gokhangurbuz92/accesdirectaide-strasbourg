/**
 * Route contract: every `/api/...` literal used by src/ must resolve in api/routes.js (same rule as api/index.js),
 * unless it is in the explicit, documented allowlist below. Guards against the 2026-03-14 class of regression
 * (handlers deleted while the frontend still calls them; mock-only E2E hid it).
 * Adding to KNOWN_UNROUTED requires a written owner decision — do not "fix" a failure by extending the list silently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routes } from '../../api/routes.js';

const KNOWN_UNROUTED = new Set([
  // (PKG-3, owner decision 2026-10-19: the legacy 'pro/appointments/start-visio' is retired; the frontend now uses the routed 'pro/appointments/visio')
  // legacy HMAC-token flow / legacy pages, owner decision pending (see docs/release/MESSAGING_ROUTE_REGRESSION.md)
  'appointments', 'appointments/cancel', 'appointments/reschedule', 'public/availability',   // R26: 'public/stats' is no longer called (the impact page shows the live published counts)
  // (PKG-4 batch 3, 2026-10-20: 'pro/regional-stats' and 'pro/team/stats' are routed)
  // dev/diagnostic or non-existent endpoints referenced by code paths not reachable in the Stage 6 scope
  'endpoint', 'ratelimit-test', 'integrations/core/invoke',
  // (overlay 2026-10-23, A02_ADMIN_CONTENT_OVERLAY_V1.md: 'admin/versions' no longer called — the broken EntityHistory panel now reads the routed 'admin/content-versions')
  // (overlay 2026-10-22, SECURECHAT_AI_REMOVAL_OVERLAY_V1.md: 'pro/ai/assist' no longer called — the fake « IA Gemini » panel of SecureChat was removed)
  // (PKG-4, 2026-10-20: 'pro/structure' is routed — Espace Structure proposals)
]);

const resolves = (p) => routes.some((r) => (r.match === 'exact' ? r.path === p : p.startsWith(r.path) || p.startsWith(r.path + '/')));

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(jsx?|tsx?)$/.test(n) && !/\.(test|spec|stories)\./.test(n)) out.push(f);
  }
  return out;
}

describe('frontend → api route contract', () => {
  const used = new Set();
  for (const f of walk('src')) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`]\/api\/([A-Za-z0-9_\-/]+)/g)) used.add(m[1].replace(/\/$/, ''));
  }
  const unresolved = [...used].filter((p) => !resolves(p)).sort();

  it('finds the frontend API surface', () => { expect(used.size).toBeGreaterThan(80); });
  it('every used path resolves, or is a documented known-unrouted path', () => {
    expect(unresolved.filter((p) => !KNOWN_UNROUTED.has(p))).toEqual([]);
  });
  it('allowlist has no stale entries (each is really unrouted and still used)', () => {
    expect([...KNOWN_UNROUTED].filter((p) => resolves(p) || !used.has(p)).sort()).toEqual([]);
  });
});
