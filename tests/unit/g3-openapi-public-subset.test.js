/**
 * G3 (19/11/2026) — /api/docs/openapi.json served the FULL spec (≈25 admin / cron / monitor paths, the pro and institution spaces, closed routes) to
 * whoever could reach it. It is closed in the beta (not in the allow-list: owner decision, unchanged here). When the beta is on and the route is ever
 * allowed, the handler serves a PUBLIC subset: only the operations the beta gate opens to an anonymous visitor in this environment, never an
 * admin / cron / monitor / pro / institution path, never an operation that declares a security requirement; only the schemas, tags and security
 * schemes it still references. Outside the beta the full spec is served as before.
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOpenApiSpec } from '../../api/lib/openapi-public.js';
import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';

const FULL = JSON.parse(fs.readFileSync('docs/openapi.json', 'utf8'));
// the Production beta configuration (6B, 18/11/2026)
const PROD = { ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const FORBIDDEN = /^\/(admin|cron|monitor|pro|institution|login-pro-guard)(\/|$)/;
const ops = (spec) => Object.entries(spec.paths).flatMap(([p, v]) => Object.keys(v).filter((m) => m !== 'parameters').map((m) => `${m.toUpperCase()} ${p}`));
const refs = (node, out = new Set()) => {
  if (Array.isArray(node)) node.forEach((x) => refs(x, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === '$ref' && typeof v === 'string') out.add(v); else refs(v, out); }
  return out;
};

describe('publicOpenApiSpec (Production beta configuration)', () => {
  const spec = publicOpenApiSpec(FULL, PROD);
  const list = ops(spec);

  it('keeps the public read routes', () => {
    for (const o of ['GET /aides', 'GET /aides/{slug}', 'GET /structures', 'GET /demarches', 'GET /search', 'GET /taxonomy', 'GET /territory/postal', 'GET /health']) expect(list).toContain(o);
  });

  it('has no admin / cron / monitor / pro / institution path, even though admin is an open surface', () => {
    expect(Object.keys(spec.paths).filter((p) => FORBIDDEN.test(p))).toEqual([]);
    expect(Object.keys(FULL.paths).filter((p) => FORBIDDEN.test(p)).length).toBeGreaterThan(25);   // the full spec does list them
  });

  it('every kept operation is open to an anonymous visitor in this configuration (beta gate + no security requirement)', () => {
    for (const [p, v] of Object.entries(spec.paths)) for (const [m, o] of Object.entries(v)) {
      if (m === 'parameters') continue;
      expect(isAllowedInPublicBeta(m.toUpperCase(), p.slice(1).replace(/\{[^}]+\}/g, 'x'), PROD), `${m} ${p}`).toBe(true);
      expect(o.security, `${m} ${p}`).toBeUndefined();
    }
  });

  it('drops the closed routes: diagnostic, assistant, share, documents, messages, contact, rdv, docs itself, the authenticated /auth/me and /health/deep', () => {
    for (const o of ['POST /diagnostic', 'POST /assistant/chat', 'POST /share/create', 'GET /share/get', 'GET /pdf', 'GET /download', 'POST /secure-messages',
      'POST /contact', 'GET /rdv', 'GET /auth/me', 'GET /health/deep', 'GET /drees', 'POST /public/assistant/orient']) expect(list).not.toContain(o);
  });

  it('keeps only referenced schemas and security schemes, and no webhook', () => {
    const used = refs(spec.paths);
    let grew = true;
    while (grew) { const before = used.size; for (const r of [...used]) refs(spec.components.schemas[r.split('/').pop()], used); grew = used.size !== before; }
    expect(Object.keys(spec.components.schemas).sort()).toEqual([...used].filter((r) => r.startsWith('#/components/schemas/')).map((r) => r.split('/').pop()).sort());
    expect(spec.components.securitySchemes || {}).toEqual({});
    expect(spec['x-webhooks']).toBeUndefined();
    expect(JSON.stringify(spec)).not.toMatch(/x-admin-token|CronSecret|InstitutionBearer|PartnerSignature/);
    const tags = new Set(Object.values(spec.paths).flatMap((v) => Object.values(v).flatMap((o) => o.tags || [])));
    expect(spec.tags.every((t) => tags.has(t.name))).toBe(true);
  });

  it('does not change the input', () => {
    expect(JSON.parse(fs.readFileSync('docs/openapi.json', 'utf8'))).toEqual(FULL);
  });
});

describe('opening more surfaces never brings in the private spaces', () => {
  it('with every surface open, still no admin / cron / monitor / pro / institution path', () => {
    const all = { ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'accounts,pro,institution,appointments,video,communications,documents,diagnostic,admin', ADA_BETA_OPEN_JOBS: 'actualites,link-check' };
    const spec = publicOpenApiSpec(FULL, all);
    expect(Object.keys(spec.paths).filter((p) => FORBIDDEN.test(p))).toEqual([]);
    expect(ops(spec)).toContain('POST /diagnostic');   // follows the beta gate
  });
});

describe('handler', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const call = async () => {
    const { default: handler } = await import('../../api/_handlers/openapi.js');
    let body = ''; const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, end(b) { body = b || ''; }, json(b) { body = JSON.stringify(b); } };
    await handler({ method: 'GET' }, res);
    return { res, spec: JSON.parse(body) };
  };
  it('in the beta: the public subset', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', 'true'); vi.stubEnv('ADA_BETA_OPEN_SURFACES', 'admin,accounts');
    const { res, spec } = await call();
    expect(res.statusCode).toBe(200);
    expect(Object.keys(spec.paths).filter((p) => FORBIDDEN.test(p))).toEqual([]);
    expect(spec.paths['/aides']).toBeDefined();
  });
  it('outside the beta: the full spec, unchanged', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '');
    const { spec } = await call();
    expect(spec).toEqual(FULL);
  });
});

describe('G3 activation: the public subset is reachable during the beta (GET only)', () => {
  it('GET /api/docs/openapi.json is allowed; other methods and other docs paths are not', () => {
    const env = { ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
    expect(isAllowedInPublicBeta('GET', 'docs/openapi.json', env)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'docs/openapi.json', env)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'docs', env)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'docs/openapi.yaml', env)).toBe(false);
  });
});
