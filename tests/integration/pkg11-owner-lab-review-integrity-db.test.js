/**
 * Owner LAB audit (2026-10-24) on REAL PostgreSQL — human review workflows are bound to what the reviewer actually read, and journalised:
 *  - D-5 verification: an approval (VERIFY) or a release (RELEASE_HOLD) carries the version of the content read (sha-256 of every public field); a record changed
 *    in between is refused (409 STALE_REVIEW); a release states its reason; the ledger keeps the version decided on and the decision is in the journal;
 *  - an accepted structure proposal is bound to the live value (a record changed since the proposal is refused, the proposal stays pending);
 *  - RGPD art. 18(3): a restriction is not lifted when the prior notice could not be delivered;
 *  - content-report triage is journalised; a catalogue save bound to the version loaded is refused after a concurrent change;
 *  - a break-glass review shows what was done during the window, and the yearly purge never drops an unreviewed break-glass.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ID = { aide: `ri-aide-${TS}`, st: `ri-st-${TS}`, pro: `ri-pro-${TS}`, cit: `ri-cit-${TS}`, report: `ri-rep-${TS}`, bg: `ri-bg-${TS}`, bgOld: `ri-bgold-${TS}`, old: `ri-old-${TS}` };
const ADMIN = `ri-admin-${TS}@example.test`; const SRC = 'https://www.service-public.fr/particuliers/vosdroits/F12006';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; } });

describe.skipIf(!hasDatabase)('owner LAB review integrity (real DB)', () => {
  let db, auth, verifyHandler, reportsHandler, purge, proposals, restriction, adminContent, ident;
  const bearer = () => `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true })}`;
  const verification = async (method, { query = {}, body } = {}) => { const r = mk(); await verifyHandler({ method, url: '/api/admin/content-verification', query, body, headers: { host: 'localhost', authorization: bearer() } }, r); return r; };
  const one = async (q) => (await db.execute(q)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); verifyHandler = (await import('../../api/_handlers/admin/content-verification.js')).default;
    reportsHandler = (await import('../../api/_handlers/reports.js')).default; purge = (await import('../../api/_handlers/cron/gdpr-purge.js')).default;
    proposals = await import('../../api/_services/structure-proposals.js'); restriction = await import('../../api/_services/processing-restriction.js');
    adminContent = await import('../../api/_services/admin-content.js'); ident = await import('../../api/_services/admin-identity.js');
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, data_origin, cest_quoi, "updatedAt") VALUES (${ID.aide}, ${ID.aide}, 'Aide relue', 'publie', 'official', 'Une aide pour payer le loyer.', NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, telephone, "updatedAt", "createdAt")
      VALUES (${ID.st}, 'Org relue', ${ID.st}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', '03 88 00 00 01', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${ID.pro}, ${ID.pro + '@example.test'}, 'x', 'STRUCTURE_ADMIN', 'active', ${ID.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID.cit}, ${ID.cit + '@example.test'}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ContentReport" (id, "contentType", "contentId", reason, status, "updatedAt") VALUES (${ID.report}, 'AIDE', ${ID.aide}, 'AUTRE', 'NEW', NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    for (const q of [sql`DELETE FROM "StructureProposal" WHERE "structureId" = ${ID.st}`, sql`DELETE FROM "ProUser" WHERE id = ${ID.pro}`, sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${ID.aide}, ${ID.st})`,
      sql`DELETE FROM "Structure" WHERE id = ${ID.st}`, sql`DELETE FROM "Aide" WHERE id = ${ID.aide}`, sql`DELETE FROM "ContentReport" WHERE id = ${ID.report}`,
      sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${ID.cit}`, sql`DELETE FROM "CitizenUser" WHERE id = ${ID.cit}`,
      sql`DELETE FROM "AuditLog" WHERE entity_id IN (${ID.bg}, ${ID.bgOld}, ${ID.old}) OR actor = 'ri-bg-actor@example.test'`]) await db.execute(q).catch(() => {});
  });

  it('D-5: a VERIFY is bound to the content read; a release states its reason; the ledger keeps the version; the decision is journalised', async () => {
    const read = await verification('GET', { query: { entityType: 'aide', entityId: ID.aide } });
    expect(read.statusCode).toBe(200); expect(read.body.version).toMatch(/^[0-9a-f]{64}$/);
    expect(read.body.content.map((c) => c.field)).toEqual(expect.arrayContaining(['titre', 'cest_quoi']));
    const v = { entityType: 'aide', entityId: ID.aide, action: 'VERIFY', sourceUrl: SRC, evidenceNote: 'Fiche comparée à la page officielle, ligne à ligne.', territoryConfirmed: true };
    expect((await verification('POST', { body: v })).body.error, 'no version, no approval').toBe('VERSION_REQUIRED');
    await db.execute(sql`UPDATE "Aide" SET cest_quoi = 'Texte changé après la lecture.' WHERE id = ${ID.aide}`);
    const stale = await verification('POST', { body: { ...v, expectedVersion: read.body.version } });
    expect([stale.statusCode, stale.body.error], 'the content changed after it was read').toEqual([409, 'STALE_REVIEW']);
    const reread = await verification('GET', { query: { entityType: 'aide', entityId: ID.aide } });
    expect(reread.body.version).not.toBe(read.body.version);
    expect((await verification('POST', { body: { ...v, expectedVersion: reread.body.version } })).statusCode).toBe(200);
    expect(await one(sql`SELECT "contentVersion" AS v, outcome FROM "ContentVerification" WHERE "entityId" = ${ID.aide} ORDER BY "createdAt" DESC LIMIT 1`)).toEqual({ v: reread.body.version, outcome: 'VERIFIED' });
    expect((await one(sql`SELECT details->>'contentVersion' AS v FROM "AuditLog" WHERE action = 'CONTENT_VERIFIED' AND entity_id = ${ID.aide}`)).v).toBe(reread.body.version);
    expect((await verification('POST', { body: { entityType: 'aide', entityId: ID.aide, action: 'HOLD', holdReason: 'Montant à confirmer.' } })).statusCode).toBe(200);
    const held = await verification('GET', { query: { entityType: 'aide', entityId: ID.aide } });
    expect((await verification('POST', { body: { entityType: 'aide', entityId: ID.aide, action: 'RELEASE_HOLD', expectedVersion: held.body.version } })).body.error, 'a release says why').toBe('RELEASE_REASON_REQUIRED');
    expect((await verification('POST', { body: { entityType: 'aide', entityId: ID.aide, action: 'RELEASE_HOLD', expectedVersion: held.body.version, evidenceNote: 'Montant confirmé par la CAF.' } })).statusCode).toBe(200);
  });

  it('an accepted proposal is bound to the live value: a record changed since the proposal is refused and the proposal stays pending', async () => {
    const ctx = { userId: ID.pro, structureId: ID.st, role: 'STRUCTURE_ADMIN' };
    const p = await proposals.propose({ field: 'telephone', value: '03 88 00 00 02' }, ctx); expect(p.ok, JSON.stringify(p)).toBe(true);
    await db.execute(sql`UPDATE "Structure" SET telephone = '03 88 00 00 09' WHERE id = ${ID.st}`);   // another change after the proposal
    const out = await proposals.decide(p.proposal.id, 'ACCEPT', '', ADMIN, undefined, { sourceUrl: SRC });
    expect([out.status, out.code]).toEqual([409, 'changed_since_proposal']);
    expect((await one(sql`SELECT status FROM "StructureProposal" WHERE id = ${p.proposal.id}`)).status).toBe('PENDING');
    expect((await one(sql`SELECT telephone FROM "Structure" WHERE id = ${ID.st}`)).telephone).toBe('03 88 00 00 09');
    expect((await proposals.decide(p.proposal.id, 'REJECT', 'La fiche a changé depuis la proposition.', ADMIN)).ok).toBe(true);
  });

  it('RGPD art. 18(3): a restriction is not lifted when the prior notice could not be delivered', async () => {
    const r = await restriction.requestRestriction(ID.cit, { ground: 'ACCURACY_CONTESTED' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const refused = await restriction.liftByController(r.restriction.id, { reason: 'Exactitude vérifiée avec la personne.' }, ADMIN, undefined, { sendMail: async () => ({ outcome: 'REJECTED' }) });
    expect([refused.status, refused.code]).toEqual([503, 'notice_not_delivered']);
    expect((await one(sql`SELECT status FROM "DSRRequest" WHERE id = ${r.restriction.id}`)).status).toBe('ACTIVE');
    expect((await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'PROCESSING_RESTRICTION_LIFT_REFUSED' AND entity_id = ${r.restriction.id}`)).n).toBe(1);
    const lifted = await restriction.liftByController(r.restriction.id, { reason: 'Exactitude vérifiée avec la personne.' }, ADMIN, undefined, { sendMail: async () => ({ outcome: 'PROVIDER_ACCEPTED' }) });
    expect([lifted.ok, lifted.notice]).toEqual([true, 'PROVIDER_ACCEPTED']);
  });

  it('content-report triage is journalised; a catalogue save bound to the version loaded is refused after a concurrent change', async () => {
    const r = mk(); await reportsHandler({ method: 'PUT', url: `/api/reports?id=${ID.report}`, query: { id: ID.report }, body: { status: 'FIXED', note: 'Montant corrigé.' }, headers: { host: 'localhost', authorization: bearer() } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(await one(sql`SELECT actor, details->>'from' AS f, details->>'to' AS t FROM "AuditLog" WHERE action = 'CONTENT_REPORT_FIXED' AND entity_id = ${ID.report}`)).toEqual({ actor: ADMIN, f: 'NEW', t: 'FIXED' });
    const loaded = await adminContent.readContent('aide', ID.aide);
    await adminContent.updateContent('aide', ID.aide, { pour_qui: 'Changement d’un autre administrateur.' }, 'other-admin@example.test');
    const conflict = await adminContent.updateContent('aide', ID.aide, { pour_qui: 'Mon changement.', expectedVersion: loaded.version }, ADMIN);
    expect([conflict.status, conflict.code]).toEqual([409, 'EDIT_CONFLICT']);
    const fresh = await adminContent.readContent('aide', ID.aide);
    expect((await adminContent.updateContent('aide', ID.aide, { pour_qui: 'Mon changement.', expectedVersion: fresh.version }, ADMIN)).ok).toBe(true);
  });

  it('a break-glass review shows what was done during the window; the yearly purge keeps an unreviewed break-glass', async () => {
    const actor = 'ri-bg-actor@example.test'; const until = new Date(Date.now() + 30 * 60000).toISOString();
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES (${crypto.randomUUID()}, 'BREAK_GLASS_OPENED', ${actor}, ${actor}, 'AdminElevation', ${ID.bg}, ${JSON.stringify({ reason: 'Urgence synthétique', until })}::jsonb)`);
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES (${crypto.randomUUID()}, 'ORGANIZATION_SUSPENDED', ${actor}, ${actor}, 'STRUCTURE', ${ID.st}, '{}'::jsonb)`);
    const pending = (await ident.pendingBreakGlass()).find((x) => x.id === ID.bg);
    expect(pending.actions.map((a) => a.action)).toContain('ORGANIZATION_SUSPENDED');
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details, "timestamp") VALUES (${crypto.randomUUID()}, 'BREAK_GLASS_OPENED', ${actor}, ${actor}, 'AdminElevation', ${ID.bgOld}, '{}'::jsonb, NOW() - interval '400 days')`);
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details, "timestamp") VALUES (${crypto.randomUUID()}, 'ADMIN_API_WRITE', ${actor}, ${actor}, 'Aide', ${ID.old}, '{}'::jsonb, NOW() - interval '400 days')`);
    const res = mk(); await purge({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect((await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE entity_id = ${ID.bgOld}`)).n, 'unreviewed break-glass kept').toBe(1);
    expect((await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE entity_id = ${ID.old}`)).n, 'an ordinary old entry purged').toBe(0);
  });
});
