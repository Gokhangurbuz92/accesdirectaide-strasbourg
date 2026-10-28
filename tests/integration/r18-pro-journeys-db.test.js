/**
 * R18 (product completion audit, 2026-10-28) — REAL PostgreSQL, real handlers, real pro JWTs, a Map-backed object store (no network):
 *   1. a document download token is bound to the professional it was issued to: their departure stops it at once, and the departure ends their sessions;
 *   2. opening hours: the administrator (owner decision R18.5, R24 — the R19 « every member » rule replaced); every member still records their own absence;
 *   3. a self-registered organization not yet activated by ADA reaches its own space (record, proposals) but not the case queue;
 *   4. a dossier under a restriction of processing (RGPD art. 18) is neither listed nor counted in the organization's queue.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise. Synthetic data only.
 */
import { vi } from 'vitest';
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-r18-pro');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const STORE = vi.hoisted(() => ({ blobs: new Map(), n: 0 }));
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { STORE.n += 1; const k = `r18-key-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return STORE.blobs.get(k); },
    delete: async (k) => { STORE.blobs.delete(k); },
  },
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const SA = `r18-sa-${TS}`, SP = `r18-sp-${TS}`;
const U = (n, sid, role) => ({ id: `r18-${n}-${TS}`, email: `r18-${n}-${TS}@example.test`, sid, role });
const ADMIN = U('admin', SA, 'STRUCTURE_ADMIN'), MEMBER = U('member', SA, 'PRO'), PENDING = U('pending', SP, 'STRUCTURE_ADMIN');
const CITIZEN = `r18-cit-${TS}`;
const created = [];
const PDF = Buffer.from('%PDF-1.4 synthetic R18 justificatif');

describe.skipIf(!hasDatabase)('R18 professional journeys (real DB)', () => {
  let db, auth, H;
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  async function newShare() {
    const r = await invoke(H.create, { method: 'POST', url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200); created.push(r.body.shareId);
    return { id: r.body.shareId, owner: r.body.ownerSecret };
  }
  async function grantTo(s, u) {
    const inv = await invoke(H.grants, { method: 'POST', url: '/api/public/dossier-grants', body: { shareId: s.id, action: 'invite', structureId: u.sid }, headers: { 'x-share-owner-secret': s.owner } });
    expect(inv.statusCode).toBe(201);
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, inviteToken: inv.body.inviteToken }, headers: pro(u) })).statusCode).toBe(200);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js');
    H = {
      create: (await import('../../api/_handlers/share/create.js')).default, redeem: (await import('../../api/_handlers/pro/dossier/redeem.js')).default,
      dossier: (await import('../../api/_handlers/pro/dossier.js')).default, upload: (await import('../../api/_handlers/pro/dossier/upload-secure.js')).default,
      download: (await import('../../api/_handlers/download.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      team: (await import('../../api/_handlers/pro/team.js')).default, availability: (await import('../../api/_handlers/pro/availability.js')).default,
      timeoff: (await import('../../api/_handlers/pro/timeoff.js')).default, structure: (await import('../../api/_handlers/pro/structure.js')).default,
      cases: (await import('../../api/_handlers/pro/cases.js')).default,
    };
    for (const [sid, statut] of [[SA, 'actif'], [SP, 'brouillon']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'R18 ' + sid}, ${'r18-slug-' + sid}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${statut === 'actif' ? 'VERIFIED' : 'UNVERIFIED'}, NOW(), NOW())`);
    }
    for (const u of [ADMIN, MEMBER, PENDING]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CITIZEN}, ${CITIZEN + '@example.test'}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${CITIZEN}`);
    if (created.length) {
      const ids = sql.join(created.map((i) => sql`${i}`), sql`, `);
      await db.execute(sql`DELETE FROM "ProCaseEvent" WHERE "caseId" IN (SELECT id FROM "ProCase" WHERE "sharedDiagnosticId" IN (${ids}))`);
      await db.execute(sql`DELETE FROM "ProCase" WHERE "sharedDiagnosticId" IN (${ids})`);
      await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${ids})`);
    }
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" IN (${SA}, ${SP})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" IN (${SA}, ${SP})`);
    await db.execute(sql`DELETE FROM "StructureProposal" WHERE "structureId" IN (${SA}, ${SP})`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${SA}, ${SP})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SP})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SP})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CITIZEN}`);
  });

  it('opening hours are the administrator\'s (owner decision R18.5); a member reads them and still records their own absence (the B92 journey)', async () => {
    // R18 native run (B92): an admin-only rule on absences broke a member's agenda journey. Owner decision R18.5 (28/10/2026, R24): the general hours are the
    // administrator's or a delegated member's; every member keeps their OWN absence. The member's refusal below is that decision, not a hidden regression.
    const slots = { mon: ['09:00-12:00'] };
    const read = await invoke(H.availability, { url: '/api/pro/availability', headers: pro(MEMBER) });
    expect(read.statusCode).toBe(200); expect(read.body.canEdit).toBe(false);
    const refused = await invoke(H.availability, { method: 'PUT', url: '/api/pro/availability', body: { slots_json: slots, timezone: 'Europe/Paris' }, headers: pro(MEMBER) });
    expect(refused.statusCode).toBe(403); expect(refused.body.code).toBe('SCHEDULE_MANAGERS_ONLY');
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAvailabilityRule" WHERE "structureId" = ${SA}`)).rows[0].n, 'nothing written').toBe(0);
    expect((await invoke(H.availability, { method: 'PUT', url: '/api/pro/availability', body: { slots_json: slots, timezone: 'Europe/Paris' }, headers: pro(ADMIN) })).statusCode).toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAvailabilityRule" WHERE "structureId" = ${SA}`)).rows[0].n).toBeGreaterThan(0);
    const at = (d) => new Date(Date.now() + d * 86400000).toISOString();
    const made = await invoke(H.timeoff, { method: 'POST', url: '/api/pro/timeoff', body: { startAt: at(10), endAt: at(11), reason: 'r18' }, headers: pro(MEMBER) });
    expect(made.statusCode).toBe(201); expect(made.body.item).toMatchObject({ scope: 'member', mine: true, proUserId: MEMBER.id });
    expect((await db.execute(sql`SELECT reason, "proUserId" FROM "ProTimeOff" WHERE "structureId" = ${SA}`)).rows).toEqual([{ reason: 'r18', proUserId: MEMBER.id }]);
  });

  it('a download token is bound to its professional: their departure stops it at once and ends their sessions', async () => {
    const s = await newShare(); await grantTo(s, ADMIN);
    const up = await invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body: { shareId: s.id, originalName: 'justificatif.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') }, headers: pro(MEMBER) });
    expect(up.statusCode).toBe(200);
    const list = await invoke(H.dossier, { url: `/api/pro/dossier?shareId=${s.id}`, headers: pro(MEMBER) });
    expect(list.statusCode).toBe(200);
    const memberToken = list.body.documents[0].downloadToken;
    const adminToken = (await invoke(H.dossier, { url: `/api/pro/dossier?shareId=${s.id}`, headers: pro(ADMIN) })).body.documents[0].downloadToken;
    expect((await invoke(H.download, { method: 'POST', url: '/api/download', body: { token: memberToken } })).statusCode).toBe(200);
    const out = await invoke(H.team, { method: 'DELETE', url: `/api/pro/team?userId=${MEMBER.id}`, query: { userId: MEMBER.id }, headers: pro(ADMIN) });
    expect(out.statusCode).toBe(200);
    expect((await invoke(H.download, { method: 'POST', url: '/api/download', body: { token: memberToken } })).statusCode).toBe(404);   // the departed member's token
    expect((await invoke(H.download, { method: 'POST', url: '/api/download', body: { token: adminToken } })).statusCode).toBe(200);    // the colleague's still works
    const [row] = (await db.execute(sql`SELECT status, "sessionsValidAfter" FROM "ProUser" WHERE id = ${MEMBER.id}`)).rows;
    expect(row.status).toBe('disabled'); expect(row.sessionsValidAfter).not.toBeNull();
  });

  it('an organization awaiting activation reaches its own record and proposals, not the case queue', async () => {
    const profile = await invoke(H.structure, { url: '/api/pro/structure', headers: pro(PENDING) });
    expect(profile.statusCode).toBe(200); expect(profile.body.structure.statut).toBe('brouillon');
    expect((await invoke(H.structure, { method: 'POST', url: '/api/pro/structure', body: { action: 'propose', field: 'telephone', value: '03 88 00 00 18' }, headers: pro(PENDING) })).statusCode).toBe(201);
    expect((await invoke(H.cases, { url: '/api/pro/cases', query: { scope: 'mine' }, headers: pro(PENDING) })).statusCode).toBe(403);
  });

  it('a dossier under a restriction of processing leaves the queue and its counts', async () => {
    const s = await newShare(); await grantTo(s, ADMIN);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = ${CITIZEN} WHERE id = ${s.id}`);
    const queued = async () => { const r = await invoke(H.cases, { url: '/api/pro/cases', query: { scope: 'unassigned' }, headers: pro(ADMIN) }); expect(r.statusCode).toBe(200); return r.body; };
    const before = await queued();
    expect(before.cases.some((c) => c.dossierId === s.id)).toBe(true);
    await db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode") VALUES (${'r18-dsr-' + TS}, 'CITIZEN_USER', ${CITIZEN}, 'RESTRICT', 'ACTIVE', 'SELF_SERVICE')`);
    const after = await queued();
    expect(after.cases.some((c) => c.dossierId === s.id)).toBe(false);
    expect(after.counts.unassigned).toBe(before.counts.unassigned - 1);
  });
});
