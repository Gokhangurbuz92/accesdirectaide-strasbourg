/**
 * Q11 — SIMULATION ONLY: a local, in-memory store speaking the subset of the Upstash Redis REST protocol the product uses (@vercel/kv and @upstash/ratelimit,
 * both on @upstash/redis): GET / SET (EX, PX, NX, XX) / DEL / INCR / INCRBY / EXPIRE / PEXPIRE / TTL / PTTL / EXISTS / MGET / PING, EVAL / EVALSHA of the
 * sliding-window scripts of @upstash/ratelimit (recognised by their text, run as the same arithmetic in JavaScript), single commands, /pipeline and
 * /multi-exec, the « Upstash-Encoding: base64 » responses. It lets several local API instances share ONE store, as several serverless instances share one
 * Upstash database — it is NOT Upstash and NOT Vercel, and nothing measured with it is a measurement of either (scripts/q11-multi-instance.mjs labels it so).
 * HTTPS on 127.0.0.1 only (the rate limiter requires an https:// address), with a self-signed certificate made for the run.
 */
import https from 'node:https';
import crypto from 'node:crypto';

export function createFakeUpstash({ key, cert, token }) {
  const data = new Map();   // key -> { v: string, exp: number | null }
  const scripts = new Map(); // sha1 -> kind
  const stats = { commands: 0, byCommand: {} };
  let down = false;
  const now = () => Date.now();
  const live = (k) => { const e = data.get(k); if (!e) return null; if (e.exp !== null && e.exp <= now()) { data.delete(k); return null; } return e; };
  const str = (x) => (x === null || x === undefined ? null : String(x));
  const kindOf = (s) => (/requestsInPreviousWindow/.test(s) && /INCRBY/.test(s) && /return \{-1, effectiveLimit\}/.test(s) ? 'SLIDING_LIMIT'
    : /requestsInPreviousWindow/.test(s) && !/INCRBY/.test(s) ? 'SLIDING_REMAINING' : null);
  const incrBy = (k, n) => { const e = live(k); const v = (e ? Number(e.v) : 0) + n; data.set(k, { v: String(v), exp: e ? e.exp : null }); return v; };
  function runScript(kind, keys, args) {
    if (kind === 'SLIDING_LIMIT') {
      const [currentKey, previousKey, dynamicKey] = keys; const tokens = Number(args[0]); const t = Number(args[1]); const window = Number(args[2]); const incrementBy = Number(args[3]);
      let limit = tokens; if (dynamicKey) { const d = live(dynamicKey); if (d) limit = Number(d.v); }
      const cur = Number(live(currentKey)?.v || 0); let prev = Number(live(previousKey)?.v || 0);
      prev = Math.floor((1 - (t % window) / window) * prev);
      if (incrementBy > 0 && prev + cur >= limit) return [-1, limit];
      const nv = incrBy(currentKey, incrementBy);
      if (nv === incrementBy) data.get(currentKey).exp = now() + window * 2 + 1000;
      return [limit - (nv + prev), limit];
    }
    if (kind === 'SLIDING_REMAINING') {
      const [currentKey, previousKey, dynamicKey] = keys; const tokens = Number(args[0]); const t = Number(args[1]); const window = Number(args[2]);
      let limit = tokens; if (dynamicKey) { const d = live(dynamicKey); if (d) limit = Number(d.v); }
      const cur = Number(live(currentKey)?.v || 0); let prev = Number(live(previousKey)?.v || 0);
      prev = Math.floor((1 - (t % window) / window) * prev);
      return [limit - (cur + prev), limit];
    }
    throw new Error('ERR script not supported by the simulation');
  }
  function exec(cmd) {
    const [name, ...a] = cmd; const c = String(name).toUpperCase();
    stats.commands += 1; stats.byCommand[c] = (stats.byCommand[c] || 0) + 1;
    switch (c) {
      case 'PING': return 'PONG';
      case 'GET': return live(a[0])?.v ?? null;
      case 'MGET': return a.map((k) => live(k)?.v ?? null);
      case 'EXISTS': return a.filter((k) => live(k)).length;
      case 'SET': {
        const [k, v, ...o] = a; const opts = o.map((x) => String(x).toUpperCase()); let exp = null;
        for (let i = 0; i < o.length; i += 1) { if (opts[i] === 'EX') exp = now() + Number(o[i + 1]) * 1000; if (opts[i] === 'PX') exp = now() + Number(o[i + 1]); }
        if (opts.includes('NX') && live(k)) return null;
        if (opts.includes('XX') && !live(k)) return null;
        const old = live(k)?.v ?? null;
        data.set(k, { v: str(v), exp: opts.includes('KEEPTTL') ? (live(k)?.exp ?? null) : exp });
        return opts.includes('GET') ? old : 'OK';
      }
      case 'DEL': return a.reduce((n, k) => n + (live(k) && data.delete(k) ? 1 : 0), 0);
      case 'INCR': return incrBy(a[0], 1);
      case 'INCRBY': return incrBy(a[0], Number(a[1]));
      case 'EXPIRE': { const e = live(a[0]); if (!e) return 0; e.exp = now() + Number(a[1]) * 1000; return 1; }
      case 'PEXPIRE': { const e = live(a[0]); if (!e) return 0; e.exp = now() + Number(a[1]); return 1; }
      case 'TTL': { const e = live(a[0]); if (!e) return -2; return e.exp === null ? -1 : Math.ceil((e.exp - now()) / 1000); }
      case 'PTTL': { const e = live(a[0]); if (!e) return -2; return e.exp === null ? -1 : e.exp - now(); }
      case 'SCRIPT': { if (String(a[0]).toUpperCase() !== 'LOAD') throw new Error('ERR unsupported SCRIPT subcommand'); const sha = crypto.createHash('sha1').update(String(a[1])).digest('hex'); scripts.set(sha, kindOf(String(a[1]))); return sha; }
      case 'EVAL': case 'EVALSHA': {
        const n = Number(a[1]); const keys = a.slice(2, 2 + n).map(String); const args = a.slice(2 + n).map((x) => (x === null ? '' : String(x)));
        let kind;
        if (c === 'EVAL') { kind = kindOf(String(a[0])); scripts.set(crypto.createHash('sha1').update(String(a[0])).digest('hex'), kind); }
        else { if (!scripts.has(String(a[0]))) throw new Error('NOSCRIPT No matching script. Please use EVAL.'); kind = scripts.get(String(a[0])); }
        return runScript(kind, keys, args);
      }
      default: throw new Error(`ERR unknown command '${c}' (simulation)`);
    }
  }
  const b64 = (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8').toString('base64') : Array.isArray(x) ? x.map(b64) : x);
  const server = https.createServer({ key, cert }, async (req, res) => {
    const chunks = []; for await (const ch of req) chunks.push(ch);
    if (down) { req.socket.destroy(); return; }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'ERR bad json' })); }
    const enc = String(req.headers['upstash-encoding'] || '').toLowerCase() === 'base64';
    const one = (cmd) => { try { const r = exec(cmd); return { result: enc ? b64(r) : r }; } catch (e) { return { error: String(e.message) }; } };
    const url = String(req.url || '/').split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (url === '/pipeline' || url === '/multi-exec') { res.writeHead(200); return res.end(JSON.stringify(body.map(one))); }
    const r = one(body);
    res.writeHead(r.error ? 400 : 200); return res.end(JSON.stringify(r));
  });
  return { server, data, stats, setDown: (v) => { down = Boolean(v); }, isDown: () => down };
}
