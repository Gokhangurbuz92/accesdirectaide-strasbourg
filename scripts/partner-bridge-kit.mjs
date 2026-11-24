#!/usr/bin/env node
// @ts-check
/**
 * R3 / FA-D7 — conformance kit of the partner referral bridge `ada.partner-referral/1` (docs/partner-bridge/ONBOARDING_FR.md). It uses the SAME contract
 * module as the server (api/lib/partner-adapter/contract.js), so what it signs and accepts is exactly what ADA signs and accepts. No database, no ADA
 * deployment, nothing personal: every identifier it makes starts with « sandbox- ».
 *
 * Secrets are read from an environment variable NAMED on the command line (--secret-env NAME), never from an argument (shell history, process list).
 *
 *   vector                                       the fixed test vector (secret, timestamp, body → signature) a partner implementation must reproduce
 *   sample-event [received|cancelled|expired|closed]   a synthetic outbound event (what ADA POSTs to the partner)
 *   sample-callback <acknowledge|accept|decline|needs_info|start|complete>   a synthetic inbound body (what the partner POSTs to ADA)
 *   sign --secret-env NAME [--t <unix>] <file.json | ->           canonical JSON + the ADA-Signature header of a body
 *   verify --secret-env NAME --header "t=…,v1=…" [--now <unix>] <file.json | ->   check a signature as ADA does (tolerance 300 s)
 *   validate-callback <file.json | ->            check an inbound body against the contract (problem codes only)
 *   send-event --endpoint <url> --secret-env NAME [--type received] [--dry-run]   POST one signed synthetic event to the partner's TEST endpoint
 *                                                (https, or http on 127.0.0.1 / localhost) and print the HTTP status
 *   mock-ada --secret-env NAME [--port 8790] [--partner sandbox-partner]   a local stand-in of ADA's inbound endpoint on 127.0.0.1:
 *                                                POST /api/monitor/partner/referral-events?partner=<id> — signature, contract, idempotency (replay / key
 *                                                reuse) and the answers of the real endpoint; referral ids must start with « sandbox- »; nothing is stored on disk
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { PARTNER_CONTRACT, MIN_SECRET_LENGTH, INBOUND_ACTIONS, INBOUND_DECLINE_CODES, INBOUND_OUTCOMES, EVENT_TYPES, buildOutboundEvent, canonicalJson, signHeader,
  signatureOf, validateInbound, verifySignature, SIGNATURE_HEADER } from '../api/lib/partner-adapter/contract.js';
import { isMainModule } from './lib/is-main.mjs';

export const VECTOR = Object.freeze({ secret: 'k'.repeat(32), t: 1700000000, body: { b: 2, a: 'x' }, canonical: '{"a":"x","b":2}',
  signature: '436e556ec7c122d742f5c848ab0f4c9e63d0e82206cf30c675a9382607b9d7a6' });

/** the referral state the inbound action leads to on the native path (for the sandbox answers only) */
const NEXT_STATUS = Object.freeze({ acknowledge: 'ACKNOWLEDGED', accept: 'ACCEPTED', decline: 'DECLINED', needs_info: 'NEEDS_INFO', start: 'IN_PROGRESS', complete: 'COMPLETED' });
const TYPE_TO_STATE = Object.freeze(Object.fromEntries(Object.entries(EVENT_TYPES).map(([state, type]) => [type.replace('referral.', ''), state])));

/** a synthetic outbound event @param {string} [kind] received | cancelled | expired | closed @param {Date} [now] */
export function sampleEvent(kind = 'received', now = new Date()) {
  const state = TYPE_TO_STATE[kind];
  if (!state) throw new Error(`unknown event type « ${kind} » (received, cancelled, expired, closed)`);
  const referralId = `sandbox-${crypto.randomUUID()}`;
  return buildOutboundEvent({ id: `sandbox-${crypto.randomUUID()}`, toStatus: state, createdAt: now }, { id: referralId, reasonCode: 'ACCESS_TO_RIGHTS', dueAt: new Date(now.getTime() + 5 * 86400000) },
    `https://accesdirectaide.fr/pro/orientations/${referralId}`);
}

