/**
 * PKG-11 / A02 (remainder) — dispositifs and guides administration on REAL PostgreSQL THROUGH THE REAL API ENTRY (synthetic records only).
 *  - guides are ADA's own editorial content: a draft is not public (the same 404 as an unknown slug, no oracle); publishing puts it online with its validated steps
 *    and dates it; every edit keeps the prior row and can be rolled back exactly; unpublish / archive take it offline without deleting it;
 *  - dispositifs follow D-5 like aides: published but unverified = not public; verified = public; editing a verified dispositif puts it on hold through the ledger;
 *    links must be https;
 *  - structured columns are validated shapes, never free JSON.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = `a02b-adm-${TS}@example.test`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-11 / A02 dispositifs and guides through the real API entry (real DB)', () => {
  let db, api, auth, recordVerification; const ids = { guide: [], dispositif: [] };
  const call = async (method, url, { bearer, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mfa = () => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true });
  const row = async (table, id) => (await db.execute(sql`SELECT * FROM ${sql.raw(`"${table}"`)} WHERE id = ${id}`)).rows[0];
  const content = (method, kind, { id, body } = {}) => call(method, `/api/admin/content?kind=${kind}${id ? `&id=${id}` : ''}`, { bearer: mfa(), body });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    ({ recordVerification } = await import('../../api/_services/content-verification.js'));
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    for (const [kind, table] of [['guide', 'Guide'], ['dispositif', 'Dispositif']]) {
      if (!ids[kind].length) continue;
      const list = sql.join(ids[kind].map((i) => sql`${i}`), sql`, `);
      await db.execute(sql`DELETE FROM "EntityVersion" WHERE entity_type = ${table} AND entity_id IN (${list})`).catch(() => {});
      await db.execute(sql`DELETE FROM ${sql.raw(`"${table}"`)} WHERE id IN (${list})`).catch(() => {});
    }
  });

  it('a guide: draft not public (same 404 as an unknown slug), published with its steps and dated, versioned, rolled back exactly, then archived without deletion', async () => {
    const steps = [{ titre: 'Préparer ses justificatifs', texte: 'Rassemblez vos papiers.' }, { titre: 'Déposer la demande', texte: 'En ligne ou au guichet.' }];
    const c = await content('POST', 'guide', { body: { titre: `A02B Guide ${TS}`, resume_falc: 'Un guide de test.', contenu_json: steps, publics: ['tout_public'] } });
    expect(c.statusCode).toBe(201); const { id, slug } = c.body.item; ids.guide.push(id);
    const draft = await row('Guide', id);
    expect([draft.statut, draft.published_at, draft.contenu_json]).toEqual(['brouillon', null, steps]);
    const anon = await call('GET', `/api/guides/${slug}`); const unknown = await call('GET', `/api/guides/no-such-guide-${TS}`);
    expect([anon.statusCode, anon.body]).toEqual([unknown.statusCode, unknown.body]); expect(anon.statusCode).toBe(404);
    expect((await content('PUT', 'guide', { id, body: { statut: 'publie' } })).statusCode).toBe(200);
    const pub = await call('GET', `/api/guides/${slug}`);
    expect(pub.statusCode).toBe(200); expect(pub.body.contenu_json).toEqual(steps);
    const firstDate = (await row('Guide', id)).published_at; expect(firstDate).toBeTruthy();
    const edited = [...steps, { titre: 'Suivre le dossier', texte: 'Gardez le numéro de dépôt.' }];
    const e = await content('PUT', 'guide', { id, body: { contenu_json: edited } });
    expect([e.body.changed, e.body.heldForReverification]).toEqual([['contenu_json'], false]);   // no verification projection on a guide
    expect((await call('GET', `/api/guides/${slug}`)).body.contenu_json).toHaveLength(3);
    const versions = (await call('GET', `/api/admin/content-versions?entityType=guide&entityId=${id}`, { bearer: mfa() })).body.versions;
    const beforeEdit = versions.find((v) => /before admin edit \(contenu_json\)/.test(v.reason)); expect(beforeEdit).toBeTruthy();
    const rb = await call('POST', '/api/admin/content-versions', { bearer: mfa(), body: { versionId: beforeEdit.id, reason: 'Retour à la version en deux étapes (test).' } });
    expect(rb.statusCode).toBe(200);
    expect((await row('Guide', id)).contenu_json).toEqual(steps);
    await content('PUT', 'guide', { id, body: { statut: 'brouillon' } }); await content('PUT', 'guide', { id, body: { statut: 'publie' } });
    expect(String((await row('Guide', id)).published_at)).toBe(String(firstDate));   // the first publication date stays
    expect((await content('DELETE', 'guide', { id })).statusCode).toBe(200);
    expect((await call('GET', `/api/guides/${slug}`)).statusCode).toBe(404);
    expect((await row('Guide', id)).statut).toBe('archive');
  });

  it('guide steps and dispositif links are validated shapes', async () => {
    expect((await content('POST', 'guide', { body: { titre: `A02B Guide invalide ${TS}`, contenu_json: '<script>alert(1)</script>' } })).body.error).toBe('INVALID_VALUE');
    expect((await content('POST', 'guide', { body: { titre: `A02B Guide invalide ${TS}`, contenu_json: [{ titre: 'sans texte' }] } })).body.error).toBe('INVALID_VALUE');
    expect((await content('POST', 'dispositif', { body: { titre: `A02B Dispositif invalide ${TS}`, liens: [{ nom: 'x', url: 'http://example.test/' }] } })).body.error).toBe('INVALID_VALUE');
    expect((await content('POST', 'dispositif', { body: { titre: `A02B Dispositif invalide ${TS}`, verification_status: 'VERIFIED' } })).body.error).toBe('FIELD_NOT_EDITABLE');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "Guide" WHERE titre LIKE ${'A02B Guide invalide%'}`)).rows[0].n).toBe(0);
  });

  it('P09: a dispositif links aides and structures by identifier or slug; the site shows only the linked records that are public; unknown references are refused', async () => {
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt") VALUES
      (${'p09-av-' + TS}, ${'p09-av-' + TS}, 'Aide liée publique P09', 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '3 days', 'official', 'https://www.service-public.fr/', NOW()),
      (${'p09-au-' + TS}, ${'p09-au-' + TS}, 'Aide liée non vérifiée P09', 'publie', false, 'UNVERIFIED', NULL, false, NULL, 'official', 'https://www.service-public.fr/', NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt", "createdAt")
      VALUES (${'p09-s-' + TS}, 'Structure liée P09', ${'p09-s-' + TS}, '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['x'], ARRAY['x'], 'actif', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '3 days', 'official', 'https://www.service-public.fr/', NOW(), NOW())`);
    expect((await content('POST', 'dispositif', { body: { titre: `A02B P09 invalide ${TS}`, related_aide_ids: ['no-such-aide'] } })).body.error).toBe('INVALID_REFERENCE');
    const c = await content('POST', 'dispositif', { body: { titre: `A02B P09 ${TS}`, description_falc: 'Dispositif lié.', related_aide_ids: [`p09-av-${TS}`, `p09-au-${TS}`], related_structure_ids: [`p09-s-${TS}`] } });
    expect(c.statusCode).toBe(201); const { id, slug } = c.body.item; ids.dispositif.push(id);
    expect((await row('Dispositif', id)).related_aide_ids).toEqual([`p09-av-${TS}`, `p09-au-${TS}`]);   // slugs resolved to identifiers
    await content('PUT', 'dispositif', { id, body: { statut: 'publie', source_url: 'https://www.service-public.fr/particuliers/vosdroits/F12006' } });
    expect((await recordVerification({ entityType: 'dispositif', entityId: id, action: 'VERIFY', reviewer: { id: 'p09-reviewer', role: 'admin' }, territoryConfirmed: true,
      sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006', evidenceNote: 'Synthetic QA: page officielle relue, liens conformes.' })).ok).toBe(true);
    const pub = await call('GET', `/api/dispositifs?slug=${slug}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.body.related).toEqual({ aides: [{ slug: `p09-av-${TS}`, titre: 'Aide liée publique P09' }], structures: [{ slug: `p09-s-${TS}`, nom: 'Structure liée P09', ville: 'Strasbourg' }] });
    expect(pub.body.related_aide_ids).toBeUndefined(); expect(JSON.stringify(pub.body)).not.toContain(`p09-au-${TS}`);   // the unverified aide is not even named
    const list = await call('GET', '/api/dispositifs');
    expect(JSON.stringify(list.body)).not.toContain(`p09-au-${TS}`);
    await db.execute(sql`DELETE FROM "Aide" WHERE id IN (${'p09-av-' + TS}, ${'p09-au-' + TS})`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${'p09-s-' + TS}`);
  });

  it('a dispositif follows D-5: published + unverified is not public, verified is public, an edit of a verified dispositif puts it on hold', async () => {
    const liens = [{ nom: 'Service-Public', url: 'https://www.service-public.fr/particuliers/vosdroits/F12006' }];
    const c = await content('POST', 'dispositif', { body: { titre: `A02B Dispositif ${TS}`, description_falc: 'Un dispositif de test.', public: ['jeunes'], liens, departement: '67' } });
    expect(c.statusCode).toBe(201); const { id, slug } = c.body.item; ids.dispositif.push(id);
    expect(await row('Dispositif', id)).toMatchObject({ statut: 'brouillon', verification_status: 'UNVERIFIED', data_origin: 'admin_entry', liens, public: ['jeunes'] });
    await content('PUT', 'dispositif', { id, body: { statut: 'publie', source_url: 'https://www.service-public.fr/particuliers/vosdroits/F12006' } });
    expect((await call('GET', `/api/dispositifs?slug=${slug}`)).statusCode).toBe(404);   // published but unverified: not public (D-5)
    const v = await recordVerification({ entityType: 'dispositif', entityId: id, action: 'VERIFY', reviewer: { id: 'a02b-reviewer', role: 'admin' }, territoryConfirmed: true,
      sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006', evidenceNote: 'Synthetic QA: page officielle relue, conditions conformes.' });
    expect(v.ok).toBe(true);
    expect((await call('GET', `/api/dispositifs?slug=${slug}`)).statusCode).toBe(200);
    const e = await content('PUT', 'dispositif', { id, body: { montant: '100 € (test)' } });
    expect(e.body.heldForReverification).toBe(true);
    expect((await row('Dispositif', id)).publication_hold).toMatch(/à revérifier/);
    expect((await call('GET', `/api/dispositifs?slug=${slug}`)).statusCode).toBe(404);
    const list = await content('GET', 'dispositif');
    expect(list.body.items.find((i) => i.id === id)).toMatchObject({ statut: 'publie', departement: '67', verification_status: 'VERIFIED' });
  });
});
