#!/usr/bin/env node
/**
 * G14 (owner 23/11/2026: « OpenFisca için Scaleway ücretsiz kotasını kota kilidiyle … 0 € maliyet ») — builds and deploys the self-hosted OpenFisca-France
 * engine of AccesDirectAide to a Scaleway Serverless Container (fr-par), FREE-TIER SHAPED ONLY: min-scale 0, max-scale 1, one memory/vCPU tier, private.
 *
 *   node ops/openfisca/deploy_scaleway.mjs                      # DRY RUN (default): prints the plan and the container spec; no network, no change
 *   node ops/openfisca/deploy_scaleway.mjs --build-only <dir>   # builds the image locally into an OCI layout <dir> (PyPI + Docker Hub reads; no Scaleway)
 *   node ops/openfisca/deploy_scaleway.mjs --apply --project-id <uuid> [--memory 1024] [--rotate-token] [--skip-build]
 *
 * --apply (owner- or Claude-run, after the owner's go): 1. builds the image WITHOUT Docker — the python:3.11-slim-bookworm amd64 base (digest-pinned, copied
 * blob by blob from Docker Hub like CONTROL/v2/c7/provision/mirror-image.mjs) + ONE layer: the hashed wheels of requirements.lock installed with
 * `uv pip install --target` (or pip) for CPython 3.11 / manylinux x86_64 and the two app files — the same image as ./Dockerfile; pushes it to the existing
 * registry namespace rg.fr-par.scw.cloud/ada-c7-base (repository openfisca-france; public image, nothing secret in it; AGPL source is public anyway);
 * 2. creates or updates (idempotent: only what differs is patched) the containers namespace « ada-openfisca » and the container « openfisca-france »;
 * 3. creates a container token (Scaleway JWT) when none is recorded or --rotate-token: written to ~/.config/ada-openfisca/openfisca-auth-token (0600),
 *    NEVER printed; the container receives only its sha256 (secret env ADA_OPENFISCA_TOKEN_SHA256); older tokens of the container are deleted;
 * 4. deploys, waits for « ready », checks: anonymous call refused by the gateway, /healthz and /spec with the token state openfisca-france 176.1.6;
 * 5. prints ONLY the endpoint and the variable names to set (OPENFISCA_URL value = the endpoint; the token is read from the file by the owner's command).
 * Refuses: any shape that is not free-tier (max-scale ≠ 1, min-scale ≠ 0, unknown tier, public privacy, region ≠ fr-par), and another Serverless Container
 * in the project (it would share the account's free tier the API guard counts alone) unless --allow-other-containers.
 * The Scaleway secret key is read from the owner's macOS keychain (service ada-c7, account scaleway-secret-key — the K3 pattern) and never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REGION = 'fr-par';
export const API = 'https://api.scaleway.com';
export const REGISTRY = 'rg.fr-par.scw.cloud';
export const IMAGE_REPO = 'ada-c7-base/openfisca-france';
export const BASE = Object.freeze({ repo: 'library/python', tag: '3.11-slim-bookworm', digest: 'sha256:e8c69d86735f6df3efa06b324694fe51f0422785f83a3bd463052636c2421944' });
export const NAMESPACE_NAME = 'ada-openfisca';
export const CONTAINER_NAME = 'openfisca-france';
export const TIERS = Object.freeze({ 512: 280, 1024: 560, 2048: 1120 });   // = api/lib/openfiscaPins.js SCALEWAY_TIERS
export const DEFAULT_MEMORY = 1024;
export const FRANCE_PIN = '176.1.6';
export const STATE_DIR = path.join(os.homedir(), '.config', 'ada-openfisca');
export const TOKEN_FILE = path.join(STATE_DIR, 'openfisca-auth-token');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const EPOCH = 1795392000;   // 2026-11-23T00:00:00Z: fixed mtimes, reproducible layer
const APP_ENV = Object.freeze({ PYTHONPATH: '/opt/ada-openfisca/site:/opt/ada-openfisca/app', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1',
  OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', ADA_OPENFISCA_REQUIRE_TOKEN: '1', PORT: '8080' });
const CMD = Object.freeze(['python', '-m', 'gunicorn', '-c', '/opt/ada-openfisca/app/gunicorn.conf.py', 'ada_openfisca_app:application']);

const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const die = (m) => { console.error(`FAIL ${m}`); process.exit(1); };

/* ── arguments and the free-tier shape ───────────────────────────────────── */
export function parseArgs(argv) {
  const o = { apply: false, buildOnly: null, projectId: process.env.ADA_OPENFISCA_SCW_PROJECT_ID || null, memory: DEFAULT_MEMORY, minScale: 0, maxScale: 1,
    privacy: 'private', region: REGION, rotateToken: false, skipBuild: false, allowOtherContainers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${a} needs a value`); return x; };
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--build-only') o.buildOnly = v();
    else if (a === '--project-id') o.projectId = v();
    else if (a === '--memory') o.memory = Number(v());
    else if (a === '--min-scale') o.minScale = Number(v());
    else if (a === '--max-scale') o.maxScale = Number(v());
    else if (a === '--privacy') o.privacy = v();
    else if (a === '--region') o.region = v();
    else if (a === '--rotate-token') o.rotateToken = true;
    else if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--allow-other-containers') o.allowOtherContainers = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** @returns {string[]} why the requested shape is not free-tier-shaped (empty = accepted) */
export function shapeProblems(o) {
  const p = [];
  if (o.minScale !== 0) p.push('min-scale must be 0 (an always-on instance consumes the free tier in about 4 to 9 days)');
  if (o.maxScale !== 1) p.push('max-scale must be 1 (the API guard counts one instance)');
  if (!Object.prototype.hasOwnProperty.call(TIERS, String(o.memory))) p.push(`memory must be one of ${Object.keys(TIERS).join(', ')} MB (measured need ~420 MB)`);
  if (o.privacy !== 'private') p.push('privacy must be private (anonymous traffic must not wake the container)');
  if (o.region !== REGION) p.push(`region must be ${REGION}`);
  if (o.apply && !/^[0-9a-f-]{36}$/i.test(String(o.projectId || ''))) p.push('--project-id <Scaleway project uuid> (or ADA_OPENFISCA_SCW_PROJECT_ID) is required with --apply');
  return p;
}

/** the container as it must be (registry image filled in at apply time); the token hash is added as a secret env var, never here */
export function containerSpec(o, image = '<image digest after build>') {
  return { name: CONTAINER_NAME, description: 'AccesDirectAide - OpenFisca-France (AGPL-3.0, unmodified; https://github.com/openfisca/openfisca-france); free tier only',
    registry_image: image, min_scale: 0, max_scale: 1, memory_limit: o.memory, cpu_limit: TIERS[o.memory], privacy: 'private', port: 8080, timeout: '60s',
    protocol: 'http1', http_option: 'redirected', sandbox: 'v2', environment_variables: { ADA_OPENFISCA_REQUIRE_TOKEN: '1' },
    health_check: { http: { path: '/healthz' }, failure_threshold: 30, interval: '10s' }, scaling_option: { concurrent_requests_threshold: 4 } };
}

/** the fields compared on an existing container (a drift is patched back; a non-free-tier drift is always corrected) */
export function specDiff(current, want) {
  const keys = ['registry_image', 'min_scale', 'max_scale', 'memory_limit', 'cpu_limit', 'privacy', 'port', 'timeout', 'protocol', 'http_option', 'sandbox', 'description'];
  const d = {};
  for (const k of keys) if (JSON.stringify(current?.[k]) !== JSON.stringify(want[k])) d[k] = want[k];
  if (JSON.stringify(current?.environment_variables || {}) !== JSON.stringify(want.environment_variables)) d.environment_variables = want.environment_variables;
  if (current?.health_check?.http?.path !== want.health_check.http.path) d.health_check = want.health_check;
  return d;
}

export function planText(o) {
  const spec = containerSpec(o);
  return [
    `DRY RUN — nothing is contacted or changed. Add --apply --project-id <uuid> to run (owner go required).`,
    `1. build image (no Docker): ${BASE.repo}:${BASE.tag}@${BASE.digest} (linux/amd64) + 1 layer (requirements.lock wheels for cp311/manylinux x86_64 + ada_openfisca_app.py, gunicorn.conf.py)`,
    `   push to ${REGISTRY}/${IMAGE_REPO} (existing registry namespace ada-c7-base)`,
    `2. containers namespace « ${NAMESPACE_NAME} » (${REGION}) — create if missing`,
    `3. container « ${CONTAINER_NAME} » — create or patch only what differs:`,
    ...JSON.stringify(spec, null, 2).split('\n').map((l) => `   ${l}`),
    `4. container token — created if none is recorded (or --rotate-token): saved to ${TOKEN_FILE} (0600), never printed; container gets only its sha256 (secret env)`,
    `5. deploy, wait « ready »; checks: anonymous call refused; /healthz + /spec with token = openfisca-france ${FRANCE_PIN}`,
    `6. prints the endpoint and the variables to set: OPENFISCA_URL, OPENFISCA_AUTH_TOKEN (from the file), OPENFISCA_FRANCE_VERSION=${FRANCE_PIN},`,
    `   OPENFISCA_CONTAINER_MEMORY_MB=${o.memory}, OPENFISCA_CONTAINER_MVCPU=${TIERS[o.memory]}, OPENFISCA_TIMEOUT_MS=30000, OPENFISCA_HEALTH_TIMEOUT_MS=25000`,
  ].join('\n');
}

/* ── reproducible tar (ustar + pax for long names) ───────────────────────── */
function header(name, { mode, size = 0, type = '0', linkname = '' }) {
  const h = Buffer.alloc(512);
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  let nm = name; let prefix = '';
  if (Buffer.byteLength(nm) > 100) {
    const cut = nm.lastIndexOf('/', nm.length - 2);
    const ok = (i) => i > 0 && Buffer.byteLength(nm.slice(0, i)) <= 155 && Buffer.byteLength(nm.slice(i + 1)) <= 100;
    let i = cut; while (i > 0 && !ok(i)) i = nm.lastIndexOf('/', i - 1);
    if (i > 0) { prefix = nm.slice(0, i); nm = nm.slice(i + 1); } else nm = nm.slice(0, 100);   // caller adds a pax record
  }
  h.write(nm, 0, 100, 'utf8'); h.write(oct(mode, 8), 100); h.write(oct(0, 8), 108); h.write(oct(0, 8), 116);
  h.write(oct(size, 12), 124); h.write(oct(EPOCH, 12), 136); h.fill(' ', 148, 156); h.write(type, 156); h.write(linkname, 157, 100);
  h.write('ustar\0', 257); h.write('00', 263); h.write('root', 265); h.write('root', 297); h.write(prefix, 345, 155, 'utf8');
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
function needsPax(name) {
  if (Buffer.byteLength(name) <= 100) return false;
  for (let i = name.lastIndexOf('/', name.length - 2); i > 0; i = name.lastIndexOf('/', i - 1)) {
    if (Buffer.byteLength(name.slice(0, i)) <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100) return false;
  }
  return true;
}
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`; let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
}
/** @param {{ name: string, dir?: boolean, data?: Buffer, mode?: number }[]} entries @returns {Buffer} */
export function tarOf(entries) {
  const parts = [];
  for (const e of entries) {
    const name = e.dir ? e.name.replace(/\/?$/, '/') : e.name;
    if (needsPax(name)) { const rec = paxRecord('path', name); parts.push(header(`PaxHeaders/${crypto.createHash('sha1').update(name).digest('hex')}`, { mode: 0o644, size: rec.length, type: 'x' }), rec, pad(rec.length)); }
    if (e.dir) parts.push(header(name, { mode: e.mode ?? 0o755, type: '5' }));
    else { parts.push(header(name, { mode: e.mode ?? 0o644, size: e.data.length }), e.data, pad(e.data.length)); }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
export function gzipDeterministic(buf) { const gz = zlib.gzipSync(buf, { level: 9 }); gz[4] = gz[5] = gz[6] = gz[7] = 0; gz[9] = 3; return gz; }

/** sorted entries of a staged tree under a prefix; symlinks are refused (the layer holds plain files only) */
export function treeEntries(root, prefix) {
  const out = [];
  const walk = (dir, rel) => {
    for (const n of fs.readdirSync(dir).sort()) {
      if (n === '__pycache__' || n === '.DS_Store') continue;
      const abs = path.join(dir, n); const r = rel ? `${rel}/${n}` : n; const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`symlink in the layer: ${r}`);
      if (st.isDirectory()) { out.push({ name: `${prefix}/${r}`, dir: true }); walk(abs, r); }
      else out.push({ name: `${prefix}/${r}`, data: fs.readFileSync(abs), mode: st.mode & 0o111 ? 0o755 : 0o644 });
    }
  };
  walk(root, '');
  return out;
}

/* ── build ─────────────────────────────────────────────────────────────── */
async function hubToken() {
  const r = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${BASE.repo}:pull`);
  if (!r.ok) die(`Docker Hub token HTTP ${r.status}`); return (await r.json()).token;
}
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

/** builds the layer locally; returns { base, manifest, config, layer, blobs } (base blobs are fetched lazily when pushed) */
export async function buildImage({ log = console.log } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-openfisca-build-'));
  const site = path.join(tmp, 'site');
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0;
  const lock = path.join(HERE, 'requirements.lock');
  const args = uv
    ? ['pip', 'install', '--quiet', '--target', site, '--python-platform', 'x86_64-manylinux_2_28', '--python-version', '3.11', '--only-binary', ':all:', '--require-hashes', '--no-deps', '--no-compile', '-r', lock]
    : ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--target', site, '--platform', 'manylinux_2_28_x86_64', '--platform', 'manylinux_2_17_x86_64', '--platform', 'manylinux2014_x86_64',
      '--python-version', '3.11', '--implementation', 'cp', '--only-binary=:all:', '--require-hashes', '--no-deps', '--no-compile', '-r', lock];
  log(`build: ${uv ? 'uv pip' : 'python3 -m pip'} install --target (cp311, manylinux x86_64, hashed wheels from requirements.lock)`);
  const r = spawnSync(uv ? 'uv' : 'python3', args, { stdio: 'inherit', env: { ...process.env, PIP_NO_INPUT: '1' } });
  if (r.status !== 0) die('wheel install failed');
  fs.rmSync(path.join(site, 'bin'), { recursive: true, force: true });
  const so = treeEntries(site, 'x').filter((e) => /\.so$/.test(e.name) && /darwin|macosx/.test(e.name));
  if (so.length) die('a macOS binary got into the layer');
  const entries = [{ name: 'opt', dir: true }, { name: 'opt/ada-openfisca', dir: true }, { name: 'opt/ada-openfisca/site', dir: true }, ...treeEntries(site, 'opt/ada-openfisca/site'),
    { name: 'opt/ada-openfisca/app', dir: true },
    ...['ada_openfisca_app.py', 'gunicorn.conf.py'].map((f) => ({ name: `opt/ada-openfisca/app/${f}`, data: fs.readFileSync(path.join(HERE, f)), mode: 0o644 }))];
  const tar = tarOf(entries); const layer = gzipDeterministic(tar);
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`layer: ${sha(layer)} (${(layer.length / 1e6).toFixed(1)} MB gz, ${(tar.length / 1e6).toFixed(1)} MB tar, ${entries.length} entries)`);

  const tok = await hubToken();
  const H = (p) => fetch(`https://registry-1.docker.io/v2/${BASE.repo}/${p}`, { headers: { authorization: `Bearer ${tok}`, accept: OCI_MANIFEST } });
  const mres = await H(`manifests/${BASE.digest}`); const mbytes = Buffer.from(await mres.arrayBuffer());
  if (sha(mbytes) !== BASE.digest) die('base manifest digest mismatch');
  const base = JSON.parse(mbytes); const baseType = mres.headers.get('content-type') || base.mediaType;
  const cbytes = Buffer.from(await (await H(`blobs/${base.config.digest}`)).arrayBuffer());
  if (sha(cbytes) !== base.config.digest) die('base config digest mismatch');
  const cfg = JSON.parse(cbytes);
  if (cfg.architecture !== 'amd64' || cfg.os !== 'linux') die('base is not linux/amd64');
  const env = (cfg.config.Env || []).filter((e) => !Object.keys(APP_ENV).includes(e.split('=')[0]));
  cfg.config = { ...cfg.config, Env: [...env, ...Object.entries(APP_ENV).map(([k, v]) => `${k}=${v}`)], User: '65534:65534', WorkingDir: '/opt/ada-openfisca/app',
    Cmd: [...CMD], Entrypoint: null, ExposedPorts: { '8080/tcp': {} },
    Labels: { 'org.opencontainers.image.source': 'https://github.com/openfisca/openfisca-france', 'org.opencontainers.image.licenses': 'AGPL-3.0-only',
      'fr.accesdirectaide.openfisca-france.version': FRANCE_PIN } };
  cfg.created = new Date(EPOCH * 1000).toISOString();
  cfg.rootfs.diff_ids = [...cfg.rootfs.diff_ids, sha(tar)];
  cfg.history = [...(cfg.history || []), { created: cfg.created, created_by: 'ADA G14: openfisca-core 44.7.1 + openfisca-france 176.1.6 (unmodified, hashed wheels) + WSGI token gate; non-root' }];
  const config = Buffer.from(JSON.stringify(cfg));
  const manifest = Buffer.from(JSON.stringify({ ...base, config: { ...base.config, digest: sha(config), size: config.length },
    layers: [...base.layers, { mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha(layer), size: layer.length }] }));
  return { base, baseType, manifest, manifestType: baseType, config, layer, hub: H };
}

/** writes an OCI image layout (for inspection: `tar -tzf <dir>/blobs/sha256/<layer>`); base layers are referenced, not downloaded */
function writeLayout(dir, img) {
  const blobs = path.join(dir, 'blobs', 'sha256'); fs.mkdirSync(blobs, { recursive: true });
  for (const b of [img.layer, img.config, img.manifest]) fs.writeFileSync(path.join(blobs, sha(b).slice(7)), b);
  fs.writeFileSync(path.join(dir, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: img.manifestType, digest: sha(img.manifest), size: img.manifest.length }] }));
}