/** a synthetic inbound body @param {string} action @param {Date} [now] */
export function sampleCallback(action, now = new Date()) {
  if (!INBOUND_ACTIONS.includes(action)) throw new Error(`unknown action « ${action} » (${INBOUND_ACTIONS.join(', ')})`);
  /** @type {Record<string, string>} */
  const body = { contract: PARTNER_CONTRACT, idempotencyKey: `sandbox-${crypto.randomUUID()}`, referralId: `sandbox-${crypto.randomUUID()}`, action, occurredAt: now.toISOString() };
  if (action === 'decline') body.responseCode = INBOUND_DECLINE_CODES[0];
  if (action === 'needs_info') body.message = 'Merci de préciser le besoin (exemple synthétique).';
  if (action === 'complete') { body.outcome = INBOUND_OUTCOMES[0]; body.citizenSummary = 'Accompagnement terminé (exemple synthétique).'; }
  return body;
}

/** @param {string} name */
function secretFrom(name) {
  const v = String(process.env[String(name || '')] || '');
  if (!name || v.length < MIN_SECRET_LENGTH) throw new Error(`--secret-env must name an environment variable holding the shared secret (>= ${MIN_SECRET_LENGTH} characters)`);
  return v;
}

/** an endpoint the kit may send to: https, or http on the loopback (a partner's local test server) @param {string} value */
export function sandboxEndpoint(value) {
  let u; try { u = new URL(String(value)); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
}

/**
 * The sandbox stand-in of ADA's inbound endpoint (pure request handling: tested without a socket).
 * @param {{ partnerId: string, secret: string, store?: Map<string, { fingerprint: string, status: number, body: any }>, nowSeconds?: () => number }} cfg
 * @returns {(req: { method: string, url: string, headers: Record<string, unknown>, body: unknown }) => { status: number, body: any }}
 */
export function mockAdaHandler(cfg) {
  const store = cfg.store || new Map();
  return (req) => {
    let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return { status: 404, body: { error: 'Not Found' } }; }
    if (u.pathname !== '/api/monitor/partner/referral-events') return { status: 404, body: { error: 'Not Found' } };
    if (req.method !== 'POST') return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
    if (u.searchParams.get('partner') !== cfg.partnerId) return { status: 404, body: { error: 'Not Found' } };
    if (JSON.stringify(req.body ?? null).length > 16 * 1024) return { status: 413, body: { error: 'BODY_TOO_LARGE' } };
    const sig = verifySignature({ header: req.headers[SIGNATURE_HEADER], body: req.body, secret: cfg.secret, nowSeconds: cfg.nowSeconds ? cfg.nowSeconds() : undefined });
    if (!sig.ok) return { status: 401, body: { error: 'UNAUTHORIZED', reason: sig.reason } };
    const v = validateInbound(req.body);
    if (!v.ok) return { status: 400, body: { error: 'INVALID_BODY', problems: v.problems } };
    const { cmd } = v;
    const fingerprint = `${cmd.referralId}|${cmd.action}|${cmd.input.responseCode || ''}|${cmd.input.outcome || ''}`;
    const prev = store.get(cmd.idempotencyKey);
    if (prev) return prev.fingerprint === fingerprint ? { status: prev.status, body: { ...prev.body, replay: true } } : { status: 409, body: { error: 'IDEMPOTENCY_KEY_REUSED' } };
    const answer = cmd.referralId.startsWith('sandbox-')
      ? { status: 200, body: { ok: true, referral: { id: cmd.referralId, status: /** @type {any} */ (NEXT_STATUS)[cmd.action] }, sandbox: true } }
      : { status: 404, body: { error: 'NOT_FOUND' } };
    store.set(cmd.idempotencyKey, { fingerprint, ...answer });
    return answer;
  };
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string | boolean>} */ const o = {}; /** @type {string[]} */ const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') o['dry-run'] = true;
    else if (a.startsWith('--')) { o[a.slice(2)] = argv[i + 1] ?? ''; i += 1; } else rest.push(a);
  }
  return { o, rest };
}
/** @param {string | undefined} file */
const readJson = (file) => JSON.parse(fs.readFileSync(!file || file === '-' ? 0 : file, 'utf8'));
const out = (/** @type {unknown} */ v) => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}\n`);

/** @param {string[]} argv */
export async function main(argv) {
  const [cmd, ...args] = argv; const { o, rest } = parse(args);
  switch (cmd) {
    case 'vector': {
      const sig = signatureOf(VECTOR.secret, VECTOR.t, VECTOR.body);
      out({ ...VECTOR, computed: sig, header: `t=${VECTOR.t},v1=${sig}`, matches: sig === VECTOR.signature });
      return sig === VECTOR.signature ? 0 : 1;
    }
    case 'sample-event': out(sampleEvent(rest[0] || 'received')); return 0;
    case 'sample-callback': out(sampleCallback(rest[0] || 'accept')); return 0;
    case 'sign': {
      const body = readJson(rest[0]); const t = o.t ? Number(o.t) : Math.floor(Date.now() / 1000);
      out({ canonical: canonicalJson(body), header: `ADA-Signature: ${signHeader(secretFrom(String(o['secret-env'] || '')), body, t)}` });
      return 0;
    }
    case 'verify': {
      const r = verifySignature({ header: String(o.header || ''), body: readJson(rest[0]), secret: secretFrom(String(o['secret-env'] || '')), nowSeconds: o.now ? Number(o.now) : undefined });
      out(r); return r.ok ? 0 : 1;
    }
    case 'validate-callback': { const r = validateInbound(readJson(rest[0])); out(r.ok ? { ok: true } : r); return r.ok ? 0 : 1; }
    case 'send-event': {
      const endpoint = String(o.endpoint || '');
      if (!sandboxEndpoint(endpoint)) throw new Error('--endpoint must be https (or http on 127.0.0.1 / localhost), without credentials or fragment');
      const event = sampleEvent(String(o.type || 'received')); const secret = secretFrom(String(o['secret-env'] || ''));
      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': event.eventId, 'ADA-Contract': PARTNER_CONTRACT, 'ADA-Signature': signHeader(secret, event) };
      if (o['dry-run']) { out({ endpoint: new URL(endpoint).origin, headers: { ...headers, 'ADA-Signature': '(signed)' }, body: event }); return 0; }
      const res = await fetch(endpoint, { method: 'POST', redirect: 'error', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(8000) });
      out({ status: res.status, delivered: res.status >= 200 && res.status < 300, eventId: event.eventId,
        meaning: res.status >= 200 && res.status < 300 ? 'stored (ADA would record PARTNER_EVENT_DELIVERED)' : res.status >= 500 || [408, 425, 429].includes(res.status) ? 'retried by ADA (3 attempts per run, 6 runs)' : 'final refusal (ADA records PARTNER_EVENT_REJECTED, no retry)' });
      return res.status >= 200 && res.status < 300 ? 0 : 1;
    }
    case 'mock-ada': {
      const secret = secretFrom(String(o['secret-env'] || '')); const port = Number(o.port || 8790); const partnerId = String(o.partner || 'sandbox-partner');
      const handle = mockAdaHandler({ partnerId, secret });
      const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
        req.on('end', () => {
          let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = '__invalid_json__'; }
          const r = body === '__invalid_json__' ? { status: 400, body: { error: 'INVALID_JSON' } } : handle({ method: String(req.method), url: String(req.url), headers: req.headers, body });
          res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r.body));
          process.stderr.write(`${new Date().toISOString()} ${req.method} ${String(req.url).split('?')[0]} -> ${r.status}\n`);
        });
      });
      await new Promise((resolve) => { server.listen(port, '127.0.0.1', () => resolve(undefined)); });
      process.stderr.write(`mock ADA listening on http://127.0.0.1:${port}/api/monitor/partner/referral-events?partner=${partnerId} (Ctrl-C to stop)\n`);
      return new Promise(() => {});
    }
    default:
      process.stderr.write('usage: node scripts/partner-bridge-kit.mjs <vector|sample-event|sample-callback|sign|verify|validate-callback|send-event|mock-ada> … (see the header of this file)\n');
      return 2;
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = Number(code) || 0; }, (e) => { process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 2; });
}
