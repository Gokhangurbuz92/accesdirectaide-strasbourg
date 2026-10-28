/**
 * PKG-1 — OpenFisca integration PROTOCOL CONFORMANCE against a LOOPBACK FAKE engine.
 *
 * What this proves: POST /api/diagnostic in AUTHORITATIVE_MODE really probes GET /spec, sends a well-formed OpenFisca test case to POST /calculate (individus / familles / menages /
 * foyers_fiscaux, birth date, income, children, no personal identifiers), maps the engine's per-period values back into the rights list, and FAILS CLOSED (503, never a local
 * estimate) when the engine is down, erroring or returns garbage.
 * R15 (normative change, owner directive 27/10/2026 § 4): the response no longer carries the raw `rights` list (exact amounts, « eligible » flags). It carries
 * `estimates` (ADA_OPENFISCA_ESTIMATE_V1): an order of magnitude only for a right whose inputs the form gave, INSUFFICIENT_INFORMATION with the missing inputs
 * otherwise (api/lib/openfiscaEstimate.js). The request side of this test is unchanged.
 * What this does NOT prove: the legal or numerical accuracy of any benefit. The fake engine returns amounts we chose. A real openfisca-france instance and a legal review of the
 * rights catalogue remain external dependencies (EXTERNAL track).
 * No real engine, no live endpoint, no network beyond 127.0.0.1.
 */
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => {
  const chain = { returning: async () => [{ id: 'run-1' }], where: async () => [] };
  return { db: { insert: () => ({ values: () => chain }), update: () => ({ set: () => chain }), query: {} } };
});
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

/** Fake engine: records what it receives and answers per `behaviour`. */
function startFake(behaviour = {}) {
  const seen = { spec: 0, calculate: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/spec') { seen.spec++; res.writeHead(behaviour.spec ?? 200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/calculate') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = null; try { body = JSON.parse(raw); } catch { /* recorded as null */ }
        seen.calculate.push(body);
        if (behaviour.calculate) return behaviour.calculate(body, res);
        const period = Object.keys(body?.individus?.ind_1?.salaire_net || {})[0];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ familles: { fam_1: { rsa: { [period]: 512.4 }, ppa: { [period]: 0 }, af: { [period]: 131.09 } } } }));
      });
      return undefined;
    }
    res.writeHead(404); return res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const ANSWERS = { birthDate: '1990-05-17', statut: 'chomeur', income: { salary: 0, unemployment: 900 }, housing: { rent: 450, charges: 40 }, situation_familiale: 'seul', nombre_enfants: 2, enfants: [{ birthDate: '2015-03-01' }, { birthDate: '2019-09-09' }] };

