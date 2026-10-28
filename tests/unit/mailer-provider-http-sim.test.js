import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

// Synthetic provider integration: the REAL fetch/serialisation path runs against an in-process loopback server that stands in
// for api.resend.com / api.mailjet.com. Nothing leaves the machine; no real keys or addresses.
let server; let port; const seen = []; let mode = 'ok';
const realFetch = globalThis.fetch;
const MAIL = { to: 'citizen@example.test', subject: 'Sujet é', text: 'Corps du message', category: 'sim' };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
      if (mode === 'drop') { req.socket.destroy(); return; }
      if (mode === 'resend-422') { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"message":"invalid"}'); return; }
      if (req.url.startsWith('/v3.1/send')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Messages: [{ Status: mode === 'mj-error' ? 'error' : 'success', To: [{ MessageID: 1 }] }] })); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"sim"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); seen.length = 0; mode = 'ok'; });

function route() {
  vi.stubGlobal('fetch', (url, init) => {
    const u = new URL(String(url));
    if (!/^api\.(resend\.com|mailjet\.com)$/.test(u.hostname)) throw new Error('unexpected outbound host in test: ' + u.hostname);
    return realFetch(`http://127.0.0.1:${port}${u.pathname}`, init);
  });
}
async function mailer(env) {
  for (const [k, v] of Object.entries({ MAILER_FROM: 'noreply@example.test', ...env })) vi.stubEnv(k, v);
  vi.resetModules(); route();
  return import('../../api/_utils/mailer.js');
}

describe('mailer ↔ synthetic provider (loopback)', () => {
  it('resend: correct request on the wire, delivered on 200', async () => {
    const m = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    expect(await m.sendMail(MAIL)).toMatchObject({ accepted: true, delivered: true, provider: 'resend' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/emails', auth: 'Bearer re_sim_key' });
    expect(seen[0].type).toMatch(/application\/json/);
    expect(JSON.parse(seen[0].body)).toMatchObject({ from: 'noreply@example.test', to: MAIL.to, subject: MAIL.subject, text: MAIL.text });
  });
  it('resend: 422 and dropped connections are undelivered, never thrown', async () => {
    const m = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    mode = 'resend-422'; expect(await m.sendMail(MAIL)).toMatchObject({ accepted: true, delivered: false });
    mode = 'drop'; await expect(m.sendMail(MAIL)).resolves.toMatchObject({ accepted: true, delivered: false });
  });
  it('mailjet: Basic auth + v3.1 payload; delivery follows the per-message Status', async () => {
    const m = await mailer({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_sim:sec_sim' });
    expect(await m.sendMail(MAIL)).toMatchObject({ delivered: true, provider: 'mailjet' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v3.1/send', auth: `Basic ${Buffer.from('pub_sim:sec_sim').toString('base64')}` });
    const msg = JSON.parse(seen[0].body).Messages[0];
    expect(msg).toMatchObject({ From: { Email: 'noreply@example.test' }, To: [{ Email: MAIL.to }], Subject: MAIL.subject, TextPart: MAIL.text, CustomID: 'sim' });
    mode = 'mj-error'; expect(await m.sendMail(MAIL)).toMatchObject({ accepted: true, delivered: false });
  });
  it('N05 (R13): the calendar file reaches both providers (base64 of the UTF-8 bytes, content type with its method) — before R13 only the test outbox kept it', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\nSUMMARY:RDV - Centre « Écrivains »\r\nEND:VCALENDAR\r\n';
    const att = [{ filename: 'acces-direct-aide-rdv-1.ics', contentType: 'text/calendar; method=CANCEL; charset=utf-8', content: ics }];
    const r = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    expect(await r.sendMail({ ...MAIL, attachments: att })).toMatchObject({ delivered: true });
    const sent = JSON.parse(seen[0].body).attachments;
    expect(sent).toEqual([{ filename: att[0].filename, content: Buffer.from(ics, 'utf8').toString('base64'), content_type: att[0].contentType }]);
    expect(Buffer.from(sent[0].content, 'base64').toString('utf8')).toBe(ics);
    const m = await mailer({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_sim:sec_sim' });
    expect(await m.sendMail({ ...MAIL, attachments: att })).toMatchObject({ delivered: true });
    expect(JSON.parse(seen[1].body).Messages[0].Attachments).toEqual([{ ContentType: att[0].contentType, Filename: att[0].filename, Base64Content: Buffer.from(ics, 'utf8').toString('base64') }]);
    // a message without attachment carries no empty attachment field
    await r.sendMail(MAIL); await m.sendMail(MAIL);
    expect(JSON.parse(seen[2].body)).not.toHaveProperty('attachments'); expect(JSON.parse(seen[3].body).Messages[0]).not.toHaveProperty('Attachments');
  });
  it('providers that are not deliverable never reach the network', async () => {
    for (const env of [{ MAILER_PROVIDER: 'noop' }, { MAILER_PROVIDER: 'smtp' }, { MAILER_PROVIDER: 'resend', MAILER_API_KEY: '' }, { MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'nocolon' }]) {
      const m = await mailer(env);
      expect(await m.sendMail(MAIL)).toMatchObject({ delivered: false });
      expect(m.getMailerStatus().deliverable).toBe(false);
    }
    expect(seen).toHaveLength(0);
  });
  it('getMailerStatus: deliverable only for test, keyed resend and keyed mailjet', async () => {
    const check = async (env) => (await mailer(env)).getMailerStatus().deliverable;
    expect(await check({ MAILER_PROVIDER: 'test' })).toBe(true);
    expect(await check({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 'k' })).toBe(true);
    expect(await check({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'a:b' })).toBe(true);
    expect(await check({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'a:b', MAILER_FROM: '' })).toBe(false);
    expect(await check({ MAILER_PROVIDER: '' })).toBe(false);
  });
});
