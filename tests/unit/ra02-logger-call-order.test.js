/**
 * RA-02 — the two project loggers accept both call orders and lose nothing.
 *  - api/_utils/logger.js (pino, `(object, message)`): pino drops what follows a message without a placeholder, so `logger.error('CRASH:', err)` — the
 *    form used by the byte-pinned api/index.js and ~45 other files — printed the sentence alone. The wrapper rewrites the call before redaction.
 *  - api/lib/logger.js (`(message, data)`): called pino-style it printed « [WARN] [object Object] ».
 * Measured on the REAL sink (a child process's stdout / stderr), with synthetic identifiers: what is merged is redacted like an object-first call.
 * A ratchet over api/ keeps the number of non-canonical call sites from growing.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';
import { normalizeLogArgs, normalizeMessageData } from '../../api/_utils/log-args.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PII = { nir: '1 85 05 67 482 123 45', iban: 'FR76 3000 6000 0112 3456 7890 189', card: '4111 1111 1111 1111', mail: 'jeanne.qa@example.test', tel: '06 12 34 56 78', secret: 'synthetic-secret-value-ra02' };

const run = (script) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', LOG_LEVEL: 'debug', SENTRY_DSN: '', TZ: 'UTC' } });
  expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-2000)).toBe(0);
  return `${r.stdout}\n${r.stderr}`;
};
const noPii = (out) => { for (const [k, v] of Object.entries(PII)) { expect(out.includes(v), `${k} reached the sink in clear`).toBe(false); expect(out.includes(v.replace(/\s/g, '')), `${k} (compact) in clear`).toBe(false); } };
const line = (out, marker) => { const l = out.split('\n').find((x) => x.includes(marker)); expect(l, `no line « ${marker} »`).toBeTruthy(); return l; };

describe('RA-02 pino logger (api/_utils/logger.js) on the real sink', () => {
  const out = run(`
    const PII = ${JSON.stringify(PII)};
    const { default: logger } = await import('./api/_utils/logger.js');
    const boom = new Error('boom for ' + PII.mail + ' NIR ' + PII.nir);
    logger.error('m1 CRITICAL HANDLER CRASH:', boom);
    logger.info('m2 purge complete:', { status: 'partial', failed_steps: ['stepA'], note: 'tel ' + PII.tel + ' IBAN ' + PII.iban, email: PII.mail, password: PII.secret, token: PII.secret, body: 'carte ' + PII.card });
    logger.info({ status: 'partial', failed_steps: ['stepA'], email: PII.mail, password: PII.secret, token: PII.secret }, 'm3 canonical');
    logger.error('m4 item error:', 'reason for ' + PII.mail);
    logger.warn('m5 two', { a: 1 }, new Error('second'), 7);
    logger.info('m6 printf %s and %d', 'kept', 42);
    logger.info('m7 printf object %j', { email: PII.mail, token: PII.secret, n: 3 });
    logger.info('m8 alone');
    logger.error('m9 nothing', undefined);
    logger.info('m10 nested', { err: new Error('inner ' + PII.card), list: [{ authorization: PII.secret, q: PII.mail }] });
    await new Promise((r) => setTimeout(r, 100));
  `);
  const json = (marker) => JSON.parse(line(out, marker));

  it('(message, Error): the error is kept under « err » — name, masked message, stack', () => {
    const j = json('m1 CRITICAL');
    expect(j.msg).toBe('m1 CRITICAL HANDLER CRASH:');
    expect(j.err).toMatchObject({ name: 'Error' });
    expect(j.err.message).toContain('boom for j***@example.test'); expect(j.err.message).toContain('[NIR]');
    expect(j.err.stack).toMatch(/at /);
  });
  it('(message, object): the fields are merged and redacted exactly like the canonical order', () => {
    const j = json('m2 purge'); const c = json('m3 canonical');
    expect(j).toMatchObject({ msg: 'm2 purge complete:', status: 'partial', failed_steps: ['stepA'], body: '[REDACTED_BODY]' });
    for (const k of ['password', 'token', 'email']) expect(j[k], k).toBe(c[k] ?? '[MASQUÉ - RGPD]');   // pino's own censor on top of the masking
    expect(j.note).toContain('[IBAN]'); expect(j.note).not.toContain('06 12');
    expect(j.email).toBe(c.email);                                           // the same masking path as an object-first call
    expect(j.email).not.toContain('jeanne');
  });
  it('(message, string) and mixed trailing arguments: nothing is dropped', () => {
    expect(json('m4 item').msg).toBe('m4 item error: reason for j***@example.test');
    const j = json('m5 two'); expect(j).toMatchObject({ msg: 'm5 two 7', a: 1 }); expect(j.err.message).toBe('second');
    expect(json('m9 nothing').msg).toBe('m9 nothing');
    expect(json('m8 alone').msg).toBe('m8 alone');
  });
  it('printf-style messages are still formatted by pino, their arguments redacted', () => {
    expect(json('m6 printf').msg).toBe('m6 printf kept and 42');
    const j = json('m7 printf'); expect(j.msg).toContain('"n":3'); expect(j.msg).not.toContain('jeanne'); expect(j.msg).toMatch(/"token":"\[(REDACTED|MASQUÉ - RGPD)\]"/);
  });
  it('nested errors and arrays in a merged object are redacted', () => {
    const j = json('m10 nested');
    expect(j.err.message).toBe('inner [CARTE]'); expect(j.list[0]).toMatchObject({ authorization: '[REDACTED]', q: 'j***@example.test' });
  });
  it('no synthetic identifier or secret reaches the sink; no « [object Object] »', () => { noPii(out); expect(out).not.toContain('[object Object]'); });
});

describe('RA-02 console logger (api/lib/logger.js) on the real sink', () => {
  const out = run(`
    const PII = ${JSON.stringify(PII)};
    const { logger } = await import('./api/lib/logger.js');
    logger.warn({ runId: 'run-1', email: PII.mail, token: PII.secret }, 'k1 already running, skipping');
    logger.warn('k2 canonical', { runId: 'run-2', email: PII.mail });
    logger.info({ runId: 'run-3', msg: 'k3 own message' });
    logger.error({ err: new Error('k4 inner ' + PII.mail), step: 's1' }, 'k4 failed');
    logger.error('k5 failed', new Error('k5 reason ' + PII.tel));
    logger.error(new Error('k6 bare ' + PII.mail));
    logger.info('k7 message with ' + PII.mail);
    logger.debug({ a: 1 }, { b: 2 });
    logger.info('k9 alone');
  `);
  const block = (marker) => { const i = out.indexOf(marker); expect(i, marker).toBeGreaterThan(-1); const next = out.slice(i + 1).search(/\n\[(INFO|WARN|ERROR|DEBUG)\]/); return out.slice(i, next === -1 ? undefined : i + 1 + next); };

  it('(object, message): the message is the string, the object is the data', () => {
    expect(line(out, 'k1 already')).toMatch(/^\[WARN\] k1 already running, skipping/);
    const b = block('k1 already'); expect(b).toContain('"runId": "run-1"'); expect(b).toContain('j***@example.test'); expect(b).toContain('"token": "[REDACTED]"');
    expect(block('k2 canonical')).toContain('"runId": "run-2"');
    expect(line(out, 'k3 own')).toMatch(/^\[INFO\] k3 own message/);
  });
  it('errors keep their reason in either order, nested or bare', () => {
    expect(line(out, 'k4 failed')).toMatch(/^\[ERROR\] k4 failed/);
    expect(block('k4 failed')).toContain('k4 inner j***@example.test'); expect(block('k4 failed')).toContain('"step": "s1"');
    expect(block('k5 failed')).toContain('k5 reason 06******78');
    expect(out).toContain('k6 bare j***@example.test');
  });
  it('no identifier, no secret, never « [object Object] »', () => { noPii(out); expect(out).not.toContain('[object Object]'); expect(out).toContain('"a": 1'); expect(out).toContain('"b": 2'); expect(out).toContain('[INFO] k9 alone'); });
});

describe('RA-02 normalisers (pure)', () => {
  it('pino arguments', () => {
    const e = new Error('x');
    expect(normalizeLogArgs(['m', e])).toEqual([{ err: e }, 'm']);
    expect(normalizeLogArgs(['m', { a: 1 }, { a: 2 }])).toEqual([{ a: 1, a2: 2 }, 'm']);
    expect(normalizeLogArgs(['m', [1, 2]])).toEqual([{ data: [1, 2] }, 'm']);
    expect(normalizeLogArgs(['m', null, undefined])).toEqual(['m']);
    const canonical = [{ a: 1 }, 'm']; expect(normalizeLogArgs(canonical)).toBe(canonical);
    const printf = ['m %s', 'x']; expect(normalizeLogArgs(printf)).toBe(printf);
    expect(normalizeLogArgs(['100% done', { a: 1 }])).toEqual([{ a: 1 }, '100% done']);
  });
  it('(message, data) arguments', () => {
    expect(normalizeMessageData('m', { a: 1 })).toEqual({ message: 'm', data: { a: 1 } });
    expect(normalizeMessageData({ a: 1 }, 'm')).toEqual({ message: 'm', data: { a: 1 } });
    expect(normalizeMessageData({ a: 1 })).toEqual({ message: '', data: { a: 1 } });
    expect(normalizeMessageData('m')).toEqual({ message: 'm', data: null });
    expect(normalizeMessageData(undefined, 3)).toEqual({ message: '', data: 3 });
  });
});

describe('RA-02 ratchet: call sites in api/', () => {
  const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(p); } })(path.join(ROOT, 'api'));
  const found = { stringFirstOnPino: [], objectFirstOnConsole: [], rawPino: [] };
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8'); const rel = path.relative(ROOT, f);
    if (/from\s+['"]pino['"]|require\(['"]pino['"]\)/.test(src) && rel !== 'api/_utils/logger.js') found.rawPino.push(rel);
    const names = new Map();   // local identifier → 'pino' | 'console'
    for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+['"]([^'"]*\/logger\.js)['"]/g)) {
      const kind = /lib\/logger\.js$/.test(m[2]) || (m[2] === './logger.js' && rel.startsWith('api/lib/')) ? 'console' : 'pino';
      const def = m[1].match(/^(\w+)/); if (def) names.set(def[1], kind);
      const named = m[1].match(/\{([^}]*)\}/); if (named) for (const part of named[1].split(',')) { const [orig, alias] = part.trim().split(/\s+as\s+/); if (orig === 'logger') names.set((alias || orig).trim(), kind); }
    }
    if (!names.size) continue;
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
    (function visit(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && names.has(n.callee.object.name) && LEVELS.has(n.callee.property.name)) {
        const a = n.arguments; const kind = names.get(n.callee.object.name);
        const stringFirst = a[0] && (a[0].type === 'TemplateLiteral' || (a[0].type === 'Literal' && typeof a[0].value === 'string') || a[0].type === 'BinaryExpression');
        const printf = a[0] && a[0].type === 'Literal' && /%[sdoOjif]/.test(String(a[0].value));
        if (kind === 'pino' && stringFirst && a.length > 1 && !printf) found.stringFirstOnPino.push(`${rel}:${n.loc.start.line}`);
        if (kind === 'console' && a[0] && a[0].type === 'ObjectExpression') found.objectFirstOnConsole.push(`${rel}:${n.loc.start.line}`);
      }
      for (const k in n) { if (k === 'loc') continue; const c = n[k]; if (Array.isArray(c)) c.forEach(visit); else if (c && typeof c === 'object') visit(c); }
    })(ast);
  }

  it('only api/_utils/logger.js builds a pino instance (every other file goes through the wrapper)', () => { expect(found.rawPino).toEqual([]); });
  it('the scheduled jobs log in the canonical order', () => {
    expect(found.stringFirstOnPino.filter((x) => x.startsWith('api/_handlers/cron/'))).toEqual([]);
    expect(found.objectFirstOnConsole.filter((x) => x.startsWith('api/_handlers/cron/'))).toEqual([]);
  });
  it('the byte-pinned entry still uses the string-first form the wrapper exists for', () => {
    expect(found.stringFirstOnPino.filter((x) => x.startsWith('api/index.js:')).length).toBeGreaterThan(0);
  });
  it('non-canonical call sites do not grow (new code: logger.info({ fields }, "message") with api/_utils/logger.js)', () => {
    // 0645b6e had 96 string-first calls on the pino logger in api/ and 3 object-first calls on the console logger; the cron handlers were corrected with RA-02, five went with the dead handlers of RA-11.
    expect(found.stringFirstOnPino.length, found.stringFirstOnPino.join('\n')).toBeLessThanOrEqual(STRING_FIRST_CEILING);
    expect(found.objectFirstOnConsole, 'api/_services/referrals.js is owned by another package; the wrapper makes its call safe').toEqual(found.objectFirstOnConsole.filter((x) => x.startsWith('api/_services/referrals.js:')));
  });
});
const STRING_FIRST_CEILING = 80;
