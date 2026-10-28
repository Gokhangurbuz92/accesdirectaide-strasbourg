/**
 * PKG-11 / P16 — POST /api/assistant/recommendations on REAL PostgreSQL through the real API entry (synthetic data only; the local model is unreachable here, so
 * the lexical path is exercised and nothing leaves the machine):
 *  - only VERIFIED catalogue records are proposed; kinds alternate best-first; every lead says why it is shown and links to a real page;
 *  - a postal code selects the structures of its département; national démarches are never filtered out by place.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const TS = Date.now(); const tag = `p16-${TS}`; const WORD = `zqlogis${TS}`; const CSRF = 'p16csrf' + TS;
const RECENT = new Date(Date.now() - 86400000);
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}
const verified = { launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev-1', territory_verified: true, data_origin: 'official', date_verification: RECENT, source_url: 'https://www.service-public.fr/x' };

describe('PKG-11 / P16 sourced, ranked leads for the named need (real DB)', () => {
  let db, api; const savedMode = process.env.ADA_PUBLIC_CONTENT_MODE;
  const recos = async (body) => { const req = { method: 'POST', url: '/api/assistant/recommendations', query: {}, body, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF } }; const res = mkRes(); await api(req, res); return res; };
  const structure = (key, dep, services, ok = true) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, departement, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut,
      launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, "updatedAt", "createdAt")
    VALUES (${`${tag}-${key}`}, ${`Centre ${key} ${TS}`}, ${`${tag}-${key}`}, 'association', '1 rue', 'Ville', ${dep + '000'}, ${dep}, false, ARRAY[${sql.join(services.map((x) => sql`${x}`), sql`, `)}]::text[], ARRAY['tout_public'], ARRAY['social'], 'actif',
      ${ok}, ${ok ? 'VERIFIED' : 'UNVERIFIED'}, ${ok ? 'rev-1' : null}, ${ok}, 'official', ${ok ? RECENT : null}, 'https://www.service-public.fr/x', NOW(), NOW())`);
  const demarche = (key, ok = true) => db.execute(sql`INSERT INTO "Demarche" (id, slug, titre, description_courte, statut, departements, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, "updatedAt")
    VALUES (${`${tag}-d-${key}`}, ${`${tag}-d-${key}`}, ${`Démarche ${WORD} ${key}`}, 'Synthetic fixture only.', 'publie', ARRAY[]::text[], ${ok}, ${ok ? 'VERIFIED' : 'UNVERIFIED'}, ${ok ? 'rev-1' : null}, ${ok}, 'official', ${ok ? RECENT : null}, 'https://www.service-public.fr/d', NOW())`);

  beforeAll(async () => {
    process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    await structure('bas-rhin', '67', [`Accompagnement ${WORD}`]);
    await structure('haut-rhin', '68', [`Accompagnement ${WORD}`]);
    await structure('unverified', '67', [`Accompagnement ${WORD}`], false);
    await demarche('national'); await demarche('draft', false);
  }, 90000);
  afterAll(async () => {
    if (savedMode === undefined) delete process.env.ADA_PUBLIC_CONTENT_MODE; else process.env.ADA_PUBLIC_CONTENT_MODE = savedMode;
    if (!db) return;
    await db.execute(sql`DELETE FROM "Demarche" WHERE id LIKE ${tag + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${tag + '%'}`).catch(() => {});
  });

  it('a postal code keeps the structures of its département and the national démarche; unverified records never appear; each lead says why', async () => {
    const res = await recos({ need: WORD, territory: '67000', limit: 10, types: ['demarche', 'structure'] });
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const ids = res.body.items.map((i) => `${i.type}:${i.slug}`);
    expect(ids).toEqual([`demarche:${tag}-d-national`, `structure:${tag}-bas-rhin`]);   // alternating kinds, best first
    const [d, s] = res.body.items;
    expect(d.whyShown).toBe(`correspond au mot « ${WORD} » de votre besoin`);
    expect(s.whyShown).toBe(`la structure indique proposer « Accompagnement ${WORD} »`);
    expect(s.url).toBe(`/structures/${tag}-bas-rhin`); expect(d.url).toBe(`/demarches/${tag}-d-national`);
    expect(JSON.stringify(res.body)).not.toMatch(/unverified|d-draft|_services|haut-rhin/);
  });

  it('without a place, both départements are possible; the shape never carries internal fields', async () => {
    const res = await recos({ need: WORD, limit: 10, types: ['structure'] });
    expect(res.body.items.map((i) => i.slug).sort()).toEqual([`${tag}-bas-rhin`, `${tag}-haut-rhin`]);
    for (const i of res.body.items) expect(Object.keys(i).sort()).toEqual(['excerpt', 'slug', 'sourceLabel', 'sourceUrl', 'title', 'type', 'url', 'verifiedAt', 'whyShown']);
  });
});
