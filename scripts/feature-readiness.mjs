#!/usr/bin/env node
/**
 * R35 (P3): feature readiness doctor — READ-ONLY. For every module of config/activation-manifest.json it answers: is the code there, are the routes
 * declared, are the variables present (and well-formed, when values are available), is the provider configured, are the approvals and legal gates
 * cleared, do the tests exist (and pass, given a vitest JSON report), is the module closed by the restricted beta. It never prints a value, never
 * writes anything, never switches a feature on, and is not reachable over HTTP.
 *
 *   node scripts/feature-readiness.mjs                         values from process.env (LAB)
 *   node scripts/feature-readiness.mjs --vercel production     names only, from `vercel env ls` (run in a linked clone)
 *   node scripts/feature-readiness.mjs --names-file names.json names only, from a JSON array or { NAME: [targets] }
 *   options: --tests-report vitest.json  --json  --module <id>
 *
 * Verdicts, first match wins: MISSING_IMPLEMENTATION, LEGAL_OR_PRIVACY_GATE, MISSING_PROVIDER, MISSING_VARIABLES, MISSING_TEST_EVIDENCE,
 * PRODUCTION_RESTRICTED, READY_TECHNICALLY. LIVE_VERIFIED needs live evidence and is never produced by this read-only tool (see the activation guide).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isAllowedInPublicBeta } from '../api/_utils/public-beta.js';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../api/_utils/capabilities.js';
import { isMainModule } from './lib/is-main.mjs';

export const VERDICTS = ['MISSING_IMPLEMENTATION', 'LEGAL_OR_PRIVACY_GATE', 'MISSING_PROVIDER', 'MISSING_VARIABLES', 'MISSING_TEST_EVIDENCE', 'PRODUCTION_RESTRICTED', 'READY_TECHNICALLY', 'LIVE_VERIFIED'];

/** @param {string} root */
export function loadManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'config', 'activation-manifest.json'), 'utf8'));
}

/** @param {string} root @returns {Set<string>} route paths declared in api/routes.js */
export function declaredRoutes(root) {
  const src = fs.readFileSync(path.join(root, 'api', 'routes.js'), 'utf8');
  return new Set([...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));
}

/** @param {string} root @returns {Map<string, string>} test basename -> relative path */
export function testIndex(root) {
  /** @type {Map<string, string>} */
  const idx = new Map();
  const walk = (/** @type {string} */ d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.test\.[cm]?jsx?$/.test(e.name)) idx.set(e.name, path.relative(root, p));
    }
  };
  walk(path.join(root, 'tests'));
  walk(path.join(root, 'api'));
  return idx;
}

/** @param {string} file vitest --reporter=json output @returns {Map<string, 'passed' | 'failed'>} test basename -> result */
export function readTestsReport(file) {
  /** @type {Map<string, 'passed' | 'failed'>} */
  const out = new Map();
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of j.testResults || []) {
    const base = path.basename(String(r.name || r.testFilePath || ''));
    out.set(base, r.status === 'passed' && !(r.assertionResults || []).some((/** @type {{ status: string }} */ a) => a.status === 'failed') ? 'passed' : 'failed');
  }
  return out;
}

/**
 * @typedef {{ mode: 'values', env: Record<string, string | undefined> } | { mode: 'names', names: Set<string> }} EnvSource
 * @param {EnvSource} src @param {string} name @param {any} meta manifest variable entry
 * @returns {'present' | 'absent' | 'malformed'}
 */
function presence(src, name, meta) {
  const names = [name, ...Object.entries(srcAliases).filter(([, c]) => c === name).map(([a]) => a)];
  if (src.mode === 'names') return names.some((n) => src.names.has(n)) ? 'present' : 'absent';
  const v = names.map((n) => String(src.env[n] ?? '').trim()).find(Boolean);
  if (!v) return 'absent';
  if (meta?.format && !new RegExp(meta.format).test(v)) return 'malformed';
  return 'present';
}
/** @type {Record<string, string>} alias -> canonical, filled by evaluateReadiness */
let srcAliases = {};

