/**
 * PKG-11 / A05 — link check of the official sources on REAL PostgreSQL. The network is a STUB that records every request: nothing leaves the machine.
 *  - only visible records and only allow-listed https hosts are requested; a hidden (unverified) record and an outside address are never requested;
 *  - HEAD refused → one 1-byte GET; redirects followed within the allow-list only; structures are checked too;
 *  - two consecutive BROKEN results open ONE review item; nothing is unpublished; the cron is off unless the owner enables it.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const U = (p) => `https://www.service-public.fr/qa-${TS}/${p}`;
const CAF = (p) => `https://www.caf.fr/qa-${TS}/${p}`;
const calls = [];
const stub = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', range: init.headers?.Range || null });
  const u = String(url);
  const r = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
  if (u === U('ok')) return r(200);
  if (u === U('old')) return r(301, { location: U('new') });
  if (u === U('new')) return r(200);
  if (u === U('gone')) return r(404);
  if (u === CAF('head-refused')) return init.method === 'HEAD' ? r(405) : r(206);
  if (u === CAF('out')) return r(302, { location: 'https://outside.example.test/landing' });
  return r(200);
};

describe.skipIf(!hasDatabase)('PKG-11 / A05 link check (real DB, stubbed network)', () => {
  let db, run, handler;
  const verified = { launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'reviewer-seed@example.test', territory_verified: true };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ runLinkCheck: run } = await import('../../api/_services/link-check.js'));
    handler = (await import('../../api/_handlers/cron/link-check.js')).default;
    const aide = (id, o) => db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, lien_demande, "updatedAt")
      VALUES (${id}, ${id}, ${'Aide ' + id}, 'publie', ${o.launch_eligible || false}, ${o.verification_status || 'UNVERIFIED'}, ${o.verified_by || null}, ${o.territory_verified || false}, NOW() - interval '5 days', 'official', ${o.source_url}, ${o.lien_demande || null}, NOW())`);
    await aide(`a05-v-${TS}`, { ...verified, source_url: U('ok'), lien_demande: U('old') });
    await aide(`a05-x-${TS}`, { ...verified, source_url: `http://example.test/qa-${TS}` });   // outside the allow-list
    await aide(`a05-h-${TS}`, { source_url: U('hidden') });                                    // unverified: not visible, never requested
    await db.execute(sql`INSERT INTO "Demarche" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url_exact, "updatedAt")
      VALUES (${'a05-d-' + TS}, ${'a05-d-' + TS}, 'Démarche A05', 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '5 days', 'official', ${U('gone')}, NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt", "createdAt")
      VALUES (${'a05-s-' + TS}, 'Structure A05', ${'a05-s-' + TS}, '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['x'], ARRAY['x'], 'actif', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '5 days', 'official', ${CAF('head-refused')}, NOW(), NOW()),
             (${'a05-s2-' + TS}, 'Structure A05 bis', ${'a05-s2-' + TS}, '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['x'], ARRAY['x'], 'actif', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '5 days', 'official', ${CAF('out')}, NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const like = `a05-%-${TS}`;
    await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE "entityId" LIKE ${like}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SourceSnapshot" WHERE entity_id LIKE ${like}`).catch(() => {});
    for (const t of ['Aide', 'Demarche', 'Structure']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE id LIKE ${like}`).catch(() => {});
  });

  it('the cron is off unless the owner enables it; nothing is requested', async () => {
    const prev = process.env.LINK_CHECK_ENABLED; delete process.env.LINK_CHECK_ENABLED;
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: 'GET', headers: { 'x-cron-secret': process.env.CRON_SECRET, authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, res, { fetchImpl: stub });
    expect([res.statusCode, res.body.skipped]).toEqual([200, 'disabled']);
    expect(calls).toHaveLength(0);
    if (prev !== undefined) process.env.LINK_CHECK_ENABLED = prev;
  });

  it('visible records and allow-listed hosts only; HEAD then a 1-byte GET; redirects within the allow-list; structures checked', async () => {
    const stats = await run({ db, fetchImpl: stub, spacingMs: 0 });
    const mine = calls.filter((c) => c.url.includes(`qa-${TS}`) || c.url.includes('outside.example.test'));
    expect(mine.some((c) => c.url === U('hidden'))).toBe(false);
    expect(mine.some((c) => c.url.startsWith('http://example.test'))).toBe(false);
    expect(mine.some((c) => c.url.includes('outside.example.test'))).toBe(false);   // a redirect outside the allow-list is recorded, never followed
    expect(mine.filter((c) => c.url === CAF('head-refused')).map((c) => [c.method, c.range])).toEqual([['HEAD', null], ['GET', 'bytes=0-0']]);
    expect(stats.OUTSIDE_ALLOWLIST).toBeGreaterThanOrEqual(1); expect(stats.BROKEN).toBeGreaterThanOrEqual(1);
    const snaps = Object.fromEntries((await db.execute(sql`SELECT entity_id, raw_excerpt, http_status, final_url FROM "SourceSnapshot" WHERE entity_id LIKE ${`a05-%-${TS}`}`)).rows.map((r) => [r.raw_excerpt.replace('link:', ''), r]));
    expect(snaps[U('old')]).toMatchObject({ http_status: 200, final_url: U('new') });
    expect(snaps[U('gone')].http_status).toBe(404);
    expect(snaps[CAF('head-refused')].http_status).toBe(206);
    expect(snaps[CAF('out')].final_url).toBe('https://outside.example.test/landing');
    expect(snaps[`http://example.test/qa-${TS}`].http_status).toBe(null);
    expect(snaps[U('hidden')]).toBeUndefined();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE "entityId" = ${'a05-d-' + TS}`)).rows[0].n).toBe(0);   // one broken result is not enough
  });

  it('a link broken on two consecutive runs opens ONE review item; the record stays published', async () => {
    await run({ db, fetchImpl: stub, spacingMs: 0 });
    await run({ db, fetchImpl: stub, spacingMs: 0 });
    const items = (await db.execute(sql`SELECT reason, status, details FROM "ReviewQueueItem" WHERE "entityId" = ${'a05-d-' + TS}`)).rows;
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ reason: 'SOURCE_LINK_BROKEN', status: 'OPEN' }); expect(items[0].details.url).toBe(U('gone'));
    expect((await db.execute(sql`SELECT statut, publication_hold FROM "Demarche" WHERE id = ${'a05-d-' + TS}`)).rows[0]).toEqual({ statut: 'publie', publication_hold: null });
  });

  it('per-host budget: a run never sends more than `perHost` requests to one host', async () => {
    calls.length = 0;
    const stats = await run({ db, fetchImpl: stub, spacingMs: 0, perHost: 1 });
    const perHost = {}; for (const c of calls) { const h = new URL(c.url).host; perHost[h] = (perHost[h] || 0) + (c.method === 'HEAD' ? 1 : 0); }
    for (const n of Object.values(perHost)) expect(n).toBeLessThanOrEqual(1 + 3);   // one address per host, at most 3 redirect hops
    expect(stats.skippedHostBudget).toBeGreaterThanOrEqual(1);
  });
});
