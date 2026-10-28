/**
 * PKG-11 / E04 — what a structure does feeds the directory search, on REAL PostgreSQL through the real API entry (synthetic data only):
 *  - a search finds a verified structure by a service it DECLARES (catalogue `services`) or a service it offers for booking on ADA (active, published booking);
 *  - the result says why it is shown (« indique proposer … », the structure's own words), never that it suits the person;
 *  - an inactive bookable service, a service of a structure whose booking is not published and an unverified structure never surface.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const TS = Date.now(); const tag = `e04-${TS}`; const WORD = `zqmediation${TS}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe('PKG-11 / E04 structure services feed the directory search (real DB)', () => {
  let db, api; const savedMode = process.env.ADA_PUBLIC_CONTENT_MODE;
  const get = async (url) => { const req = { method: 'GET', url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } }; const res = mkRes(); await api(req, res); return res; };
  const mk = (key, { services = ['x'], verified = true, pro = false } = {}) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut,
      launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, is_pro_enabled, "updatedAt", "createdAt")
    VALUES (${`${tag}-${key}`}, ${`Structure ${key} ${TS}`}, ${`${tag}-${key}`}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY[${sql.join(services.map((x) => sql`${x}`), sql`, `)}]::text[], ARRAY['tout_public'], ARRAY['social'], 'actif',
      ${verified}, ${verified ? 'VERIFIED' : 'UNVERIFIED'}, ${verified ? 'rev-1' : null}, ${verified}, 'official', ${verified ? new Date(Date.now() - 86400000) : null}, 'https://www.service-public.fr/x', ${pro}, NOW(), NOW())`);
  const service = (key, name, active = true) => db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", "updatedAt") VALUES (${`${tag}-sv-${key}`}, ${`${tag}-${key}`}, ${name}, 30, ${active}, NOW())`);

  beforeAll(async () => {
    process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    await mk('declared', { services: [`Atelier ${WORD} familiale`, 'Écrivain public'] });
    await mk('bookable', { pro: true }); await service('bookable', `Rendez-vous ${WORD}`);
    await mk('inactive', { pro: true }); await service('inactive', `Ancien ${WORD}`, false);
    await mk('unpublished', { pro: false }); await service('unpublished', `Brouillon ${WORD}`);
    await mk('unverified', { services: [`${WORD} non vérifiée`], verified: false });
  }, 90000);
  afterAll(async () => {
    if (savedMode === undefined) delete process.env.ADA_PUBLIC_CONTENT_MODE; else process.env.ADA_PUBLIC_CONTENT_MODE = savedMode;
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id LIKE ${tag + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${tag + '%'}`).catch(() => {});
  });

  it('finds structures by a declared service and by an active published bookable service, and says why', async () => {
    const res = await get(`/api/structures?q=${encodeURIComponent(WORD)}&sort=relevance`);
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual([`${tag}-bookable`, `${tag}-declared`]);
    expect(byId[`${tag}-declared`].whyShown).toEqual({ services: [`Atelier ${WORD} familiale`] });
    expect(byId[`${tag}-bookable`].whyShown).toEqual({ services: [`Rendez-vous ${WORD}`] });
  });

  it('never surfaces an inactive bookable service, an unpublished booking or an unverified structure', async () => {
    const res = await get(`/api/structures?q=${encodeURIComponent(WORD)}`);
    const ids = res.body.items.map((i) => i.id);
    for (const k of ['inactive', 'unpublished', 'unverified']) expect(ids).not.toContain(`${tag}-${k}`);
    expect(JSON.stringify(res.body)).not.toMatch(/Ancien|Brouillon|non vérifiée/);
  });

  it('a name search is unchanged: no « why shown » when the name matched', async () => {
    const res = await get(`/api/structures?q=${encodeURIComponent(`Structure declared ${TS}`)}`);
    const item = res.body.items.find((i) => i.id === `${tag}-declared`);
    expect(item).toBeTruthy();
    expect(item.whyShown).toBeUndefined();
  });
});
