/**
 * PKG-11 / A02 — catalogue administration on REAL PostgreSQL THROUGH THE REAL API ENTRY (synthetic records only). Before: the admin screens wrote to read-only public
 * endpoints (nothing could be created, edited or removed) and listed through the public API (drafts invisible).
 *  - reads need an administrator session; every write needs a named session with MFA;
 *  - a new record is a draft, never verified, and is listed for the administrators (not for the public);
 *  - editorial fields only: the verification projection and the FALC texts are refused (their own governed workflows), types are checked;
 *  - each change keeps the exact prior row (A07) and is journalised (field names, no content); an unchanged save writes nothing;
 *  - editing the content of a VERIFIED record puts it on hold through the ledger (no longer public until re-verified); a status-only change does not;
 *  - archive is never a delete (idempotent; an archived record cannot be edited; an aide archive also sets status_code).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = `a02-adm-${TS}@example.test`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-11 / A02 catalogue administration through the real API entry (real DB)', () => {
  let db, api, auth, decide, recordVerification; const created = { aide: [], demarche: [], structure: [] };
  const call = async (method, url, { bearer, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mfa = () => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true });
  const noMfa = () => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: false });
  const row = async (table, id) => (await db.execute(sql`SELECT * FROM ${sql.raw(`"${table}"`)} WHERE id = ${id}`)).rows[0];
  const TABLE = { aide: 'Aide', demarche: 'Demarche', structure: 'Structure' };   // the A07 store keys versions by table
  const versions = async (type, id) => (await db.execute(sql`SELECT reason, snapshot_json AS s FROM "EntityVersion" WHERE entity_type = ${TABLE[type]} AND entity_id = ${id} ORDER BY "createdAt", id`)).rows;
  const create = async (kind, body) => { const r = await call('POST', `/api/admin/content?kind=${kind}`, { bearer: mfa(), body }); if (r.body?.item?.id) created[kind].push(r.body.item.id); return r; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    ({ decide } = await import('../../api/lib/publicVisibility.js'));
    ({ recordVerification } = await import('../../api/_services/content-verification.js'));
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    for (const [kind, table] of [['aide', 'Aide'], ['demarche', 'Demarche'], ['structure', 'Structure']]) {
      const ids = created[kind]; if (!ids.length) continue;
      const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
      await db.execute(sql`DELETE FROM "EntityVersion" WHERE entity_type = ${table} AND entity_id IN (${list})`).catch(() => {});
      await db.execute(sql`DELETE FROM ${sql.raw(`"${table}"`)} WHERE id IN (${list})`).catch(() => {});
    }
  });

  it('reads need an administrator session; every write needs MFA', async () => {
    expect((await call('GET', '/api/admin/content?kind=aide')).statusCode).toBe(401);
    expect((await call('GET', '/api/admin/content?kind=aide', { bearer: noMfa() })).statusCode).toBe(200);
    const w = await call('POST', '/api/admin/content?kind=aide', { bearer: noMfa(), body: { titre: `A02 refused ${TS}` } });
    expect([w.statusCode, w.body.error]).toEqual([403, 'HUMAN_MFA_SESSION_REQUIRED']);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "Aide" WHERE titre = ${`A02 refused ${TS}`}`)).rows[0].n).toBe(0);
    expect((await call('GET', '/api/admin/content?kind=nope', { bearer: mfa() })).statusCode).toBe(400);
  });

  it('a new record is a draft, unverified, listed for the administrators and not public', async () => {
    const r = await create('aide', { titre: `A02 Aide ${TS}`, categorie: 'logement', cest_quoi: 'Une aide de test.', documents_necessaires: ['Pièce d’identité', ' '], est_urgent: false });
    expect(r.statusCode).toBe(201);
    const a = await row('Aide', r.body.item.id);
    expect(a).toMatchObject({ statut: 'brouillon', verification_status: 'UNVERIFIED', data_origin: 'admin_entry', launch_eligible: false, documents_necessaires: ['Pièce d’identité'] });
    expect(a.slug).toMatch(/^a02-aide-/);
    expect(decide(a, 'aide').visible).toBe(false);
    const list = await call('GET', `/api/admin/content?kind=aide&q=${encodeURIComponent(`A02 Aide ${TS}`)}`, { bearer: noMfa() });
    expect(list.body.items.map((i) => i.id)).toEqual([r.body.item.id]);
    const one = await call('GET', `/api/admin/content?kind=aide&id=${r.body.item.id}`, { bearer: noMfa() });
    expect(one.body.item.titre).toBe(`A02 Aide ${TS}`); expect(one.body.item.embedding).toBeUndefined();
    const audit = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'ADMIN_CONTENT_CREATED' AND entity_id = ${r.body.item.id}`)).rows;
    expect(audit).toHaveLength(1); expect(JSON.stringify(audit[0].details)).not.toContain('Une aide de test');
    const s = await create('structure', { nom: `A02 Structure ${TS}`, adresse: '1 rue des Tests', code_postal: '67000', ville: 'Strasbourg', services: ['Accueil'] });
    expect(s.statusCode).toBe(201);
    expect(await row('Structure', s.body.item.id)).toMatchObject({ statut: 'brouillon', services: ['Accueil'], publics_accueillis: [], accessibilite_pmr: false });
    const d = await create('demarche', { titre: `A02 Démarche ${TS}`, description_courte: 'Test.' });
    expect(d.statusCode).toBe(201);
  });

  it('only editorial fields, with their types: verification, FALC and unknown fields are refused', async () => {
    const id = created.aide[0];
    const put = (body) => call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body });
    expect((await put({ verification_status: 'VERIFIED' })).body.error).toBe('FIELD_NOT_EDITABLE');
    expect((await put({ launch_eligible: true, cest_quoi: 'x' })).body.error).toBe('FIELD_NOT_EDITABLE');
    expect((await put({ summary_falc: 'Texte facile' })).body.error).toBe('FALC_FIELD');
    expect((await put({ est_urgent: 'oui' })).body.error).toBe('INVALID_VALUE');
    expect((await put({ documents_necessaires: 'pas une liste' })).body.error).toBe('INVALID_VALUE');
    expect((await put({ statut: 'archive' })).body.error).toBe('INVALID_STATUS');
    expect((await put({ titre: '' })).body.error).toBe('INVALID_VALUE');   // NOT NULL label
    expect((await create('aide', { cest_quoi: 'sans titre' })).body.error).toBe('LABEL_REQUIRED');
    expect((await create('structure', { nom: `A02 Sans adresse ${TS}` })).body.error).toBe('FIELD_REQUIRED');
    const a = await row('Aide', id);
    expect([a.verification_status, a.launch_eligible, a.summary_falc]).toEqual(['UNVERIFIED', false, null]);
    expect(await versions('aide', id)).toHaveLength(0);   // a refused change writes nothing
  });

  it('an edit keeps the exact prior row and is journalised; an unchanged save writes nothing', async () => {
    const id = created.aide[0];
    const r = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { cest_quoi: 'Texte corrigé.', pour_qui: 'Les personnes de test.' } });
    expect(r.statusCode).toBe(200);
    expect([r.body.changed, r.body.heldForReverification]).toEqual([['cest_quoi', 'pour_qui'], false]);
    expect((await row('Aide', id)).cest_quoi).toBe('Texte corrigé.');
    const v = await versions('aide', id);
    expect(v).toHaveLength(1); expect(v[0].s.cest_quoi).toBe('Une aide de test.'); expect(v[0].reason).toMatch(/before admin edit \(cest_quoi, pour_qui\)/);
    const again = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { cest_quoi: 'Texte corrigé.' } });
    expect(again.body.changed).toEqual([]);
    expect(await versions('aide', id)).toHaveLength(1);
    const audit = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'ADMIN_CONTENT_UPDATED' AND entity_id = ${id}`)).rows;
    expect(audit).toHaveLength(1); expect(audit[0].details).toMatchObject({ fields: ['cest_quoi', 'pour_qui'], heldForReverification: false });
    expect(JSON.stringify(audit[0].details)).not.toContain('Texte corrigé');
  });

  it('publish / unpublish are status changes only; publication still needs the verification', async () => {
    const id = created.aide[0];
    expect((await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { statut: 'publie' } })).body.item.statut).toBe('publie');
    const a = await row('Aide', id);
    expect(a.statut).toBe('publie'); expect(decide(a, 'aide').visible).toBe(false);   // published but unverified: still not public
    expect((await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { statut: 'brouillon' } })).body.item.statut).toBe('brouillon');
    const sid = created.structure[0];
    expect((await call('PUT', `/api/admin/content?kind=structure&id=${sid}`, { bearer: mfa(), body: { statut: 'actif' } })).body.item.statut).toBe('actif');
    expect((await call('PUT', `/api/admin/content?kind=structure&id=${sid}`, { bearer: mfa(), body: { statut: 'publie' } })).body.error).toBe('INVALID_STATUS');
  });

  it('editing a VERIFIED record puts it on hold through the ledger; a status-only change does not', async () => {
    const id = created.aide[0];
    await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { statut: 'publie', source_url: 'https://www.service-public.fr/particuliers/vosdroits/F12006' } });
    const ver = await recordVerification({ entityType: 'aide', entityId: id, action: 'VERIFY', reviewer: { id: 'a02-reviewer', role: 'admin' }, territoryConfirmed: true,
      sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006', evidenceNote: 'Synthetic QA: page officielle relue, conditions conformes.' });
    expect(ver.ok).toBe(true);
    const verified = await row('Aide', id);
    expect(decide(verified, 'aide').visible).toBe(true);
    const statusOnly = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { statut: 'publie', categorie: 'logement' } });
    expect([statusOnly.body.changed, statusOnly.body.heldForReverification]).toEqual([[], undefined]);
    const r = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { pour_qui: 'Nouveau public.' } });
    expect([r.statusCode, r.body.heldForReverification]).toEqual([200, true]);
    const held = await row('Aide', id);
    expect(held.publication_hold).toMatch(/Contenu modifié par l’administration \(pour_qui\)/);
    expect(held.verification_status).toBe('VERIFIED');   // the verification is not erased, the record is held
    expect(decide(held, 'aide').visible).toBe(false);
    const ledger = (await db.execute(sql`SELECT outcome, "reviewerId" FROM "ContentVerification" WHERE "entityType" = 'aide' AND "entityId" = ${id} ORDER BY "createdAt"`)).rows;
    expect(ledger.map((l) => l.outcome)).toEqual(['VERIFIED', 'HOLD']); expect(ledger[1].reviewerId).toBe(ADMIN);
    const again = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { pour_qui: 'Nouveau public, encore.' } });
    expect(again.body.heldForReverification).toBe(false);   // already held: no second hold
  });

  it('archive is never a delete: kept, idempotent, not editable; an aide archive sets status_code', async () => {
    const id = created.aide[0];
    const r = await call('DELETE', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa() });
    expect([r.statusCode, r.body.item.statut]).toEqual([200, 'archive']);
    const a = await row('Aide', id);
    expect([a.statut, a.status_code]).toEqual(['archive', 'ARCHIVED']);
    expect((await versions('aide', id)).at(-1).reason).toBe('before archive');
    expect((await call('DELETE', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa() })).statusCode).toBe(200);
    const edit = await call('PUT', `/api/admin/content?kind=aide&id=${id}`, { bearer: mfa(), body: { cest_quoi: 'après archive' } });
    expect([edit.statusCode, edit.body.error]).toEqual([409, 'ARCHIVED']);
    expect((await call('DELETE', `/api/admin/content?kind=aide&id=${id}`, { bearer: noMfa() })).statusCode).toBe(403);
    expect((await call('DELETE', '/api/admin/content?kind=aide&id=does-not-exist', { bearer: mfa() })).statusCode).toBe(404);
  });
});