/**
 * @param {{ root: string, manifest: any, source: EnvSource, testsReport?: Map<string, 'passed' | 'failed'> }} input
 */
/** @param {string} c */
function capabilityNote(c) {
  const cap = CAPABILITIES[c];
  return `capability ${c} closed in production${cap.aipd === 'out' ? ' (outside the AIPD: ADA_CAPABILITIES_OPEN' + (cap.requiresHds ? ' + ADA_HDS_CERTIFIED_HOSTING' : '') + ')' : ''}`;
}

export function evaluateReadiness({ root, manifest, source, testsReport }) {
  srcAliases = Object.fromEntries(Object.entries(manifest.variables).filter(([, m]) => /** @type {any} */ (m).class === 'alias').map(([n, m]) => [n, /** @type {any} */ (m).canonical]));
  const routes = declaredRoutes(root);
  const tests = testIndex(root);
  const has = (/** @type {string} */ n) => presence(source, n, manifest.variables[n]) === 'present';
  const beta = source.mode === 'values' ? ['1', 'true'].includes(String(source.env.ADA_PUBLIC_BETA_RESTRICTED || '').trim().toLowerCase()) : has('ADA_PUBLIC_BETA_RESTRICTED');
  const byId = new Map(manifest.modules.map((/** @type {any} */ m) => [m.id, m]));

  /** @type {Record<string, any>} */
  const results = {};
  for (const m of manifest.modules) {
    const missingCode = (m.code || []).filter((/** @type {string} */ f) => !fs.existsSync(path.join(root, f)));
    const missingRoutes = (m.routes || []).filter((/** @type {string} */ r) => !routes.has(r));
    const openGaps = (m.gaps || []).filter((/** @type {any} */ g) => {
      const p = path.join(root, g.file);
      return !fs.existsSync(p) || !new RegExp(g.fixed_when, 'i').test(fs.readFileSync(p, 'utf8'));
    }).map((/** @type {any} */ g) => g.id);
    // R36: « A|B » in requires = either variable is enough (an alert channel: a webhook or an e-mail address)
    const one = (/** @type {string} */ n) => ({ name: n, state: presence(source, n, manifest.variables[n]), provider: manifest.variables[n]?.provider, account: Boolean(manifest.variables[n]?.account) });
    const vars = (m.requires || []).map((/** @type {string} */ n) => {
      if (!n.includes('|')) return one(n);
      const alts = n.split('|').map(one); const ok = alts.find((v) => v.state === 'present');
      return ok ? { ...ok, name: n } : { name: n, state: alts[0].state, provider: alts.map((v) => v.provider).filter(Boolean).join(' or '), account: alts.every((v) => v.account) };
    });
    const missingVars = vars.filter((/** @type {any} */ v) => v.state !== 'present');
    const providerMissing = missingVars.filter((/** @type {any} */ v) => v.account);
    const approval = m.approval ? has(m.approval) && (source.mode === 'names' || String(source.env[m.approval]).trim() === 'true') : null;
    const gates = (m.gates || []).filter((/** @type {any} */ g) => !g.cleared_on).map((/** @type {any} */ g) => g.id);
    const testFiles = (m.tests || []).map((/** @type {string} */ t) => ({ name: t, path: tests.get(t) || null, result: testsReport?.get(t) ?? null }));
    const missingTests = testFiles.filter((/** @type {any} */ t) => !t.path || t.result === 'failed').map((/** @type {any} */ t) => t.name);
    const untested = !testFiles.length || (testsReport ? testFiles.some((/** @type {any} */ t) => t.result !== 'passed') : false);
    const deps = (m.requires_module || []).filter((/** @type {string} */ d) => !byId.has(d));
    const betaOpen = m.beta_open || (m.routes || []).every((/** @type {string} */ r) => isAllowedInPublicBeta('GET', r.replace(/\/$/, '')));
    // R45 / ENG-LR-6: the capabilities of the module's routes, as Production evaluates them (enforced). Names mode cannot read ADA_CAPABILITIES_OPEN or the HDS
    // token: an out-of-AIPD capability is then reported as « open only if named », never as open.
    const caps = [...new Set((m.routes || []).flatMap((/** @type {string} */ r) => [...capabilitiesOfRoute(r.replace(/\/$/, ''))]))];
    const closedCaps = caps.filter((c) => (source.mode === 'values'
      ? !capabilityState(c, { ...source.env, VERCEL_ENV: 'production' }).open
      : CAPABILITIES[c].aipd !== 'in'));

    /** @type {string[]} */
    const blockers = [];
    let verdict = 'READY_TECHNICALLY';
    if (missingCode.length || missingRoutes.length || openGaps.length || deps.length || (m.code || []).length === 0) {
      verdict = 'MISSING_IMPLEMENTATION';
      blockers.push(...missingCode.map((/** @type {string} */ f) => `code missing: ${f}`), ...missingRoutes.map((/** @type {string} */ r) => `route not declared: ${r}`), ...openGaps.map((/** @type {string} */ g) => `gap: ${g}`), ...deps.map((/** @type {string} */ d) => `unknown dependency: ${d}`));
      if (!(m.code || []).length) blockers.push('no implementation');
    } else if (gates.length || approval === false) {
      verdict = 'LEGAL_OR_PRIVACY_GATE';
      blockers.push(...gates.map((/** @type {string} */ g) => `gate: ${g}`));
      if (approval === false) blockers.push(`approval not given: ${m.approval}`);
    } else if (providerMissing.length) {
      verdict = 'MISSING_PROVIDER';
      blockers.push(...providerMissing.map((/** @type {any} */ v) => `provider ${v.provider}: ${v.name} ${v.state}`));
    } else if (missingVars.length) {
      verdict = 'MISSING_VARIABLES';
      blockers.push(...missingVars.map((/** @type {any} */ v) => `${v.name} ${v.state}`));
    } else if (missingTests.length || untested) {
      verdict = 'MISSING_TEST_EVIDENCE';
      blockers.push(...(testFiles.length ? missingTests.map((/** @type {string} */ t) => `test missing or failing: ${t}`) : ['no test declared']));
      if (testsReport && !missingTests.length) blockers.push('declared tests not in the report');
    } else if (beta && !betaOpen) {
      verdict = 'PRODUCTION_RESTRICTED';
      blockers.push('closed by the restricted public beta (ADA_PUBLIC_BETA_RESTRICTED)');
    } else if (closedCaps.length) {
      verdict = 'PRODUCTION_RESTRICTED';
      blockers.push(...closedCaps.map((c) => capabilityNote(c)));
    }
    // every other condition is still reported, so one run shows all the work left, not only the first blocker
    const also = [];
    if (verdict !== 'MISSING_VARIABLES' && verdict !== 'MISSING_PROVIDER' && missingVars.length) also.push(...missingVars.map((/** @type {any} */ v) => `${v.name} ${v.state}`));
    if (verdict !== 'LEGAL_OR_PRIVACY_GATE' && gates.length) also.push(...gates.map((/** @type {string} */ g) => `gate: ${g}`));
    if (verdict !== 'PRODUCTION_RESTRICTED' && beta && !betaOpen) also.push('closed by the restricted public beta');
    if (!blockers.some((b) => b.startsWith('capability '))) also.push(...closedCaps.map((c) => capabilityNote(c)));
    results[m.id] = { verdict, blockers, also, capabilities: caps, surfaces: m.surfaces, label: m.label, order: m.order, variables: vars.map((/** @type {any} */ v) => ({ name: v.name, state: v.state })), tests: testFiles };
  }

  // environment-wide findings: forbidden variables that are present (names only when values are unknown)
  /** @type {{ name: string, finding: string }[]} */
  const forbidden = [];
  for (const [n, meta] of Object.entries(manifest.variables)) {
    const mm = /** @type {any} */ (meta);
    const pres = source.mode === 'names' ? source.names.has(n) : Boolean(String(source.env[n] ?? '').trim());
    if (!pres) continue;
    if (mm.class === 'forbidden') forbidden.push({ name: n, finding: 'must not exist in production' });
    else if (mm.class === 'forbidden_warn') forbidden.push({ name: n, finding: 'should be removed' });
    else if (mm.class === 'dead') forbidden.push({ name: n, finding: 'read by no useful code: remove' });
    else if (mm.class === 'lab' && source.mode === 'names') forbidden.push({ name: n, finding: mm.forbidden_in_production ? `LAB only; check its value is not ${mm.forbidden_in_production.replace(/[\^$]/g, '')} (or delete it)` : 'LAB only: not needed on Vercel' });
    else if (mm.forbidden && source.mode === 'values' && new RegExp(mm.forbidden).test(String(source.env[n]).trim())) forbidden.push({ name: n, finding: 'value is forbidden in production' });
    else if (mm.forbidden && source.mode === 'names') forbidden.push({ name: n, finding: 'present: its value must not match the forbidden value (the release gate checks it at build time)' });
    else if (mm.forbidden_in_production && source.mode === 'values' && new RegExp(mm.forbidden_in_production).test(String(source.env[n]).trim())) forbidden.push({ name: n, finding: 'value is forbidden in production' });
  }
  const known = new Set([...Object.keys(manifest.variables), ...manifest.platform]);
  const unknown = source.mode === 'names' ? [...source.names].filter((n) => !known.has(n)).sort() : [];
  return { beta, mode: source.mode, modules: results, forbidden, unknown };
}

