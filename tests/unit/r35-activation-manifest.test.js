import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { inventoryEnvReads } from '../../scripts/lib/env-inventory.mjs';
import { loadManifest, evaluateReadiness, declaredRoutes, testIndex, VERDICTS } from '../../scripts/feature-readiness.mjs';
import { guideMissingNames } from '../../scripts/activation-guide-tables.mjs';

// R35 (P2/P3): the activation manifest is the single source of the owner guide, the activation matrix and the readiness doctor. These tests keep it
// in step with the code, so a new environment read or a renamed handler cannot silently drop out of the owner's instructions.
const root = path.resolve(__dirname, '../..');
const manifest = loadManifest(root);
const SECRET = 'r35-sentinel-value-0123456789abcdef0123456789abcdef';

/** every required variable of every module, with a well-formed value */
function fullEnv() {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [n, m] of Object.entries(manifest.variables)) {
    if (['forbidden', 'forbidden_warn', 'forbidden_value', 'dead', 'alias', 'lab'].includes(m.class)) continue;
    env[n] = m.format === '^[0-9a-fA-F]{64}$' ? 'a'.repeat(64) : m.format?.startsWith('^https') ? `https://x.example/${SECRET}` : m.format === '^true$' ? 'true' : m.format === '^jwt$' ? 'jwt' : m.format?.startsWith('^postgres') ? `postgresql://u@db.example/${SECRET}` : m.format === '^jitsi-jwt$' ? 'jitsi-jwt' : m.format === '^(resend|mailjet|noop)?$' ? 'resend' : m.format === '@' ? 'n@example.org' : m.format?.includes('sentry') ? 'https://k@o1.ingest.de.sentry.io/1' : m.format?.startsWith('^(mailto') ? 'mailto:a@example.org' : m.format === '^(1|true)?$' ? '' : `${SECRET}`;
  }
  env.OUTLOOK_REDIRECT_URI = 'https://www.example.org/api/auth/callback/outlook';
  return env;
}

describe('R35 activation manifest', () => {
  it('classifies every environment variable the code reads', () => {
    const known = new Set([...Object.keys(manifest.variables), ...manifest.platform]);
    const unclassified = [...inventoryEnvReads(root).keys()].filter((n) => !known.has(n));
    expect(unclassified).toEqual([]);
  });

  it('names only variables the manifest defines, and aliases point at a defined variable', () => {
    for (const m of manifest.modules) {
      for (const n of [...(m.requires || []), ...(m.optional || []), ...(m.approval ? [m.approval] : [])]) expect(manifest.variables[n], `${m.id}: ${n}`).toBeTruthy();
      for (const d of m.requires_module || []) expect(manifest.modules.some((x) => x.id === d), `${m.id} -> ${d}`).toBe(true);
    }
    for (const [n, v] of Object.entries(manifest.variables)) if (v.class === 'alias') expect(manifest.variables[v.canonical], n).toBeTruthy();
  });

  it('points at code, routes and tests that exist', () => {
    const routes = declaredRoutes(root);
    const tests = testIndex(root);
    for (const m of manifest.modules) {
      for (const f of m.code) expect(fs.existsSync(path.join(root, f)), `${m.id}: ${f}`).toBe(true);
      for (const r of m.routes || []) expect(routes.has(r), `${m.id}: route ${r}`).toBe(true);
      for (const t of m.tests) expect(tests.has(t), `${m.id}: test ${t}`).toBe(true);
    }
  });

  it('covers all seven product surfaces', () => {
    const s = new Set(manifest.modules.flatMap((m) => m.surfaces));
    for (const x of ['public', 'citizen', 'pro', 'structure', 'institution', 'admin', 'operations']) expect(s.has(x), x).toBe(true);
  });

  it('the generated guide tables name every variable of the manifest', () => {
    expect(guideMissingNames(manifest, null)).toEqual([]);
  });
});

describe('R35 feature readiness doctor', () => {
  const run = (/** @type {Record<string, string>} */ env) => evaluateReadiness({ root, manifest, source: { mode: 'values', env } });

  it('never returns a value', () => {
    const out = JSON.stringify(run(fullEnv()));
    expect(out).not.toContain(SECRET);
  });

  it('a module with every variable, no gate, no gap and existing tests is READY_TECHNICALLY; the beta makes a closed one PRODUCTION_RESTRICTED', () => {
    const env = fullEnv();
    expect(run(env).modules['web-push'].verdict).toBe('READY_TECHNICALLY');
    expect(run({ ...env, ADA_PUBLIC_BETA_RESTRICTED: '1' }).modules['web-push'].verdict).toBe('PRODUCTION_RESTRICTED');
    expect(run({ ...env, ADA_PUBLIC_BETA_RESTRICTED: '1' }).modules['public-content'].verdict).toBe('READY_TECHNICALLY');
  });

  it('reports missing and malformed variables, and an absent provider account', () => {
    const env = fullEnv();
    delete env.WEB_PUSH_SUBJECT;
    expect(run(env).modules['web-push']).toMatchObject({ verdict: 'MISSING_VARIABLES', blockers: ['WEB_PUSH_SUBJECT absent'] });
    expect(run({ ...fullEnv(), WEB_PUSH_SUBJECT: 'nobody' }).modules['web-push'].blockers).toEqual(['WEB_PUSH_SUBJECT malformed']);
    const noKey = fullEnv();
    delete noKey.AIDES_TERRITOIRES_API_KEY;
    expect(run(noKey).modules['source-aides-territoires'].verdict).toBe('MISSING_PROVIDER');
  });

  it('keeps legal gates and approvals closed whatever the variables say, and open implementation gaps first', () => {
    const r = run(fullEnv());
    expect(r.modules.video.verdict).toBe('MISSING_IMPLEMENTATION');
    expect(r.modules.video.also).toContain('gate: video-dpia');
    expect(r.modules.coffre).toMatchObject({ verdict: 'LEGAL_OR_PRIVACY_GATE', blockers: ['gate: hds', 'gate: storage-dpa'] });
    expect(r.modules['gdpr-purge'].verdict).toBe('LEGAL_OR_PRIVACY_GATE');
    expect(r.modules.mail.blockers).toContain('gate: mail-dpa');
    expect(r.modules.sms.blockers).toContain('gap: sms-stop-route');
  });

  it('flags forbidden variables', () => {
    const r = run({ ...fullEnv(), ADMIN_TOKEN: SECRET, VITE_SENTRY_REPLAY: 'true', ENABLE_AI_AGENT: 'true' });
    const names = r.forbidden.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['ADMIN_TOKEN', 'VITE_SENTRY_REPLAY', 'ENABLE_AI_AGENT']));
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('works from variable names only (Vercel listing) and lists unknown names', () => {
    const r = evaluateReadiness({ root, manifest, source: { mode: 'names', names: new Set(['DATABASE_URL', 'NEON_PROJECT_ID', 'OUTLOOK_ENABLED']) } });
    expect(r.unknown).toEqual(['NEON_PROJECT_ID']);
    expect(r.forbidden.map((f) => f.name)).toContain('OUTLOOK_ENABLED');
    expect(r.modules.core.verdict).toBe('MISSING_VARIABLES');
    for (const m of Object.values(r.modules)) expect(VERDICTS).toContain(m.verdict);
  });
});
