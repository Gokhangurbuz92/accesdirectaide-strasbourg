/**
 * RC5 product sharing model - REAL PostgreSQL, real handlers, real pro JWTs. Contract: docs/release/RC5_PRIVACY_SECURITY_UX_PRODUCT_CONTRACT.md
 *   OWNER (citizen) : invite ONE verified organization, remove one organization, stop sharing, choose purposes (PURP-05 AI separate from PURP-06 sharing), erase.
 *   INVITATION      : bound to an immutable Structure.id, single use, short lived; a share link alone never authorizes an organization.
 *   MEMBERSHIP      : active member (role PRO | STRUCTURE_ADMIN) of an 'actif' organization, checked on every access.
 *   LEGACY (pre-RC5) rows: no owner; the link is read / transitional-redeem only (flag ADA_LEGACY_SHARE_READ).
 *   CRYPTO          : envelope v2 (random per-record data key, key ids, AAD bound to the thread), legacy v1 readable, rotation by re-wrap.
 * Every denied mutation is followed by a snapshot comparison: stored data (dossier row, grants, invites, threads, messages, audit rows) is unchanged.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import crypto from 'node:crypto';
import { vi } from 'vitest';
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-rc5-sharing');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const spies = vi.hoisted(() => ({ uploads: 0, ai: 0, prompts: [] }));
vi.mock('../../api/lib/storage.js', () => ({ storage: { upload: async () => { spies.uploads += 1; return `qa-key-${spies.uploads}`; }, delete: async () => {}, download: async () => Buffer.alloc(0) } }));
// PKG-6 / R17 overlay (owner decision 2026-10-21, R17_LOCAL_SYNTHESIS_OVERLAY_V1.md): the dossier synthesis now runs on the LOCAL model only. The provider-specific
// mock moves from gemini.js generateText to ai-foundation generateStructuredContent (same counter `spies.ai`, same captured prompt); Gemini stays mocked and any
// call to it now FAILS the test (no fallback). Every access, consent, revocation and prompt-minimisation assertion below is unchanged.
vi.mock('../../api/lib/gemini.js', () => ({ generateText: async () => { spies.gemini = (spies.gemini || 0) + 1; throw new Error('GEMINI_MUST_NOT_BE_CALLED'); } }));
vi.mock('../../api/lib/ai-foundation.js', async (importOriginal) => ({ ...(await importOriginal()), generateStructuredContent: async (args) => {
  spies.ai += 1; spies.prompts.push(`${String(args?.systemInstruction || '')}\n${String(args?.prompt || '')}`); spies.providers = [...(spies.providers || []), [args?.primaryProvider, args?.fallbackProvider ?? null, args?.allowFallback]];
  return { content: { points: ['Point de test un', 'Point de test deux', 'Point de test trois'] }, model: 'qwen3:8b', provider: 'ollama', safeErrorState: null };
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const sha = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const SA = `rc5p-sa-${TS}`, SB = `rc5p-sb-${TS}`, SC = `rc5p-sc-${TS}`, SD = `rc5p-sd-${TS}`, SX = `rc5p-sx-${TS}`;   // D = suspended organization, X = organization with nobody to receive
const U = (n, sid, role = 'STRUCTURE_ADMIN', status = 'active') => ({ id: `rc5p-${n}-${TS}`, email: `${n}-${TS}@example.test`, sid, role, status });
const PA1 = U('pa1', SA), PA2 = U('pa2', SA, 'PRO'), PAX = U('pax', SA, 'STRUCTURE_ADMIN', 'inactive'), PAV = U('pav', SA, 'VIEWER'), PB = U('pb', SB), PC = U('pc', SC), PD = U('pd', SD);
const created = [];

describe.skipIf(!hasDatabase)('RC5 product sharing model (real DB)', () => {
  let db, auth, H, dk, threadsSvc, keyRotation, legacyCrypto;
  const tok = (u) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: ['PRO', 'STRUCTURE_ADMIN'].includes(u.role) ? u.role : 'STRUCTURE_ADMIN' })}`;   // a stale token whose DB role later changed (e.g. VIEWER) must still be refused by the membership check
  const invoke = async (handler, { method = 'GET', url, body, headers = {} }) => { const r = mk(); await handler({ method, url, query: {}, body, headers: { host: 'x', ...headers } }, r); return r; };
  const pro = (u) => ({ authorization: tok(u) });

  async function newShare() {
    const r = await invoke(H.create, { method: 'POST', url: '/api/share/create', body: { situation: { zipCode: '67000', marker: 'SECRET_SITUATION_MARKER' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200);
    const id = r.body.shareId; created.push(id);
    return { id, token: new URLSearchParams(r.body.shareUrl.split('#')[1]).get('capability'), owner: r.body.ownerSecret, body: r.body };
  }
  const own = (s, action, extra = {}) => invoke(H.grants, { method: 'POST', url: '/api/public/dossier-grants', body: { shareId: s.id, action, ...extra }, headers: { 'x-share-owner-secret': s.owner } });
  const invite = async (s, sid) => { const r = await own(s, 'invite', { structureId: sid }); expect(r.statusCode).toBe(201); return r.body.inviteToken; };
  const redeem = (u, s, inviteToken) => invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, inviteToken }, headers: pro(u) });
  /** share + invite + redeem for one organization */
  const grantTo = async (s, u) => { expect((await redeem(u, s, await invite(s, u.sid))).statusCode).toBe(200); };
  const getDossier = (u, s) => invoke(H.dossier, { url: `/api/pro/dossier?shareId=${s.id}`, headers: pro(u) });
  const snap = async (id) => {
    const n = async (q) => (await db.execute(q)).rows[0].n;
    return {
      row: (await db.execute(sql`SELECT md5(t::text) AS h FROM "SharedDiagnostic" t WHERE id = ${id}`)).rows[0]?.h ?? null,
      grants: (await db.execute(sql`SELECT coalesce(string_agg(g."structureId" || ':' || (g."revokedAt" IS NULL)::text || ':' || g.purposes, ',' ORDER BY g."structureId"), '') AS h FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${id}`)).rows[0].h,
      invites: (await db.execute(sql`SELECT coalesce(string_agg(i.id || ':' || (i."usedAt" IS NULL)::text || ':' || (i."revokedAt" IS NULL)::text, ',' ORDER BY i.id), '') AS h FROM "SharedDossierInvite" i WHERE i."sharedDiagnosticId" = ${id}`)).rows[0].h,
      threads: await n(sql`SELECT count(*)::int AS n FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${id}`),
      audit: await n(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE details->>'shareId' = ${id}`),
    };
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js'); dk = await import('../../api/lib/data-keys.js');
    threadsSvc = await import('../../api/_services/shared-dossier-threads.js'); keyRotation = await import('../../api/_services/key-rotation.js'); legacyCrypto = await import('../../api/lib/crypto.js');
    H = {
      create: (await import('../../api/_handlers/share/create.js')).default, get: (await import('../../api/_handlers/share/get.js')).default,
      redeem: (await import('../../api/_handlers/pro/dossier/redeem.js')).default, dossier: (await import('../../api/_handlers/pro/dossier.js')).default,
      exp: (await import('../../api/_handlers/pro/dossier/export.js')).default, upload: (await import('../../api/_handlers/pro/dossier/upload-secure.js')).default,
      synth: (await import('../../api/_handlers/pro/dossier-synthesis.js')).default, consent: (await import('../../api/_handlers/pro/consent.js')).default,
      revoke: (await import('../../api/_handlers/public/dossier-revoke.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      passport: (await import('../../api/_handlers/public/passport.js')).default, msgs: (await import('../../api/_handlers/secure-messages.js')).default,
      shareThread: (await import('../../api/_handlers/share/thread.js')).default,
    };
    for (const [sid, n, statut] of [[SA, 'A', 'actif'], [SB, 'B', 'actif'], [SC, 'C', 'actif'], [SD, 'D', 'brouillon'], [SX, 'X', 'actif']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'CCAS Rc5p ' + n}, ${'rc5p-slug-' + n + '-' + TS}, 'association', '1 rue', ${'Ville' + n}, '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, 'VERIFIED', NOW(), NOW())`);   // PKG-4 / E01: receiving organizations are verified
    }
    for (const u of [PA1, PA2, PAX, PAV, PB, PC, PD]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, ${u.status}, NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    if (created.length) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(created.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${SA}, ${SB}, ${SC}, ${SD}, ${SX})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SB}, ${SC}, ${SD}, ${SX})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB}, ${SC}, ${SD}, ${SX})`);
  });

  it('OWNERSHIP vs SHARING: two distinct secrets; the link reads, never owns; only the owner can invite / stop sharing / erase; denied attempts change nothing', async () => {
    const s = await newShare();
    expect(s.token).not.toBe(s.owner); expect(s.body.shareUrl).not.toContain(s.owner); expect(s.body.proUrl).toBeUndefined();
    expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id: s.id, capability: s.token } })).statusCode).toBe(200);
    expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id: s.id, capability: s.owner } })).statusCode).toBe(404);
    await grantTo(s, PA1);
    const before = await snap(s.id);
    const attempts = [
      { u: '/api/public/dossier-revoke', h: H.revoke, body: { shareId: s.id } },
      { u: '/api/public/dossier-revoke', h: H.revoke, body: { shareId: s.id, rightsSecret: s.token } },
      { u: '/api/public/dossier-revoke', h: H.revoke, body: { shareId: s.id, capability: s.token } },
      { u: '/api/public/dossier-grants', h: H.grants, body: { shareId: s.id, action: 'stop_sharing' } },
      { u: '/api/public/dossier-grants', h: H.grants, body: { shareId: s.id, action: 'stop_sharing', rightsSecret: s.token } },
      { u: '/api/public/dossier-grants', h: H.grants, body: { shareId: s.id, action: 'invite', structureId: SB } },
      { u: '/api/public/dossier-grants', h: H.grants, body: { shareId: s.id, action: 'revoke', structureId: SA } },
      { u: '/api/public/dossier-grants', h: H.grants, body: { shareId: s.id, action: 'set_purposes', structureId: SA, purposes: ['PURP-06', 'PURP-05'] } },
    ];
    for (const a of attempts) {
      for (const headers of [{}, { 'x-share-token': s.token }, pro(PA1)]) expect((await invoke(a.h, { method: 'POST', url: a.u, body: a.body, headers })).statusCode).toBe(404);
    }
    expect((await invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: `nope-${TS}`, rightsSecret: s.owner } })).statusCode).toBe(404);
    expect(await snap(s.id)).toEqual(before);
    // "stop sharing" is NOT erasure: everyone loses access, the old read link dies, the dossier stays with its owner
    const stop = await own(s, 'stop_sharing'); expect(stop.statusCode).toBe(200); expect(stop.body.grants).toBe(1);
    expect((await getDossier(PA1, s)).statusCode).toBe(404);
    expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id: s.id, capability: s.token } })).statusCode).toBe(404);
    expect((await invoke(H.passport, { url: `/api/public/passport?shareId=${s.id}`, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(200);
    expect((await snap(s.id)).row).not.toBeNull();
    // erasure is a separate, explicit operation
    expect((await invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(200);
    expect((await snap(s.id)).row).toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${s.id}`)).rows[0].n).toBe(0);   // cascade
  });

  it('INVITATION is bound to ONE organization: another organization, a forwarded link and a bare share token get nothing; the legitimate organization is not harmed by the attempts', async () => {
    const s = await newShare(); const t = await invite(s, SA); const before = await snap(s.id);
    for (const [u, tokenToUse] of [[PB, t], [PC, t], [PB, 'wrong']]) expect((await redeem(u, s, tokenToUse)).statusCode).toBe(404);
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, shareToken: s.token }, headers: pro(PA1) })).statusCode).toBe(404);   // a share link alone never authorizes an organization
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, shareToken: s.owner }, headers: pro(PA1) })).statusCode).toBe(404);
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, inviteToken: t } })).statusCode).toBe(401);        // no session
    expect(await snap(s.id)).toEqual(before);
    expect((await redeem(PA1, s, t)).statusCode).toBe(200);
    expect((await redeem(PA2, s, t)).statusCode).toBe(200);                                                                                       // a colleague of the SAME organization (idempotent, one grant)
    expect((await snap(s.id)).grants).toBe(`${SA}:true:PURP-06`);
    const other = await newShare(); expect((await redeem(PA1, other, t)).statusCode).toBe(404);                                                   // the token is bound to its dossier
    // refused at creation: unknown / unverified (suspended) / nobody able to receive; dossier expired
    for (const sid of [`nope-${TS}`, SD, SX]) expect((await own(s, 'invite', { structureId: sid })).statusCode).toBe(404);
    expect((await own(s, 'invite', { structureId: SA })).statusCode).toBe(409);                                                                    // already shared with A
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = NOW() - interval '1 hour' WHERE id = ${other.id}`);
    expect((await own(other, 'invite', { structureId: SB })).statusCode).toBe(410);
  });

  it('REPLAY, EXPIRY, REVOCATION of invitations; one pending invitation per organization; cap on pending invitations', async () => {
    const s = await newShare();
    const t1 = await invite(s, SB), t2 = await invite(s, SB);                                                                                      // re-inviting cancels the previous pending one
    expect((await redeem(PB, s, t1)).statusCode).toBe(404); expect((await redeem(PB, s, t2)).statusCode).toBe(200);
    const t3 = await invite(s, SC);
    await db.execute(sql`UPDATE "SharedDossierInvite" SET "expiresAt" = NOW() - interval '1 minute' WHERE "sharedDiagnosticId" = ${s.id} AND "structureId" = ${SC}`);
    const exp = await redeem(PC, s, t3); expect(exp.statusCode).toBe(410); expect(exp.body.error).toBe('invite_expired');
    expect((await snap(s.id)).grants).toBe(`${SB}:true:PURP-06`);
    const list = await own(s, 'list'); const pendingC = list.body.invites.find((i) => i.structureId === SC); expect(pendingC.status).toBe('expired');
    const t4 = await invite(s, SC); const listed = (await own(s, 'list')).body.invites.find((i) => i.structureId === SC && i.status === 'pending');
    expect((await own(s, 'revoke_invite', { inviteId: listed.id })).statusCode).toBe(200); expect((await redeem(PC, s, t4)).statusCode).toBe(404);
    expect((await own(s, 'revoke_invite', { inviteId: listed.id })).statusCode).toBe(404);                                                       // already cancelled
    // a used token never works again for anybody else, and invitation lifetime never exceeds the dossier
    const exp2 = (await db.execute(sql`SELECT "expiresAt" AS d, (SELECT "expiresAt" FROM "SharedDiagnostic" WHERE id = ${s.id}) AS dossier FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${s.id} AND "structureId" = ${SB}`)).rows[0];
    expect(new Date(exp2.d).getTime()).toBeLessThanOrEqual(new Date(exp2.dossier).getTime());
    // pending cap: 10 per dossier
    const cap = await newShare(); const orgs = [];
    for (let i = 0; i < 10; i += 1) { const id = `rc5p-cap${i}-${TS}`; orgs.push(id); await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${id}, ${'Cap ' + i}, ${'rc5p-cap-' + i + '-' + TS}, 'association', '1', 'V', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`); await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${'cap-u' + i + '-' + TS}, ${'cap' + i + '-' + TS + '@example.test'}, 'x', ${id}, 'PRO', 'active', NOW(), NOW())`); }
    try {
      for (const id of orgs) expect((await own(cap, 'invite', { structureId: id })).statusCode).toBe(201);
      expect((await own(cap, 'invite', { structureId: SA })).statusCode).toBe(429);
    } finally { const inOrgs = sql.join(orgs.map((o) => sql`${o}`), sql`, `); await db.execute(sql`DELETE FROM "SharedDossierInvite" WHERE "structureId" IN (${inOrgs})`); await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${inOrgs})`); await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${inOrgs})`); }
  });

  it('MEMBERSHIP is checked on EVERY access: departure, deactivation, wrong role and a suspended organization take effect immediately; colleagues and replacements keep working', async () => {
    const s = await newShare(); await grantTo(s, PA1);
    expect((await getDossier(PA2, s)).statusCode).toBe(200);                                                                                      // colleague: organization-wide grant, but only for active members
    expect((await getDossier(PAX, s)).statusCode).toBe(404);                                                                                      // inactive account (staff departure)
    expect((await getDossier(PAV, s)).statusCode).toBe(404);                                                                                      // role not allowed
    const before = await snap(s.id);
    for (const u of [PAX, PAV]) {
      expect((await invoke(H.dossier, { method: 'PATCH', url: `/api/pro/dossier?shareId=${s.id}`, body: { status: 'x' }, headers: pro(u) })).statusCode).toBe(404);
      expect((await invoke(H.msgs, { method: 'POST', url: '/api/secure-messages', body: { shareId: s.id, senderId: 'a', receiverId: 'b', encryptedContent: 'x' }, headers: pro(u) })).statusCode).toBe(404);
      expect((await invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body: { shareId: s.id, originalName: 'x.pdf', mimeType: 'application/pdf', fileBase64: Buffer.from('%PDF').toString('base64') }, headers: pro(u) })).statusCode).toBe(404);
    }
    expect(await snap(s.id)).toEqual(before);
    await db.execute(sql`UPDATE "ProUser" SET status = 'inactive' WHERE id = ${PA2.id}`);                                                          // departure AFTER having worked on the dossier
    expect((await getDossier(PA2, s)).statusCode).toBe(404); expect((await getDossier(PA1, s)).statusCode).toBe(200);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${PA2.id}`);                                                            // reinstated / temporary replacement
    expect((await getDossier(PA2, s)).statusCode).toBe(200);
    await db.execute(sql`UPDATE "Structure" SET statut = 'brouillon' WHERE id = ${SA}`);                                                           // organization suspended
    expect((await getDossier(PA1, s)).statusCode).toBe(404);
    await db.execute(sql`UPDATE "Structure" SET statut = 'actif' WHERE id = ${SA}`);
    expect((await getDossier(PA1, s)).statusCode).toBe(200);
    const mem = await newShare();                                                                                                                 // inactive member cannot even redeem
    expect((await redeem(PAX, mem, await invite(mem, SA))).statusCode).toBe(404);
  });

  it('REMOVE ONE ORGANIZATION: the others are untouched, notes/files stay per organization, a removed organization cannot return with its old invitation, only with a NEW one from the owner', async () => {
    const s = await newShare(); await grantTo(s, PA1); await grantTo(s, PB);
    await invoke(H.dossier, { method: 'PATCH', url: `/api/pro/dossier?shareId=${s.id}`, body: { status: 'A', internalNote: 'note-of-A' }, headers: pro(PA1) });
    await invoke(H.dossier, { method: 'PATCH', url: `/api/pro/dossier?shareId=${s.id}`, body: { status: 'B', internalNote: 'note-of-B' }, headers: pro(PB) });
    expect(JSON.stringify((await getDossier(PA1, s)).body)).not.toContain('note-of-B'); expect(JSON.stringify((await getDossier(PB, s)).body)).not.toContain('note-of-A');
    expect(JSON.stringify((await invoke(H.exp, { url: `/api/pro/dossier/export?shareId=${s.id}&format=json`, headers: pro(PA1) })).body)).not.toContain('note-of-B');
    expect((await own(s, 'revoke', { structureId: SB })).statusCode).toBe(200);
    expect((await getDossier(PB, s)).statusCode).toBe(404); expect((await getDossier(PA1, s)).statusCode).toBe(200);
    expect((await own(s, 'revoke', { structureId: SB })).statusCode).toBe(404);
    const oldInvite = (await db.execute(sql`SELECT id FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${s.id} AND "structureId" = ${SB}`)).rows[0].id; expect(oldInvite).toBeTruthy();
    const fresh = await invite(s, SB);                                                                                                            // owner decides to let B back in
    expect((await getDossier(PB, s)).statusCode).toBe(404);                                                                                       // inviting alone grants nothing
    expect((await redeem(PB, s, fresh)).statusCode).toBe(200); expect((await getDossier(PB, s)).statusCode).toBe(200);
    expect((await snap(s.id)).grants).toBe(`${SA}:true:PURP-06,${SB}:true:PURP-06`);
  });

  it('CONCURRENCY: double redemption by colleagues, redemption racing a revocation, two simultaneous invitations, uploads racing a removal', async () => {
    const s = await newShare(); const t = await invite(s, SA);
    const rs = await Promise.all([redeem(PA1, s, t), redeem(PA2, s, t), redeem(PB, s, t)]);
    expect(rs.map((r) => r.statusCode)).toEqual([200, 200, 404]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${s.id}`)).rows[0].n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${s.id} AND "usedAt" IS NOT NULL`)).rows[0].n).toBe(1);
    const s2 = await newShare();
    const invs = await Promise.all([own(s2, 'invite', { structureId: SB }), own(s2, 'invite', { structureId: SB })]);
    expect(invs.map((r) => r.statusCode).sort()).toSatisfy((c) => c.every((x) => [201, 409].includes(x)) && c.includes(201));
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${s2.id} AND "usedAt" IS NULL AND "revokedAt" IS NULL`)).rows[0].n).toBe(1);   // never two pending
    const body = { shareId: s.id, originalName: 'x.pdf', mimeType: 'application/pdf', fileBase64: Buffer.from('%PDF-1.4 rc5').toString('base64') };
    const raced = await Promise.all([...Array.from({ length: 6 }, () => invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body, headers: pro(PA1) })), own(s, 'revoke', { structureId: SA })]);
    const okUploads = raced.slice(0, 6).filter((r) => r.statusCode === 200).length;
    expect(raced[6].statusCode).toBe(200);
    const stored = (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].results;
    expect((stored._files || []).length).toBe(okUploads);                                                                                         // every accepted upload is recorded, none is recorded after the removal
    const after = await snap(s.id);
    expect((await invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body, headers: pro(PA1) })).statusCode).toBe(404);
    expect(await snap(s.id)).toEqual(after);
  });

  it('PURPOSES: AI (PURP-05) is separate from sharing (PURP-06), granted only by the citizen per organization, revocable at once; a professional cannot grant it; the prompt carries no situation / notes / files', async () => {
    const s = await newShare(); await grantTo(s, PA1); await grantTo(s, PB);
    // R17 overlay, fixture only: the synthesis summarises the dossier's orientation items and refuses an empty dossier without calling the model, so this dossier
    // gets ONE synthetic item (the same contract shape the diagnostic stores). Nothing else of the dossier changes.
    const { buildAssessment } = await import('../../api/lib/assessmentContract.js');
    await db.execute(sql`UPDATE "SharedDiagnostic" SET results = ${JSON.stringify({ assessment: buildAssessment({ answers: { birthDate: '1990-01-01' } }) })}::jsonb WHERE id = ${s.id}`);
    const synth = (u) => invoke(H.synth, { method: 'POST', url: '/api/pro/dossier-synthesis', body: { shareId: s.id }, headers: pro(u) });
    spies.ai = 0; spies.prompts.length = 0;
    expect((await synth(PA1)).statusCode).toBe(403);                                                                                              // sharing alone never unlocks the external provider
    const proConsent = (purposes) => invoke(H.consent, { method: 'POST', url: '/api/pro/consent', body: { shareId: s.id, signatureData: 'data:image/png;base64,AAAA', purposes }, headers: pro(PA1) });
    expect((await proConsent(['PURP-05'])).statusCode).toBe(400); expect((await proConsent(['PURP-99'])).statusCode).toBe(400);                    // a professional cannot grant AI
    expect((await proConsent(['PURP-06'])).statusCode).toBe(200); expect((await synth(PA1)).statusCode).toBe(403);                                // nor does an in-person sharing confirmation
    expect(spies.ai).toBe(0);
    await invoke(H.dossier, { method: 'PATCH', url: `/api/pro/dossier?shareId=${s.id}`, body: { status: 'S', internalNote: 'private-note-B' }, headers: pro(PB) });
    expect((await own(s, 'set_purposes', { structureId: SA, purposes: ['PURP-99'] })).statusCode).toBe(400);
    expect((await own(s, 'set_purposes', { structureId: SC, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(404);                           // an organization without a grant cannot be given AI
    expect((await own(s, 'set_purposes', { structureId: SA, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);
    expect((await synth(PA1)).statusCode).toBe(200); expect(spies.ai).toBe(1);
    expect((await synth(PB)).statusCode).toBe(403);                                                                                               // per organization: B was not authorized
    const prompt = spies.prompts[0];
    expect(prompt).not.toContain('SECRET_SITUATION_MARKER'); expect(prompt).not.toContain('private-note-B'); expect(prompt).not.toContain('_files'); expect(prompt).not.toContain('signatureHash');
    expect((await getDossier(PA1, s)).body.access.purposes.sort()).toEqual(['PURP-05', 'PURP-06']);
    expect((await own(s, 'set_purposes', { structureId: SA, purposes: ['PURP-06'] })).statusCode).toBe(200);                                       // withdrawal is immediate
    expect((await synth(PA1)).statusCode).toBe(403); expect(spies.ai).toBe(1);
    await own(s, 'set_purposes', { structureId: SA, purposes: ['PURP-06', 'PURP-05'] }); await own(s, 'revoke', { structureId: SA });              // removing the organization ends AI too
    expect((await synth(PA1)).statusCode).toBe(404); expect(spies.ai).toBe(1);
    expect(spies.gemini || 0, 'R17 overlay: never the external provider').toBe(0); expect(spies.providers).toEqual([['ollama', null, false]]);   // local only, no fallback
  });

  it('LEGACY (pre-RC5) rows: a link is never ownership; the transitional read / redeem path is flag-gated and non-destructive', async () => {
    const id = `rc5p-legacy-${TS}`, link = crypto.randomBytes(32).toString('base64url'); created.push(id);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "subjectType") VALUES (${id}, NOW() + interval '2 days', '{"k":1}'::jsonb, '{"legacy":true}'::jsonb, 0, ${sha(link)}, 'GUEST_SHARE')`);
    const s = { id, token: link, owner: link };
    const before = await snap(id);
    process.env.ADA_LEGACY_SHARE_READ = '1';                                                                                                       // the compatibility path, explicitly on (off by default)
    for (const a of [() => invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: id, rightsSecret: link } }), () => invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: id, capability: link } }),
      () => own(s, 'stop_sharing'), () => own(s, 'invite', { structureId: SA }), () => own(s, 'list'), () => invoke(H.passport, { url: `/api/public/passport?shareId=${id}`, headers: { 'x-share-owner-secret': link } }),
      () => invoke(H.shareThread, { method: 'POST', url: '/api/share/thread', body: { id, capability: link, action: 'list' } })]) expect((await a()).statusCode).toBe(404);
    expect(await snap(id)).toEqual(before);                                                                                                       // the link could not destroy or alter anything
    expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id, capability: link } })).statusCode).toBe(200);                // existing data stays readable (no silent loss)
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: id, shareToken: link }, headers: pro(PA1) })).statusCode).toBe(200);
    expect((await db.execute(sql`SELECT "grantedVia" AS v FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${id}`)).rows[0].v).toBe('legacy_link');
    expect((await getDossier(PA1, s)).statusCode).toBe(200); expect((await getDossier(PB, s)).statusCode).toBe(404);
    process.env.ADA_LEGACY_SHARE_READ = '0';                                                                                                       // migration gate passed: the compatibility path is removed
    try {
      expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id, capability: link } })).statusCode).toBe(404);
      expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: id, shareToken: link }, headers: pro(PC) })).statusCode).toBe(404);
    } finally { delete process.env.ADA_LEGACY_SHARE_READ; }
    expect((await invoke(H.get, { method: 'POST', url: '/api/share/get', body: { id, capability: link } })).statusCode).toBe(404);                // default: off
    // RC5 rows are not affected by the flag and never accept a bare link for redemption
    const n = await newShare(); expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: n.id, shareToken: n.token }, headers: pro(PA1) })).statusCode).toBe(404);
  });

  it('ORGANIZATION SEARCH is owner-only, minimal, and limited to verified organizations with an active member; LIKE wildcards are literal', async () => {
    const s = await newShare();
    expect((await invoke(H.grants, { method: 'POST', url: '/api/public/dossier-grants', body: { shareId: s.id, action: 'find_organizations', q: 'CCAS' } })).statusCode).toBe(404);
    const r = await own(s, 'find_organizations', { q: 'CCAS Rc5p' }); expect(r.statusCode).toBe(200);
    const ids = r.body.organizations.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([SA, SB, SC])); expect(ids).not.toContain(SD); expect(ids).not.toContain(SX);                       // suspended / nobody to receive
    for (const o of r.body.organizations) expect(Object.keys(o).sort()).toEqual(['codePostal', 'id', 'nom', 'ville']);                             // no member, e-mail or internal data
    expect((await own(s, 'find_organizations', { q: 'C' })).body.organizations).toEqual([]);
    expect((await own(s, 'find_organizations', { q: '%%' })).body.organizations).toEqual([]);                                                       // '%' is not a wildcard
    expect((await own(s, 'find_organizations', { q: 'CCAS Rc5p' })).body.organizations.length).toBeLessThanOrEqual(8);
  });

  it('CRYPTO: messages are stored with an envelope-v2 data key bound to their thread; a ciphertext copied to another thread fails closed; legacy v1 rows stay readable; key rotation re-wraps without touching payloads', async () => {
    const s = await newShare(); await grantTo(s, PA1);
    const W = { senderId: 'x', receiverId: 'y' };
    expect((await invoke(H.msgs, { method: 'POST', url: '/api/secure-messages', body: { shareId: s.id, ...W, encryptedContent: 'blob-one' }, headers: pro(PA1) })).statusCode).toBe(201);
    const row = (await db.execute(sql`SELECT m.id, m.body, m."threadId" FROM "SharedDossierMessage" m JOIN "SharedDossierThread" t ON t.id = m."threadId" WHERE t."sharedDiagnosticId" = ${s.id}`)).rows[0];
    expect(row.body).toMatch(/^v2:[0-9a-f]{8}:m:/); expect(row.body).not.toContain('blob-one'); expect(dk.openText(row.body, { purpose: 'dossier-message', context: `thread:${row.threadId}` })).toBe('blob-one');
    expect((await invoke(H.msgs, { url: `/api/secure-messages?shareId=${s.id}`, headers: pro(PA1) })).body.items.map((i) => i.encryptedContent)).toEqual(['blob-one']);
    const s2 = await newShare(); await grantTo(s2, PA1);
    await invoke(H.msgs, { method: 'POST', url: '/api/secure-messages', body: { shareId: s2.id, ...W, encryptedContent: 'other' }, headers: pro(PA1) });
    const t2 = (await db.execute(sql`SELECT id FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${s2.id}`)).rows[0].id;
    await db.execute(sql`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", "senderProUserId", body) VALUES (${`rc5p-swap-${TS}`}, ${t2}, 'PRO', ${PA1.id}, ${row.body})`);   // ciphertext of thread 1 planted in thread 2
    const swapped = await invoke(H.msgs, { url: `/api/secure-messages?shareId=${s2.id}`, headers: pro(PA1) });
    expect(swapped.statusCode).toBe(500); expect(JSON.stringify(swapped.body)).not.toContain('blob-one');                                           // fails closed, no plaintext
    await db.execute(sql`DELETE FROM "SharedDossierMessage" WHERE id = ${`rc5p-swap-${TS}`}`);
    await db.execute(sql`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", "senderProUserId", body) VALUES (${`rc5p-v1-${TS}`}, ${t2}, 'PRO', ${PA1.id}, ${legacyCrypto.encrypt('ancien-v1')})`);
    expect((await invoke(H.msgs, { url: `/api/secure-messages?shareId=${s2.id}`, headers: pro(PA1) })).body.items.map((i) => i.encryptedContent)).toEqual(['other', 'ancien-v1']);
    // rotation
    const savedKey = process.env.ADA_ENCRYPTION_KEY, savedPrev = process.env.ADA_ENCRYPTION_KEY_PREVIOUS;
    try {
      process.env.ADA_ENCRYPTION_KEY = '33'.repeat(32); process.env.ADA_ENCRYPTION_KEY_PREVIOUS = savedKey;
      const dry = await keyRotation.rewrapMessages({ apply: false }); expect(dry.needing).toBeGreaterThanOrEqual(2); expect(dry.updated).toBe(0);
      expect((await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE id = ${row.id}`)).rows[0].body).toBe(row.body);                    // dry-run changes nothing
      const run = await keyRotation.rewrapMessages({ apply: true }); expect(run.failed).toBe(0); expect(run.updated).toBe(run.needing);
      const moved = (await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE id = ${row.id}`)).rows[0].body;
      expect(moved.split(':')[1]).toBe(dk.currentKeyId()); expect(moved.split(':')[4]).toBe(row.body.split(':')[4]);                                  // payload untouched, data key re-wrapped
      expect((await keyRotation.rewrapMessages({ apply: true })).needing).toBe(0);
      delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS;                                                                                              // old key retired: still readable
      expect((await invoke(H.msgs, { url: `/api/secure-messages?shareId=${s.id}`, headers: pro(PA1) })).body.items.map((i) => i.encryptedContent)).toEqual(['blob-one']);
    } finally { process.env.ADA_ENCRYPTION_KEY = savedKey; if (savedPrev === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = savedPrev; }
    void threadsSvc;
  });

  it('AUDIT and SECRET HYGIENE: invitation / grant / revocation / purpose changes are audited and no secret, token or situation ever lands in the audit trail', async () => {
    const s = await newShare(); const t = await invite(s, SA); await redeem(PA1, s, t); await own(s, 'set_purposes', { structureId: SA, purposes: ['PURP-06', 'PURP-05'] }); await own(s, 'revoke', { structureId: SA });
    const rows = (await db.execute(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE details->>'shareId' = ${s.id}`)).rows;
    expect(rows.map((r) => r.action).sort()).toEqual(expect.arrayContaining(['DOSSIER_ACCESS_GRANTED', 'DOSSIER_ACCESS_REVOKED_BY_OWNER', 'DOSSIER_INVITE_CREATED', 'DOSSIER_PURPOSES_CHANGED_BY_OWNER']));
    for (const r of rows) for (const secret of [t, s.owner, s.token, 'SECRET_SITUATION_MARKER']) expect(r.d).not.toContain(secret);
  });
});