/** @param {string} target @returns {Set<string>} */
function vercelNames(target) {
  const res = spawnSync('npx', ['--yes', 'vercel@65.7.0', 'env', 'ls', '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) { process.stderr.write('[readiness] vercel env ls failed (is this clone linked? vercel link)\n'); process.exit(2); }
  const j = JSON.parse(res.stdout.toString('utf8'));
  const items = Array.isArray(j) ? j : j.envs || j.variables || [];
  return new Set(items.filter((/** @type {any} */ i) => [].concat(i.target || i.targets || []).includes(target)).map((/** @type {any} */ i) => i.key || i.name));
}

if (isMainModule(import.meta.url)) {
  const arg = (/** @type {string} */ k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const root = process.cwd();
  const manifest = loadManifest(root);
  /** @type {EnvSource} */
  let source = { mode: 'values', env: process.env };
  if (arg('--vercel')) source = { mode: 'names', names: vercelNames(String(arg('--vercel'))) };
  if (arg('--names-file')) {
    const j = JSON.parse(fs.readFileSync(String(arg('--names-file')), 'utf8'));
    source = { mode: 'names', names: new Set(Array.isArray(j) ? j : Object.keys(j)) };
  }
  const testsReport = arg('--tests-report') ? readTestsReport(String(arg('--tests-report'))) : undefined;
  const out = evaluateReadiness({ root, manifest, source, testsReport });
  const only = arg('--module');
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  } else {
    process.stdout.write(`Feature readiness (${out.mode === 'names' ? 'variable names only' : 'local values, never printed'}; restricted beta: ${out.beta ? 'on' : 'off'})\n\n`);
    const rows = Object.entries(out.modules).filter(([id]) => !only || id === only).sort(([, a], [, b]) => a.order - b.order);
    for (const [id, r] of rows) {
      process.stdout.write(`${r.verdict.padEnd(23)} ${id} — ${r.label}\n`);
      for (const b of r.blockers) process.stdout.write(`    · ${b}\n`);
      for (const b of r.also) process.stdout.write(`    + ${b}\n`);
    }
    if (out.forbidden.length) process.stdout.write(`\nVariables to review:\n${out.forbidden.map((f) => `    ! ${f.name}: ${f.finding}`).join('\n')}\n`);
    if (out.unknown.length) process.stdout.write(`\nNames not read by the application (integration extras or obsolete): ${out.unknown.join(', ')}\n`);
    const count = /** @type {Record<string, number>} */ ({});
    for (const [, r] of rows) count[r.verdict] = (count[r.verdict] || 0) + 1;
    process.stdout.write(`\n${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
  }
}
