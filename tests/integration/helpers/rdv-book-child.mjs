// DTA S8 — one INDEPENDENT operating-system process that books through the real citizen handler (api/_handlers/rdv.js) against the real PostgreSQL named by DATABASE_URL.
// Started by tests/integration/rdv-cross-process-db.test.js with `node --import tsx`. All contenders import their modules first, then wait for the same wall-clock instant
// (argv startMs) so the requests really overlap. Prints exactly one line: RESULT {json}. Only synthetic identifiers pass through here.
import { buildUserSessionCookie, signUserSessionToken } from '../../../api/_utils/user-auth.js';

const spec = JSON.parse(process.argv[2]);

const { default: handler } = await import('../../../api/_handlers/rdv.js');

const res = {
  statusCode: 200, headers: {}, body: null,
  status(c) { this.statusCode = c; return this; },
  json(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; },
  writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
  end(d) { if (d !== undefined) this.body = d; return this; },
};
const cookie = buildUserSessionCookie(signUserSessionToken({ userId: spec.userId, email: spec.email })).split(';')[0];

while (Date.now() < spec.startMs) { /* barrier: all contenders leave together */ }
const startedAt = Date.now();
let error = null;
try {
  await handler({
    method: 'POST', url: '/api/rdv/appointments', query: {},
    body: { structureSlug: spec.slug, serviceId: spec.serviceId, startAt: spec.startAt, idempotencyKey: spec.idempotencyKey },
    headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie },
  }, res);
} catch (e) {
  error = String(e && e.message).slice(0, 200);
}
const body = res.body && typeof res.body === 'object' ? { id: res.body.id || null, status: res.body.status || null, error: res.body.error || null } : null;
process.stdout.write('RESULT ' + JSON.stringify({ pid: process.pid, label: spec.label, status: res.statusCode, body, thrown: error, startedAt, endedAt: Date.now() }) + '\n');
process.exit(0);