/* ── Scaleway ──────────────────────────────────────────────────────────── */
function scwKey() {
  const k = spawnSync('security', ['find-generic-password', '-s', 'ada-c7', '-a', 'scaleway-secret-key', '-w'], { encoding: 'utf8' }).stdout.trim();
  if (!k) die('scaleway-secret-key missing in the keychain (service ada-c7)'); return k;
}
function scw(key) {
  const call = async (method, p, body) => {
    let r;
    // 409 = the resource is still in a transient state (a container just created is « creating » for a while): wait and retry, up to ~5 min
    for (let i = 0; ; i++) {
      r = await fetch(`${API}${p}`, { method, headers: { 'X-Auth-Token': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (r.status !== 409 || method === 'GET' || i >= 60) break;
      if (i === 0) console.log(`wait: Scaleway ${method} ${p.split('?')[0]} → 409 (resource busy), retrying every 5 s`);
      await r.text(); await sleep(5000);
    }
    const text = await r.text();
    if (!r.ok) die(`Scaleway ${method} ${p.split('?')[0]} HTTP ${r.status}`);   // the body is not printed (it may echo values)
    return text ? JSON.parse(text) : {};
  };
  return { get: (p) => call('GET', p), send: call };
}
async function registryPush(key, img) {
  const probe = await fetch(`https://${REGISTRY}/v2/`); const h = probe.headers.get('www-authenticate') || '';
  const u = new URL(/realm="([^"]+)"/.exec(h)?.[1] || die('no registry auth realm')); const svc = /service="([^"]+)"/.exec(h)?.[1]; if (svc) u.searchParams.set('service', svc);
  u.searchParams.set('scope', `repository:${IMAGE_REPO}:pull,push`);
  const tr = await fetch(u, { headers: { authorization: 'Basic ' + Buffer.from(`nologin:${key}`).toString('base64') } }); if (!tr.ok) die(`registry token HTTP ${tr.status}`);
  const tok = (await tr.json()).token;
  const R = (p, o = {}) => fetch(p.startsWith('https://') ? p : `https://${REGISTRY}/v2/${IMAGE_REPO}/${p}`, { ...o, headers: { authorization: `Bearer ${tok}`, ...(o.headers || {}) } });
  const put = async (digest, getBody) => {
    if ((await R(`blobs/${digest}`, { method: 'HEAD' })).ok) return;
    const body = await getBody(); if (sha(body) !== digest) die('blob digest mismatch');
    const up = await R('blobs/uploads/', { method: 'POST' }); if (up.status !== 202) die(`upload start HTTP ${up.status}`);
    const loc = new URL(up.headers.get('location'), `https://${REGISTRY}`); loc.searchParams.set('digest', digest);
    const p = await R(loc.toString(), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) }, body });
    if (p.status !== 201) die(`blob put HTTP ${p.status}`);
  };
  for (const l of img.base.layers) await put(l.digest, async () => Buffer.from(await (await img.hub(`blobs/${l.digest}`)).arrayBuffer()));
  await put(sha(img.layer), async () => img.layer); await put(sha(img.config), async () => img.config);
  const tag = `${FRANCE_PIN}-${sha(img.layer).slice(7, 19)}`;
  const mp = await R(`manifests/${tag}`, { method: 'PUT', headers: { 'content-type': img.manifestType }, body: img.manifest });
  if (mp.status !== 201) die(`manifest put HTTP ${mp.status}`);
  if (mp.headers.get('docker-content-digest') !== sha(img.manifest)) die('pushed manifest digest mismatch');
  return `${REGISTRY}/${IMAGE_REPO}@${sha(img.manifest)}`;
}
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
const writeState = (s) => { fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apply(o) {
  const key = scwKey(); const s = scw(key); const C = `/containers/v1beta1/regions/${REGION}`; const state = readState();
  // the free tier is per ACCOUNT: another container in the project would consume what the API guard counts for OpenFisca alone
  const nsList = (await s.get(`${C}/namespaces?project_id=${o.projectId}&page_size=100`)).namespaces || [];
  const others = [];
  for (const ns of nsList) for (const c of (await s.get(`${C}/containers?namespace_id=${ns.id}&page_size=100`)).containers || []) if (!(ns.name === NAMESPACE_NAME && c.name === CONTAINER_NAME)) others.push(`${ns.name}/${c.name}`);
  if (others.length && !o.allowOtherContainers) die(`other Serverless Containers in the project (${others.length}): they share the free tier — refused (--allow-other-containers to override after checking)`);

  let image = state.image;
  if (!o.skipBuild || !image) image = await registryPush(key, await buildImage());
  console.log(`image ${image}`);

  let ns = nsList.find((n) => n.name === NAMESPACE_NAME);
  if (!ns) ns = await s.send('POST', `${C}/namespaces`, { name: NAMESPACE_NAME, project_id: o.projectId, description: 'AccesDirectAide OpenFisca (free tier only)' });
  for (let i = 0; i < 60 && ns.status !== 'ready'; i++) { await sleep(5000); ns = await s.get(`${C}/namespaces/${ns.id}`); }
  if (ns.status !== 'ready') die(`namespace status ${ns.status}`);

  const want = containerSpec(o, image);
  let c = ((await s.get(`${C}/containers?namespace_id=${ns.id}&name=${CONTAINER_NAME}`)).containers || []).find((x) => x.name === CONTAINER_NAME);
  if (!c) c = await s.send('POST', `${C}/containers`, { namespace_id: ns.id, ...want });
  else { const d = specDiff(c, want); if (Object.keys(d).length) { console.log(`patch: ${Object.keys(d).join(', ')}`); c = await s.send('PATCH', `${C}/containers/${c.id}`, { ...d, redeploy: false }); } }
  // read back the free-tier shape before any deploy
  if (c.min_scale !== 0 || c.max_scale !== 1 || c.privacy !== 'private' || c.memory_limit !== o.memory) die('container read-back is not free-tier-shaped');

  let token = null; try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { token = null; }
  const tokenOk = token && state.containerId === c.id && state.tokenSha256 === sha(token).slice(7);
  if (o.rotateToken || !tokenOk) {
    const before = ((await s.get(`${C}/tokens?container_id=${c.id}&page_size=100`)).tokens || []).map((t) => t.id);
    const t = await s.send('POST', `${C}/tokens`, { container_id: c.id, description: 'AccesDirectAide API (OPENFISCA_AUTH_TOKEN)' });
    if (!t.token) die('token creation returned no token');
    token = t.token; fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
    await s.send('PATCH', `${C}/containers/${c.id}`, { secret_environment_variables: [{ key: 'ADA_OPENFISCA_TOKEN_SHA256', value: sha(token).slice(7) }], redeploy: false });
    for (const id of before) if (id !== t.id) await s.send('DELETE', `${C}/tokens/${id}`);
    console.log(`token: new token written to ${TOKEN_FILE} (0600; not printed); ${before.length} older token(s) deleted`);
  }
  writeState({ ...state, projectId: o.projectId, namespaceId: ns.id, containerId: c.id, image, tokenSha256: sha(token).slice(7), memory: o.memory, at: new Date().toISOString() });

  await s.send('POST', `${C}/containers/${c.id}/deploy`, {});
  for (let i = 0; i < 120; i++) { await sleep(5000); c = await s.get(`${C}/containers/${c.id}`); if (c.status === 'ready' || c.status === 'error') break; }
  if (c.status !== 'ready') die(`container status ${c.status}${c.error_message ? ' — Scaleway: ' + String(c.error_message).slice(0, 300) : ''}`);
  const url = `https://${c.domain_name}`;
  const anon = await fetch(`${url}/healthz`); if (anon.ok) die('anonymous request was accepted: the container is not private');
  const hz = await fetch(`${url}/healthz`, { headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(120_000) });
  const hj = hz.ok ? await hz.json() : {}; if (!hz.ok || hj.version !== FRANCE_PIN) die(`healthz with token: HTTP ${hz.status}, version ${hj.version ?? '?'}`);
  const sp = await fetch(`${url}/spec`, { headers: { 'X-Auth-Token': token, 'X-ADA-OpenFisca-Token': token }, signal: AbortSignal.timeout(60_000) });
  if (!sp.ok || sp.headers.get('country-package-version') !== FRANCE_PIN) die(`/spec with token: HTTP ${sp.status}`);
  writeState({ ...readState(), domain: c.domain_name, verifiedAt: new Date().toISOString() });
  console.log(`\nOK endpoint ${url}`);
  console.log(`Set in Vercel (Production), then redeploy:\n  OPENFISCA_URL=${url}\n  OPENFISCA_AUTH_TOKEN  (value: the file ${TOKEN_FILE}, e.g. vercel env add OPENFISCA_AUTH_TOKEN production < ${TOKEN_FILE})`);
  console.log(`  OPENFISCA_FRANCE_VERSION=${FRANCE_PIN}\n  OPENFISCA_CONTAINER_MEMORY_MB=${o.memory}\n  OPENFISCA_CONTAINER_MVCPU=${TIERS[o.memory]}\n  OPENFISCA_TIMEOUT_MS=30000\n  OPENFISCA_HEALTH_TIMEOUT_MS=25000`);
}

async function main() {
  let o; try { o = parseArgs(process.argv.slice(2)); } catch (e) { die(e.message); }
  const problems = shapeProblems(o);
  if (problems.length) die(`refused (not free-tier-shaped): ${problems.join('; ')}`);
  if (o.buildOnly) { const img = await buildImage(); writeLayout(path.resolve(o.buildOnly), img); console.log(`OK OCI layout ${path.resolve(o.buildOnly)} manifest ${sha(img.manifest)}`); return; }
  if (!o.apply) { console.log(planText(o)); return; }
  await apply(o);
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