describe('OpenFisca protocol conformance (loopback fake engine; NOT legal accuracy)', () => {
  let fake;
  const prev = { url: process.env.OPENFISCA_URL, api: process.env.OPENFISCA_API_URL };
  const run = async (body) => {
    vi.resetModules();   // the client reads OPENFISCA_URL at import and caches health for 60 s
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const res = mk();
    await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'localhost' }, body }, res);
    return res;
  };
  beforeEach(() => { delete process.env.OPENFISCA_API_URL; });
  afterEach(async () => {
    if (fake) await new Promise((r) => fake.server.close(r));
    fake = null;
    if (prev.url === undefined) delete process.env.OPENFISCA_URL; else process.env.OPENFISCA_URL = prev.url;
    if (prev.api !== undefined) process.env.OPENFISCA_API_URL = prev.api;
  });

  it('happy path: /spec probe, well-formed /calculate request, engine values mapped into the rights list', async () => {
    fake = await startFake();
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: ANSWERS, mode: 'AUTHORITATIVE_MODE' });
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(fake.seen.spec).toBe(1);
    expect(fake.seen.calculate).toHaveLength(1);
    const sent = fake.seen.calculate[0];
    for (const key of ['individus', 'familles', 'menages', 'foyers_fiscaux']) expect(sent, key).toHaveProperty(key);
    expect(sent.individus.ind_1.date_naissance).toEqual({ ETERNITY: '1990-05-17' });
    expect(Object.keys(sent.individus).length).toBe(3);   // one adult + two children
    expect(res.body.meta.source).toBe('openfisca');
    expect(res.body.rights).toBeUndefined();
    expect(res.body).toMatchObject({ authoritative: false, estimates: { contract: 'ADA_OPENFISCA_ESTIMATE_V1', authoritative: false } });
    const by = Object.fromEntries(res.body.estimates.items.map((r) => [r.code, r]));
    // « chomeur » is not a value of the form (it would be computed as « inactif ») and the children's dates are under a key buildTestCase does not read: the
    // engine's 512.4 € RSA is a computation on defaults, so nothing is shown and the gaps are named
    expect(by.rsa).toMatchObject({ status: 'INSUFFICIENT_INFORMATION', monthlyOrderOfMagnitude: null });
    expect(by.rsa.missing.map((m) => m.key)).toEqual(expect.arrayContaining(['statut', 'household']));
    expect(JSON.stringify(res.body)).not.toMatch(/512|131\.09|"eligible"|"amount"/);
  });

  it('R15: a one-person household fully described gets an order of magnitude for RSA, nothing invented for the rights the form cannot describe', async () => {
    fake = await startFake();
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: { birthDate: '1990-05-17', statut: 'sans_emploi', householdSize: 1, income: { salary: 0, unemployment: 900 }, housing: { status: 'tenant', rent: 450, charges: 40 }, depcom: '67482' }, mode: 'AUTHORITATIVE_MODE' });
    expect(res.statusCode).toBe(200);
    const by = Object.fromEntries(res.body.estimates.items.map((r) => [r.code, r]));
    expect(by.rsa).toMatchObject({ status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: 510 });
    expect(by.prime_activite).toMatchObject({ status: 'NOT_INDICATED_UNDER_ASSUMPTIONS', monthlyOrderOfMagnitude: null });
    expect(by.apl.status).toBe('NOT_INDICATED_UNDER_ASSUMPTIONS');   // the engine returned nothing for it: never invented
    for (const code of ['aspa', 'aah', 'ass', 'asf', 'bourse_college']) expect(by[code].status, code).toBe('INSUFFICIENT_INFORMATION');
    expect(res.body.estimates.assumptions.length).toBeGreaterThan(0);
    expect(res.body.estimates.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('privacy: the request to the engine carries no identifiers beyond the household facts', async () => {
    fake = await startFake();
    process.env.OPENFISCA_URL = fake.url;
    await run({ answers: { ...ANSWERS, email: 'someone@example.test', nom: 'Dupont', prenom: 'Marie', phone: '0612345678' }, mode: 'AUTHORITATIVE_MODE' });
    const wire = JSON.stringify(fake.seen.calculate[0]);
    expect(wire).not.toMatch(/someone@example|Dupont|Marie|0612345678/);
  });

  it('fail-closed: engine down → 503 OPENFISCA_UNAVAILABLE and no local estimate', async () => {
    fake = await startFake();
    process.env.OPENFISCA_URL = fake.url;
    await new Promise((r) => fake.server.close(r));   // port now refuses connections
    const res = await run({ answers: ANSWERS, mode: 'AUTHORITATIVE_MODE' });
    fake = null;
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('OPENFISCA_UNAVAILABLE');
    expect(res.body).not.toHaveProperty('rights');
  });

  it('fail-closed: /spec unhealthy → 503 and /calculate is never called', async () => {
    fake = await startFake({ spec: 500 });
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: ANSWERS });   // no mode = authoritative
    expect(res.statusCode).toBe(503);
    expect(fake.seen.calculate).toHaveLength(0);
  });

  it('fail-closed: /calculate answers 500 → 503, never a partial result', async () => {
    fake = await startFake({ calculate: (_b, res) => { res.writeHead(500); res.end('boom'); } });
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: ANSWERS, mode: 'AUTHORITATIVE_MODE' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toHaveProperty('rights');
    expect(JSON.stringify(res.body)).not.toMatch(/boom/);   // upstream text is never forwarded
  });

  it('a malformed engine answer yields no eligibility (values default to 0), not a crash', async () => {
    fake = await startFake({ calculate: (_b, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"unexpected":true}'); } });
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: ANSWERS, mode: 'AUTHORITATIVE_MODE' });
    expect(res.statusCode).toBe(200);
    expect(res.body.estimates.items.every((r) => r.status !== 'INDICATIVE_ESTIMATE' && r.monthlyOrderOfMagnitude === null)).toBe(true);
  });

  it('input validation happens before the engine is contacted', async () => {
    fake = await startFake();
    process.env.OPENFISCA_URL = fake.url;
    const res = await run({ answers: { income: { salary: -5 } }, mode: 'AUTHORITATIVE_MODE' });
    expect(res.statusCode).toBe(400);
    expect(fake.seen.spec).toBe(0);
    expect(fake.seen.calculate).toHaveLength(0);
  });
});
