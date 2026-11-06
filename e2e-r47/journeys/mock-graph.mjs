#!/usr/bin/env node
/**
 * R47 journeys — LOCAL mock of the two external Microsoft endpoints the Outlook free/busy integration calls (B10), loopback only, never Microsoft:
 *   authority  GET  /oauth2/v2.0/authorize   → 302 back to redirect_uri with a one-use code and the same state
 *              POST /oauth2/v2.0/token        → synthetic access/refresh tokens (authorization_code and refresh_token grants; client id/secret checked)
 *   Graph      POST /v1.0/me/calendar/getSchedule → availabilityView (15 min) built from the busy windows set by the test
 *   control    POST /__busy {windows:[{start,end}]} · GET /__calls (counts only)
 * Env: MOCK_GRAPH_PORT (default 5292; never 3000), MOCK_GRAPH_CLIENT_ID, MOCK_GRAPH_CLIENT_SECRET.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_GRAPH_PORT || 5292);
if (PORT === 3000) throw new Error('port 3000 is the owner LAB');
const CLIENT_ID = process.env.MOCK_GRAPH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MOCK_GRAPH_CLIENT_SECRET || '';
const codes = new Set(); const tokens = new Set();
/** @type {{ start: number, end: number }[]} */ let busy = [];
const calls = { authorize: 0, token: 0, getSchedule: 0 };
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString('utf8'); };
const json = (res, status, d) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };

http.createServer(async (req, res) => {
  const u = new URL(String(req.url), `http://127.0.0.1:${PORT}`);
  if (req.method === 'POST' && u.pathname === '/__busy') {
    const d = JSON.parse((await body(req)) || '{}');
    busy = (d.windows || []).map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }));
    return json(res, 200, { ok: true, windows: busy.length });
  }
  if (u.pathname === '/__calls') return json(res, 200, calls);
  if (req.method === 'GET' && u.pathname === '/oauth2/v2.0/authorize') {
    calls.authorize += 1;
    if (u.searchParams.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'invalid_client' });
    const code = crypto.randomBytes(16).toString('hex'); codes.add(code);
    const back = new URL(String(u.searchParams.get('redirect_uri')));
    back.searchParams.set('code', code); back.searchParams.set('state', String(u.searchParams.get('state') || ''));
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (req.method === 'POST' && u.pathname === '/oauth2/v2.0/token') {
    calls.token += 1;
    const f = new URLSearchParams(await body(req));
    if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET) return json(res, 401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code' && !codes.delete(String(f.get('code')))) return json(res, 400, { error: 'invalid_grant' });
    const access = `mock-access-${crypto.randomBytes(12).toString('hex')}`; tokens.add(access);
    return json(res, 200, { token_type: 'Bearer', access_token: access, refresh_token: `mock-refresh-${crypto.randomBytes(12).toString('hex')}`, expires_in: 3600, scope: 'Calendars.ReadBasic' });
  }
  if (req.method === 'POST' && u.pathname === '/v1.0/me/calendar/getSchedule') {
    calls.getSchedule += 1;
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!tokens.has(auth)) return json(res, 401, { error: { code: 'InvalidAuthenticationToken' } });
    const d = JSON.parse((await body(req)) || '{}');
    const from = Date.parse(`${d.startTime?.dateTime}Z`); const to = Date.parse(`${d.endTime?.dateTime}Z`);
    const step = (Number(d.availabilityViewInterval) || 15) * 60_000;
    let view = '';
    for (let t = from; t < to; t += step) view += busy.some((w) => w.start < t + step && w.end > t) ? '2' : '0';
    return json(res, 200, { value: [{ scheduleId: (d.schedules || [])[0] || 'me', availabilityView: view, scheduleItems: [] }] });
  }
  json(res, 404, { error: 'not_found' });
}).listen(PORT, '127.0.0.1', () => console.log(`R47 mock Microsoft authority + Graph http://127.0.0.1:${PORT}`));
