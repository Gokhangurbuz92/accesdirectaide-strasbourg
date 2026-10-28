/**
 * PKG-5 / E01 (owner decision 2026-10-20) on REAL PostgreSQL THROUGH THE REAL API ENTRY: a person can give NEW dossier access to (invitation, counter hand-over C24)
 * or NEWLY book with only an organization that is active AND identity-VERIFIED and able to act. Organizations: V (verified, active), U (active, NOT verified),
 * S (verified but suspended = brouillon), W (verified, another organization). Synthetic data; the VERIFIED flag here is a fixture, not a WS2 human verification.
 *   - search / invitation: U and S never offered, same 404 as an unknown id
 *   - redemption (C24) re-checks: an invitation to V is refused once V lost its verification; it works again only after re-verification; W can never use V's invitation
 *   - existing access after a loss of verification: what the person granted stays (V still reads), the person can still withdraw it; a SUSPENSION ends access
 *   - booking: services / slots / booking refused for U and S; for V allowed; after V loses verification the existing appointment stays and can be cancelled,
 *     a move to a new slot and a new booking are refused with a stated reason
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const O = { V: `e01-V-${TS}`, U: `e01-U-${TS}`, S: `e01-S-${TS}`, W: `e01-W-${TS}` };
const PRO = Object.fromEntries(Object.entries(O).map(([k, st]) => [k, { id: `e01-p${k}-${TS}`, st }]));
const CIT = { id: `e01-cit-${TS}`, email: `e01-cit-${TS}@example.test` };
const CSRF = 'e01csrf' + TS;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-5 E01 verified-only choice through the real API entry (real DB)', () => {
  let db, api, auth, userAuth;
  const call = async (method, url, { pro, cit, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(pro ? { authorization: `Bearer ${auth.signProToken({ id: pro.id, email: `${pro.id}@example.test`, structureId: pro.st, role: 'STRUCTURE_ADMIN' })}` } : {}),
      ...(cit ? { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}), ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const setOrg = (id, statut, verification) => db.execute(sql`UPDATE "Structure" SET statut = ${statut}, verification_status = ${verification} WHERE id = ${id}`);
  let share; let slot;
  const own = (action, extra = {}) => call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: share.id, action, ...extra }, headers: { 'x-share-owner-secret': share.owner } });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    for (const [k, id] of Object.entries(O)) {
      const statut = k === 'S' ? 'brouillon' : 'actif'; const ver = k === 'U' ? 'UNVERIFIED' : 'VERIFIED';
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'E01 Org ' + k + ' ' + TS}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${ver}, NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${PRO[k].id}, ${PRO[k].id + '@example.test'}, 'x', 'STRUCTURE_ADMIN', 'active', ${id}, NOW())`);
      await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'e01-set-' + k + TS}, ${id}, true, 'IN_PERSON', NOW())`);
      await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${'e01-svc-' + k + TS}, ${id}, 'Accueil', 30, NOW())`);
      for (let wd = 0; wd <= 6; wd += 1) await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "updatedAt") VALUES (${`e01-r-${k}-${wd}-${TS}`}, ${id}, ${wd}, '09:00', '12:00', 'Europe/Paris', NOW())`);
    }
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    const created = await call('POST', '/api/share/create', { cit: true, body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    share = { id: created.body.shareId, owner: created.body.ownerSecret };
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${share?.id || ''}`).catch(() => {});
    for (const id of Object.values(O)) {
      for (const t of ['ProAppointment', 'ProAvailabilityRule', 'ProRdvService', 'StructureRdvSettings', 'ProNotification', 'ProUser']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE "structureId" = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('search and invitation: only active + verified organizations; unverified / suspended = the same 404 as an unknown id', async () => {
    const found = (await own('find_organizations', { q: `E01 Org` })).body.organizations.map((o) => o.id);
    expect(found).toEqual(expect.arrayContaining([O.V, O.W])); expect(found).not.toContain(O.U); expect(found).not.toContain(O.S);
    const unknown = await own('invite', { structureId: `nope-${TS}` });
    for (const id of [O.U, O.S]) { const r = await own('invite', { structureId: id }); expect([r.statusCode, r.body]).toEqual([unknown.statusCode, unknown.body]); }
    expect(unknown.statusCode).toBe(404);
  });

  it('C24 redemption re-checks: refused after V lost its verification, accepted after re-verification; another organization can never use it', async () => {
    const inv = await own('invite', { structureId: O.V }); expect(inv.statusCode).toBe(201);
    const redeem = (pro) => call('POST', '/api/pro/dossier/redeem', { pro, body: { shareId: share.id, inviteToken: inv.body.inviteToken } });
    expect((await redeem(PRO.W)).statusCode, 'invitation bound to V').toBe(404);
    await setOrg(O.V, 'actif', 'UNVERIFIED');
    expect((await redeem(PRO.V)).statusCode, 'verification lost before redemption').toBe(404);
    await setOrg(O.V, 'actif', 'VERIFIED');
    expect((await redeem(PRO.V)).statusCode, 'the unused invitation works again once re-verified').toBe(200);
    const owner = (await db.execute(sql`SELECT "ownerCitizenId" o FROM "SharedDiagnostic" WHERE id = ${share.id}`)).rows[0].o; expect(owner).toBe(CIT.id);
  });

  it('existing access: losing verification keeps what the person granted (and their control); a suspension ends the organization\'s access', async () => {
    const read = () => call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(share.id)}`, { pro: PRO.V });
    expect((await read()).statusCode).toBe(200);
    await setOrg(O.V, 'actif', 'UNVERIFIED');
    expect((await read()).statusCode, 'not deleted, not cut: the person decides').toBe(200);
    expect((await own('invite', { structureId: O.V })).statusCode, 'but no NEW invitation').toBe(404);
    await setOrg(O.V, 'brouillon', 'UNVERIFIED');
    expect((await read()).statusCode, 'suspended organization: no access').toBe(404);
    expect((await own('revoke', { structureId: O.V })).statusCode, 'the person can still withdraw it').toBe(200);
    await setOrg(O.V, 'actif', 'VERIFIED');
  });

  it('booking: refused for unverified / suspended organizations; after a loss of verification the existing appointment can be cancelled, a move and a new booking are refused', async () => {
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); const day2 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    for (const k of ['U', 'S']) {
      expect((await call('GET', `/api/rdv/structures/${O[k]}/services`, { cit: true })).statusCode, `${k} services`).toBe(404);
      expect((await call('GET', `/api/rdv/structures/${O[k]}/slots?serviceId=e01-svc-${k}${TS}&from=${day}&to=${day}`, { cit: true })).statusCode, `${k} slots`).toBe(404);
      expect((await call('POST', '/api/rdv/appointments', { cit: true, body: { structureSlug: O[k], serviceId: `e01-svc-${k}${TS}`, startAt: `${day}T08:00:00.000Z`, idempotencyKey: `e01-${k}-${TS}` } })).statusCode, `${k} booking`).toBe(404);
    }
    const slots = await call('GET', `/api/rdv/structures/${O.V}/slots?serviceId=e01-svc-V${TS}&from=${day}&to=${day2}`, { cit: true });
    expect(slots.statusCode).toBe(200); const all = (slots.body.days || []).flatMap((d) => d.slots || []); slot = all[0]; const other = all[all.length - 1];
    const booked = await call('POST', '/api/rdv/appointments', { cit: true, body: { structureSlug: O.V, serviceId: `e01-svc-V${TS}`, startAt: slot.startAt, idempotencyKey: `e01-V-${TS}` } });
    expect(booked.statusCode, JSON.stringify(booked.body)).toBe(201);
    await setOrg(O.V, 'actif', 'UNVERIFIED');
    const move = await call('POST', `/api/rdv/appointments/${booked.body.id}/reschedule`, { cit: true, body: { startAt: other.startAt } });
    expect([move.statusCode, move.body.code]).toEqual([409, 'ORGANIZATION_NOT_BOOKABLE']);
    expect((await call('POST', '/api/rdv/appointments', { cit: true, body: { structureSlug: O.V, serviceId: `e01-svc-V${TS}`, startAt: other.startAt, idempotencyKey: `e01-V2-${TS}` } })).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${booked.body.id}`)).rows[0].status, 'nothing cancelled automatically').not.toBe('cancelled');
    const cancel = await call('POST', `/api/rdv/appointments/${booked.body.id}/cancel`, { cit: true, body: {} });
    expect(cancel.statusCode, JSON.stringify(cancel.body)).toBe(200);
    await setOrg(O.V, 'actif', 'VERIFIED');
  });

  it('I02 differencing: an organization in a commune with fewer than 3 verified organizations never changes the published totals (no subtraction reveals it)', async () => {
    const X = `CommuneX-${TS}`; const Y = `CommuneY-${TS}`; const ids = [];
    for (let i = 0; i < 4; i += 1) {
      const id = `e01-d${i}-${TS}`; ids.push(id); const ville = i < 3 ? X : Y;
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Diff ' + i}, ${id}, 'association', '1 rue', ${ville}, '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
      for (let k = 0; k < (i < 3 ? 2 : 7); k += 1) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${`${id}-u${k}`}, ${`${id}-u${k}@example.test`}, 'x', 'PRO', 'active', ${id}, NOW())`);
    }
    const before = (await call('GET', '/api/pro/regional-stats', { pro: PRO.V })).body.stats;
    const cityX = before.cities.find((c) => c.name === X); expect(cityX.agents).toBe(6); expect(before.cities.find((c) => c.name === Y)).toBeUndefined();
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE "structureId" = ${ids[3]}`);   // the lone organization changes; nothing published may move
    const after = (await call('GET', '/api/pro/regional-stats', { pro: PRO.V })).body.stats;
    expect(after.totalAgents).toBe(before.totalAgents); expect(after.cities).toEqual(before.cities);
    for (const id of ids) { await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${id}`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`); }
  });

  it('lifecycle (admin, real entry): the list keeps identity / activity / public apart; suspension needs MFA and a reason, ends the members\' access, nothing deleted', async () => {
    const admin = (mfa) => `Bearer ${auth.signAdminSessionToken({ email: 'e01-admin@example.test', role: 'admin', mfa_verified: mfa })}`;
    const list = await call('GET', `/api/admin/organizations?q=${encodeURIComponent('E01 Org V ' + TS)}`, { headers: { authorization: admin(false) } });
    expect(list.statusCode).toBe(200);
    const v = list.body.organizations.find((o) => o.id === O.V);
    expect(v).toMatchObject({ statut: 'actif', identity: 'VERIFIED', canReceiveNew: true });
    const u = (await call('GET', `/api/admin/organizations?q=${encodeURIComponent('E01 Org U ' + TS)}`, { headers: { authorization: admin(false) } })).body.organizations.find((o) => o.id === O.U);
    expect(u.canReceiveNew, 'identity not verified').toBe(false);
    expect(typeof u.public.visible, 'the D-5 decision is computed on its own (lab content mode may show unverified LAB records; it never makes them able to receive)').toBe('boolean');
    expect((await call('GET', '/api/admin/organizations', { pro: PRO.V })).statusCode, 'a professional token is not an administrator').toBe(401);
    expect((await call('POST', '/api/admin/organizations', { headers: { authorization: admin(false) }, body: { id: O.V, action: 'SUSPEND', reason: 'contrôle QA' } })).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/organizations', { headers: { authorization: admin(true) }, body: { id: O.V, action: 'SUSPEND' } })).body.error).toBe('reason_required');
    const share2 = await call('POST', '/api/share/create', { cit: true, body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    const s2 = { id: share2.body.shareId, owner: share2.body.ownerSecret };
    const inv = await call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: s2.id, action: 'invite', structureId: O.V }, headers: { 'x-share-owner-secret': s2.owner } });
    expect((await call('POST', '/api/pro/dossier/redeem', { pro: PRO.V, body: { shareId: s2.id, inviteToken: inv.body.inviteToken } })).statusCode).toBe(200);
    const sus = await call('POST', '/api/admin/organizations', { headers: { authorization: admin(true) }, body: { id: O.V, action: 'SUSPEND', reason: 'contrôle QA synthétique' } });
    expect(sus.statusCode, JSON.stringify(sus.body)).toBe(200);
    expect((await call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(s2.id)}`, { pro: PRO.V })).statusCode, 'suspended: no access').toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${s2.id} AND "revokedAt" IS NULL`)).rows[0].n, 'nothing deleted').toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'ORGANIZATION_SUSPENDED' AND entity_id = ${O.V}`)).rows[0].n).toBe(1);
    expect((await call('POST', '/api/admin/organizations', { headers: { authorization: admin(true) }, body: { id: O.V, action: 'REACTIVATE', reason: 'fin du contrôle QA' } })).statusCode).toBe(200);
    expect((await call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(s2.id)}`, { pro: PRO.V })).statusCode, 'the person\'s grant still applies').toBe(200);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${s2.id}`);
  });
});
