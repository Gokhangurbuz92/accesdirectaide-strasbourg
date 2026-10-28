/**
 * PKG-6 / D21 — PII-safe observability measured on the REAL sink: a child process runs the application's own pino logger and the citizen assistant handler
 * (local model and database unreachable: no network, no data) and writes to its real stdout / stderr; the test reads what was actually emitted.
 * Synthetic identifiers only (test card 4111…, a format-valid NIR / IBAN that belong to no one).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PII = { nir: '1 85 05 67 482 123 45', nirCompact: '185056748212345', iban: 'FR76 3000 6000 0112 3456 7890 189', card: '4111 1111 1111 1111', mail: 'jeanne.qa@example.test', tel: '06 12 34 56 78' };
const SCRIPT = `
const PII = ${JSON.stringify(PII)};
const { default: logger } = await import('./api/_utils/logger.js');
logger.info({ msg: 'sink.object', note: 'NIR ' + PII.nir + ' IBAN ' + PII.iban + ' carte ' + PII.card + ' mail ' + PII.mail + ' tel ' + PII.tel, q: 'mon nir ' + PII.nirCompact });
logger.info('sink.string NIR ' + PII.nir + ' IBAN ' + PII.iban + ' mail ' + PII.mail + ' carte ' + PII.card);
logger.warn({ err: new Error('fail for ' + PII.mail + ' NIR ' + PII.nir) }, 'sink.error ' + PII.tel);
const { default: chat } = await import('./api/_handlers/assistant/chat.js');
const res = () => ({ statusCode: 200, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
for (const message of ['Je suis à Strasbourg, mon mail est ' + PII.mail + ' et mon téléphone ' + PII.tel + ', quelles aides ?', 'Mon numéro de sécu est ' + PII.nir, 'IBAN ' + PII.iban + ' carte ' + PII.card]) {
  const r = res(); await chat({ method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' }, body: { message, context: { territory: '67482' } } }, r);
  console.log('CHAT_STATUS', r.statusCode, r.body && (r.body.error || r.body.meta?.reason || 'ok'));
}
await new Promise((r) => setTimeout(r, 200));
process.exit(0);
`;

describe('PKG-6 / D21 observability on the real sink (child process stdout / stderr)', () => {
  it('logs and the citizen assistant never emit a NIR, IBAN, card number, e-mail or phone in clear', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', SCRIPT], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'debug', OLLAMA_BASE_URL: 'http://127.0.0.1:9', DATABASE_URL: 'postgresql://nobody@127.0.0.1:9/none', SENTRY_DSN: '', VITE_SENTRY_DSN: '' },
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.status, out.slice(-2000)).toBe(0);
    expect(out).toContain('sink.object'); expect(out).toContain('sink.string'); expect(out).toContain('sink.error');
    expect(out.match(/CHAT_STATUS/g)?.length).toBe(3);   // the handler really ran three times
    for (const [k, v] of Object.entries(PII)) {
      expect(out.includes(v), `${k} reached the sink in clear`).toBe(false);
      expect(out.includes(v.replace(/\s/g, '')), `${k} (compact) reached the sink in clear`).toBe(false);
    }
    expect(out).toContain('[NIR]'); expect(out).toContain('[IBAN]'); expect(out).toContain('[CARTE]'); expect(out).toContain('j***@example.test');
  });
});
