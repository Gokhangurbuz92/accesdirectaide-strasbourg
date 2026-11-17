/**
 * M2 — referral redirect (G3), follow-up / next action (G4 G5) and « référent de parcours » (G5) on REAL PostgreSQL (migration 0047), through the real
 * handlers, with synthetic organizations only: X (sender: admin, x1, x2) · Y, Z, W (verified receivers) · U (not verified).
 *   redirect   a receiver that declines may suggest another organization; NOTHING reaches that organization; the sender and the person are told; the new
 *              referral needs the person's own authorization, is linked (previousReferralId), idempotent, audited; the chain is shown only to the
 *              organizations that are a party to each referral (the earlier receiver's texts never reach the next one)
 *   consent    the person withdrawing the sender's access (or stopping sharing) cancels a redirect that still waits for their answer
 *   follow-up  the person's view names the next action; a step without progress is flagged and one notice asks a human to follow up
 *   référent   a named contact person, proposed by a professional who holds access, effective only with the person's agreement, ended by the person at any
 *              time, shown to the person and to organizations holding a grant — and the record opens NOTHING (404 exactly as without it)
 * Skipped without DATABASE_URL, and on a database without migration 0047 (that case is tests/integration/m2-pre0047-compat-db.test.js).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quota = infrastructure, not under test
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { X: `m2-X-${TS}`, Y: `m2-Y-${TS}`, Z: `m2-Z-${TS}`, W: `m2-W-${TS}`, U: `m2-U-${TS}` };
const P = { admin: { id: `m2-adm-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `m2-x1-${TS}`, st: S.X, role: 'PRO' }, x2: { id: `m2-x2-${TS}`, st: S.X, role: 'PRO' },
  y: { id: `m2-y-${TS}`, st: S.Y, role: 'PRO' }, z: { id: `m2-z-${TS}`, st: S.Z, role: 'PRO' }, w: { id: `m2-w-${TS}`, st: S.W, role: 'PRO' }, u: { id: `m2-u-${TS}`, st: S.U, role: 'PRO' } };
const CIT = { id: `m2-cit-${TS}`, email: `m2-cit-${TS}@example.test` };
const OTHER = { id: `m2-other-${TS}`, email: `m2-other-${TS}@example.test` };
const DOSSIER = `m2-dos-${TS}`; const FOREIGN = `m2-foreign-${TS}`;
const SECRET_NOTE = `note-confidentielle-de-Y-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('M2 — redirect, follow-up and référent de parcours (real DB, migration 0047)', () => {
  let db, auth, userAuth, H, mailer, migrated = false;
  let caseId, foreignCaseId;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const citAs = async (who, h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: who.id, email: who.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const cit = (h, o) => citAs(CIT, h, o);
  const ref = (p, body) => pro(H.refs, p, { method: 'POST', body });
  const dossierOf = (p, shareId = DOSSIER) => pro(H.dossier, p, { query: { shareId }, url: `/api/pro/dossier?shareId=${encodeURIComponent(shareId)}` });
  /** an organization notice is stored once per active member: X has three members (admin, x1, x2), the others one */
  const X_MEMBERS = 3;
  const one = (p, id) => pro(H.refs, p, { query: { id } });
  const box = async (p, name, id) => (await pro(H.refs, p, { query: { box: name } })).body.referrals.find((r) => r.id === id);
  const decide = (id, decision = 'accept') => cit(H.citRefs, { method: 'POST', body: { id, decision } });
  const mine = async (id) => (await cit(H.citRefs)).body.referrals.find((r) => r.id === id);
  const owner = (action, extra = {}) => cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action, ...extra } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const trail = async (id) => (await db.execute(sql`SELECT "actorType" AS actor, "fromStatus" AS "from", "toStatus" AS "to" FROM "ReferralEvent" WHERE "referralId" = ${id} ORDER BY "createdAt"`)).rows;
  const grantActive = async (st) => (await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${st} AND "revokedAt" IS NULL`)).rows[0].n;
  const noticesOf = async (st) => (await db.execute(sql`SELECT type, title, message, metadata FROM "ProNotification" WHERE "structureId" = ${st}`)).rows;
  const notices = async (st, type, id) => (await noticesOf(st)).filter((n) => n.type === type && n.metadata?.referralId === id);
  const audits = async (action, id) => (await db.execute(sql`SELECT details, actor_id FROM "AuditLog" WHERE action = ${action} AND entity_id = ${id} ORDER BY timestamp`)).rows;
  const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);
  const cron = async () => { const r = mk(); await H.cron({ method: 'GET', url: '/api/cron/referral-timeouts', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); expect(r.statusCode, JSON.stringify(r.body)).toBe(200); return r.body; };
  /** fixture reset between scenarios: every live referral of the dossier is ended directly, the sender's access is (re)opened */
  const reset = async () => {
    await db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NULL WHERE id = ${'g-' + DOSSIER}`);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND id <> ${'g-' + DOSSIER} AND "revokedAt" IS NULL`);
  };
  const propose = async (to, extra = {}, by = P.x1) => { const p = await ref(by, { action: 'propose', caseId, toStructureId: to, reasonCode: 'HOUSING', ...extra }); expect(p.statusCode, JSON.stringify(p.body)).toBe(201); return p.body.referral.id; };
  const sent = async (to, extra) => { const id = await propose(to, extra); expect((await decide(id)).statusCode).toBe(200); return id; };
  const declineTo = async (id, by, suggested, message) => ref(by, { action: 'decline', id, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId: suggested, ...(message ? { message } : {}) });
  // référent helpers
  const caseOf = async (p, id = caseId) => pro(H.cases, p, { query: { id } });
  const volunteer = (p, extra = {}, id = caseId) => pro(H.cases, p, { method: 'POST', body: { action: 'referent_volunteer', id, displayName: 'Camille (test)', displayNameConsent: true, ...extra } });
  const referentView = (who = CIT, shareId = DOSSIER) => citAs(who, H.citDossier, { query: { shareId, view: 'referent' } });
  const referentDecide = (accept, who = CIT, shareId = DOSSIER) => citAs(who, H.citDossier, { method: 'POST', body: { action: 'referent_decide', shareId, accept } });
  const referentEnd = (who = CIT, shareId = DOSSIER) => citAs(who, H.citDossier, { method: 'POST', body: { action: 'referent_end', shareId } });
  const referentRows = async (dossier = DOSSIER) => (await db.execute(sql`SELECT * FROM "DossierReferent" WHERE "sharedDiagnosticId" = ${dossier} ORDER BY "createdAt"`)).rows;
  const referentTrail = async (id) => (await db.execute(sql`SELECT "actorType" AS actor, "fromStatus" AS "from", "toStatus" AS "to", reason FROM "DossierReferentEvent" WHERE "referentId" = ${id} ORDER BY "createdAt"`)).rows;
  const clearReferents = () => db.execute(sql`DELETE FROM "DossierReferent" WHERE "sharedDiagnosticId" IN (${DOSSIER}, ${FOREIGN})`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    migrated = (await (await import('../../api/_utils/schema-features.js')).readReferralChainSchema(db)).chain;
    if (!migrated) return;
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default, team: (await import('../../api/_handlers/pro/team.js')).default,
      dossier: (await import('../../api/_handlers/pro/dossier.js')).default, citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default,
      citDossier: (await import('../../api/_handlers/citizen/dossier.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      cron: (await import('../../api/_handlers/cron/referral-timeouts.js')).default };
    for (const id of Object.values(S)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org test ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${id === S.U ? 'PENDING' : 'VERIFIED'}, NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    for (const c of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const [id, own] of [[DOSSIER, CIT.id], [FOREIGN, OTHER.id]]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + id}, ${'t' + id}, 'GUEST_SHARE', ${own})`);
      await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g-' + id}, ${id}, ${S.X}, ${P.x1.id}, 'invite')`);
    }
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    const queue = (await pro(H.cases, P.x1, { query: { scope: 'unassigned' } })).body.cases;
    caseId = queue.find((c) => c.dossierId === DOSSIER).id; foreignCaseId = queue.find((c) => c.dossierId === FOREIGN).id;
    expect((await pro(H.cases, P.admin, { method: 'POST', body: { action: 'assign', id: caseId, userId: P.x1.id } })).statusCode).toBe(200);
  }, 60000);
  afterAll(async () => {
    if (!db || !migrated) return;
    const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' IN (${DOSSIER}, ${FOREIGN})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (SELECT id FROM "Referral" WHERE "sharedDiagnosticId" IN (${DOSSIER}, ${FOREIGN}))`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'DossierReferent' AND entity_id IN (SELECT id FROM "DossierReferent" WHERE "sharedDiagnosticId" IN (${DOSSIER}, ${FOREIGN}))`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOSSIER}, ${FOREIGN})`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${CIT.id}, ${OTHER.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${CIT.id}, ${OTHER.id})`);
  });
  const needs = (t) => { if (!migrated) t.skip(); };

  // ───────────────────────────── redirect (G3) ─────────────────────────────
  it('redirect: a suggestion must be an organization that can receive — never the sender, the receiver itself, an unverified one, or a suggestion under another motive', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    for (const bad of [undefined, '', S.X, S.Y, S.U, `m2-none-${TS}`]) {
      const r = await declineTo(a, P.y, bad);
      expect([r.statusCode, r.body.error], String(bad)).toEqual([400, 'INVALID_SUGGESTION']);
    }
    const mixed = await ref(P.y, { action: 'decline', id: a, responseCode: 'NO_CAPACITY', suggestedStructureId: S.Z });
    expect([mixed.statusCode, mixed.body.error]).toEqual([400, 'INVALID_SUGGESTION']);
    // a stranger cannot decline (nor learn the referral exists), the sender cannot « decline » its own referral
    expect((await declineTo(a, P.w, S.Z)).statusCode).toBe(404);
    expect((await declineTo(a, P.x1, S.Z)).statusCode).toBe(400);
    expect((await row(a)).status).toBe('SENT');
    expect((await row(a)).suggestedStructureId).toBeNull();
  });

  it('redirect: declining with a suggestion discloses NOTHING to the suggested organization; the sender and the person are told; one audited, idempotent step', async (t) => {
    needs(t); await reset(); mailer.__clearTestOutbox();
    const a = await sent(S.Y);
    const zBefore = (await noticesOf(S.Z)).length;
    const d = await declineTo(a, P.y, S.Z, SECRET_NOTE);
    expect(d.statusCode, JSON.stringify(d.body)).toBe(200);
    const r = await row(a);
    expect([r.status, r.responseCode, r.suggestedStructureId]).toEqual(['DECLINED', 'REDIRECT_SUGGESTED', S.Z]);
    expect(await grantActive(S.Y)).toBe(0);   // exactly as a plain decline: the declining organization loses the access this referral gave
    // the suggested organization: no notice, no access, no referral, not even its existence
    expect((await noticesOf(S.Z)).length).toBe(zBefore);
    expect(await grantActive(S.Z)).toBe(0);
    expect(await box(P.z, 'inbox', a)).toBeUndefined();
    expect((await one(P.z, a)).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "toStructureId" = ${S.Z} AND status NOT IN ('CANCELLED')`)).rows[0].n).toBe(0);
    // the sender is told (in-app, the referral id only — no name, no text)
    const told = await notices(S.X, 'referral_declined', a);
    expect(told.length).toBe(X_MEMBERS);
    expect(told[0].title).toMatch(/suggérée/);
    expect(JSON.stringify(told)).not.toContain(SECRET_NOTE);
    // the person is told: one e-mail without the receiver's text, a recorded notice
    const mails = toCit().filter((m) => /n’a pas été acceptée/.test(m.subject));
    expect(mails.length).toBe(1);
    expect(mails[0].text).toMatch(/suggère une autre structure/);
    expect(mails[0].text).toMatch(/Rien n’est transmis/);
    expect(mails[0].text).not.toContain(SECRET_NOTE);
    // audit trail: the append-only event and one audit line (identifiers only)
    expect((await trail(a)).at(-1)).toEqual({ actor: 'RECEIVER', from: 'SENT', to: 'DECLINED' });
    const audit = await audits('REFERRAL_REDIRECT_SUGGESTED', a);
    expect(audit.length).toBe(1);
    expect(audit[0].details).toMatchObject({ suggestedStructureId: S.Z, byStructureId: S.Y });
    expect(JSON.stringify(audit)).not.toContain(SECRET_NOTE);
    // replay / double click: refused, nothing is written twice
    expect((await declineTo(a, P.y, S.W)).statusCode).toBe(409);
    expect((await row(a)).suggestedStructureId).toBe(S.Z);
    expect((await audits('REFERRAL_REDIRECT_SUGGESTED', a)).length).toBe(1);
    expect((await notices(S.X, 'referral_declined', a)).length).toBe(X_MEMBERS);
    // who sees the suggestion: both parties of THIS referral and the person
    const sender = (await one(P.x1, a)).body.referral;
    expect(sender.suggested).toEqual({ id: S.Z, name: 'Org test Z' });
    expect(sender.canProposeSuggested).toBe(true);
    expect(sender.nextAction).toMatchObject({ code: 'SENDER_PROPOSE_SUGGESTED', by: 'SENDER' });
    expect((await one(P.y, a)).body.referral.suggested).toEqual({ id: S.Z, name: 'Org test Z' });
    const person = await mine(a);
    expect(person.suggested).toBe('Org test Z');
    expect(person.nextAction).toMatchObject({ code: 'SENDER_PROPOSE_SUGGESTED', by: 'SENDER' });
    expect(JSON.stringify(person)).not.toContain(SECRET_NOTE);
  });

  it('redirect: the new referral is the sender’s own decision, linked to the declined one, authorized by the person only — tenant-filtered and idempotent', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    expect((await declineTo(a, P.y, S.Z, SECRET_NOTE)).statusCode).toBe(200);
    // the link must be a referral of THIS dossier and THIS sending organization that ended without support
    const foreign = (await ref(P.x1, { action: 'propose', caseId: foreignCaseId, toStructureId: S.Y, reasonCode: 'HOUSING' })).body.referral.id;
    const live = await propose(S.W);
    for (const prev of [`m2-none-${TS}`, foreign, live]) {
      const r = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: prev });
      expect([r.statusCode, r.body.error], prev).toEqual([400, 'INVALID_PREVIOUS']);
    }
    expect((await ref(P.x1, { action: 'cancel', id: live })).statusCode).toBe(200);
    // another organization cannot propose on this case, with or without the link (it has no case here)
    for (const p of [P.y, P.z, P.w]) expect((await ref(p, { action: 'propose', caseId, toStructureId: S.Z === p.st ? S.W : S.Z, reasonCode: 'HOUSING', previousReferralId: a })).statusCode).toBe(404);
    // a colleague of the sender without access to the case (assigned to x1) cannot either
    expect((await ref(P.x2, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: a })).statusCode).toBe(404);
    const zBefore = (await noticesOf(S.Z)).length;
    const first = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: a, idempotencyKey: `m2-k-${TS}` });
    expect(first.statusCode, JSON.stringify(first.body)).toBe(201);
    const b = first.body.referral.id;
    expect(await row(b)).toMatchObject({ status: 'PENDING_CITIZEN', previousReferralId: a, toStructureId: S.Z });
    // same key: the same referral, nothing new; another follow-up of the same declined referral: refused while this one is live
    const replay = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: a, idempotencyKey: `m2-k-${TS}` });
    expect([replay.statusCode, replay.body.referral.id]).toEqual([200, b]);
    const fork = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.W, reasonCode: 'HOUSING', previousReferralId: a });
    expect([fork.statusCode, fork.body.error]).toEqual([409, 'REDIRECT_ALREADY_FOLLOWED']);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "previousReferralId" = ${a}`)).rows[0].n).toBe(1);
    const audit = await audits('REFERRAL_REDIRECT_PROPOSED', b);
    expect(audit.length).toBe(1);
    expect(audit[0].details).toMatchObject({ previousReferralId: a, followsSuggestion: true });
    // still nothing for the suggested organization before the person answers
    expect((await noticesOf(S.Z)).length).toBe(zBefore);
    expect(await grantActive(S.Z)).toBe(0);
    expect((await one(P.z, b)).statusCode).toBe(404);
    expect(await box(P.z, 'inbox', b)).toBeUndefined();
    expect((await dossierOf(P.z)).statusCode).toBe(404);
    // the person sees the chain and decides
    const pending = await mine(b);
    expect(pending).toMatchObject({ status: 'PENDING_CITIZEN', previousId: a });
    expect(pending.nextAction).toMatchObject({ code: 'CITIZEN_DECIDE', by: 'CITIZEN' });
    expect((await mine(a)).nextId).toBe(b);
    expect((await mine(a)).nextAction).toBeNull();
    // another person cannot answer it
    expect((await citAs(OTHER, H.citRefs, { method: 'POST', body: { id: b, decision: 'accept' } })).statusCode).toBe(404);
    expect((await decide(b)).statusCode).toBe(200);
    expect(await grantActive(S.Z)).toBe(1);
    expect((await notices(S.Z, 'referral_received', b)).length).toBe(1);
    // the chain, per party: the sender sees both links; the new receiver sees its own referral only; the former receiver never sees the next one
    const xa = (await one(P.x1, a)).body.referral; const xb = (await one(P.x1, b)).body.referral;
    expect(xa.next).toEqual({ id: b, status: 'SENT' });
    expect(xa.canProposeSuggested).toBe(false);
    expect(xb.previous).toEqual({ id: a, status: 'DECLINED' });
    const zb = await one(P.z, b);
    expect(zb.statusCode).toBe(200);
    expect(zb.body.referral.previous).toBeNull();
    expect(JSON.stringify(zb.body)).not.toContain(a);
    expect(JSON.stringify(zb.body)).not.toContain(SECRET_NOTE);
    expect(JSON.stringify(zb.body)).not.toContain('Org test Y');
    expect((await one(P.z, a)).statusCode).toBe(404);
    const ya = (await one(P.y, a)).body.referral;
    expect(ya.next).toBeNull();
    expect(JSON.stringify(ya)).not.toContain(b);
    expect((await one(P.y, b)).statusCode).toBe(404);
    // the new receiver's dossier view never carries the former receiver's text either
    const dossier = await dossierOf(P.z);
    expect(dossier.statusCode).toBe(200);
    expect(JSON.stringify(dossier.body)).not.toContain(SECRET_NOTE);
  });

  it('redirect: the database refuses a self-link, a suggestion on a live referral and a second live follow-up', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    await expect(db.execute(sql`UPDATE "Referral" SET "previousReferralId" = id WHERE id = ${a}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE "Referral" SET "suggestedStructureId" = ${S.Z} WHERE id = ${a}`)).rejects.toThrow();
    expect((await declineTo(a, P.y, S.Z)).statusCode).toBe(200);
    await expect(db.execute(sql`UPDATE "Referral" SET "suggestedStructureId" = ${S.X} WHERE id = ${a}`)).rejects.toThrow();
    await propose(S.Z, { previousReferralId: a });
    await expect(db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "previousReferralId", "updatedAt")
      VALUES (${'m2-dup-' + TS}, ${DOSSIER}, ${S.X}, ${S.W}, 'PENDING_CITIZEN', 'HOUSING', ${a}, NOW())`)).rejects.toThrow();
  });

  it('consent: the person withdrawing the sender’s access cancels a redirect that waits for their answer — the suggested organization never hears of it', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    expect((await declineTo(a, P.y, S.W)).statusCode).toBe(200);
    const b = await propose(S.W, { previousReferralId: a });
    const wBefore = (await noticesOf(S.W)).length;
    const out = await owner('revoke', { structureId: S.X });
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
    const r = await row(b);
    expect([r.status, r.outcome, r.grantId]).toEqual(['CANCELLED', 'CITIZEN_WITHDREW', null]);
    expect((await trail(b)).at(-1)).toEqual({ actor: 'CITIZEN', from: 'PENDING_CITIZEN', to: 'CANCELLED' });
    expect((await noticesOf(S.W)).length).toBe(wBefore);
    expect(await grantActive(S.W)).toBe(0);
    expect((await notices(S.X, 'referral_cancelled', b)).length).toBe(X_MEMBERS);
    // it can no longer be accepted
    const late = await decide(b);
    expect([late.statusCode, late.body.error]).toEqual([409, 'ALREADY_DECIDED']);
    expect(await grantActive(S.W)).toBe(0);
    expect((await mine(b)).status).toBe('CANCELLED');
  });

  it('consent: « stop sharing » cancels every pending redirect of the dossier', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    expect((await declineTo(a, P.y, S.Z)).statusCode).toBe(200);
    const b = await propose(S.Z, { previousReferralId: a });
    const plain = await propose(S.W);   // a proposal that is not a redirect keeps the earlier rule: it stays the person's to decide
    const out = await owner('stop_sharing');
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
    expect((await row(b)).status).toBe('CANCELLED');
    expect((await row(plain)).status).toBe('PENDING_CITIZEN');
    expect(await grantActive(S.Z)).toBe(0);
    expect((await notices(S.Z, 'referral_cancelled', b)).length).toBe(0);
  });

  // ───────────────────────────── follow-up and next action (G4 / G5) ─────────────────────────────
  it('follow-up: the person’s view names the next action at each step; an accepted referral without a recorded step is flagged and ONE notice asks for a human follow-up', async (t) => {
    needs(t); await reset();
    const a = await propose(S.Y);
    expect((await mine(a)).nextAction).toMatchObject({ code: 'CITIZEN_DECIDE', by: 'CITIZEN' });
    expect((await decide(a)).statusCode).toBe(200);
    const waiting = await mine(a);
    expect(waiting.nextAction).toMatchObject({ code: 'RECEIVER_ANSWER', by: 'RECEIVER' });
    expect(waiting.nextAction.dueAt).toBeTruthy();
    expect(waiting.needsFollowUp).toBe(false);
    expect((await ref(P.y, { action: 'accept', id: a })).statusCode).toBe(200);
    expect(await mine(a)).toMatchObject({ nextAction: { code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' }, needsFollowUp: false });
    expect((await one(P.y, a)).body.referral).toMatchObject({ nextAction: { code: 'RECEIVER_FIRST_STEP' }, needsFollowUp: false });
    await cron();
    expect((await notices(S.Y, 'referral_follow_up', a)).length).toBe(0);
    // 15 days later nothing was recorded
    await db.execute(sql`UPDATE "Referral" SET "respondedAt" = NOW() - interval '15 days' WHERE id = ${a}`);
    expect((await mine(a)).needsFollowUp).toBe(true);
    expect((await one(P.x1, a)).body.referral.needsFollowUp).toBe(true);
    expect((await box(P.y, 'inbox', a)).needsFollowUp).toBe(true);
    expect((await box(P.x1, 'outbox', a)).needsFollowUp).toBe(true);
    expect((await cron()).followUpNotified).toBeGreaterThanOrEqual(1);
    expect((await notices(S.Y, 'referral_follow_up', a)).length).toBe(1);
    expect((await notices(S.X, 'referral_follow_up', a)).length).toBe(X_MEMBERS);
    expect((await row(a)).followUpNotifiedAt).not.toBeNull();
    expect((await row(a)).status).toBe('ACCEPTED');   // a flag and a notice: nothing is decided or changed by the platform
    expect((await audits('REFERRAL_TIMEOUT_NOTICE', a)).filter((x) => x.details.kind === 'accepted_stalled').length).toBe(1);
    await cron();   // a second run: no second notice
    expect((await notices(S.Y, 'referral_follow_up', a)).length).toBe(1);
    expect((await notices(S.X, 'referral_follow_up', a)).length).toBe(X_MEMBERS);
    // a recorded step clears the flag
    expect((await ref(P.y, { action: 'start', id: a })).statusCode).toBe(200);
    expect(await mine(a)).toMatchObject({ nextAction: { code: 'RECEIVER_RESULT', by: 'RECEIVER' }, needsFollowUp: false });
    expect((await ref(P.y, { action: 'complete', id: a, outcome: 'SUPPORT_COMPLETED' })).statusCode).toBe(200);
    expect((await mine(a)).nextAction).toBeNull();
  });

  it('follow-up: a suggestion nobody acted on is flagged for the sender (one notice) — never for the suggested organization', async (t) => {
    needs(t); await reset();
    const a = await sent(S.Y);
    expect((await declineTo(a, P.y, S.Z)).statusCode).toBe(200);
    expect((await mine(a)).needsFollowUp).toBe(false);
    await db.execute(sql`UPDATE "Referral" SET "respondedAt" = NOW() - interval '15 days' WHERE id = ${a}`);
    expect(await mine(a)).toMatchObject({ nextAction: { code: 'SENDER_PROPOSE_SUGGESTED' }, needsFollowUp: true });
    expect((await box(P.x1, 'outbox', a)).needsFollowUp).toBe(true);
    const zBefore = (await noticesOf(S.Z)).length;
    expect((await cron()).followUpNotified).toBeGreaterThanOrEqual(1);
    expect((await notices(S.X, 'referral_follow_up', a)).length).toBe(X_MEMBERS);
    expect((await notices(S.Y, 'referral_follow_up', a)).length).toBe(0);
    expect((await noticesOf(S.Z)).length).toBe(zBefore);
    await cron();   // a second run: no second notice
    expect((await notices(S.X, 'referral_follow_up', a)).length).toBe(X_MEMBERS);
    // once the sender follows it, the flag is gone
    const b = await propose(S.Z, { previousReferralId: a });
    expect(await mine(a)).toMatchObject({ nextAction: null, needsFollowUp: false, nextId: b });
    expect((await box(P.x1, 'outbox', a)).needsFollowUp).toBe(false);
  });

  // ───────────────────────────── référent de parcours (G5) ─────────────────────────────
  it('référent: only a professional who may open the case can volunteer, with their agreement to show a name; nothing is effective before the person agrees', async (t) => {
    needs(t); await reset(); await clearReferents(); mailer.__clearTestOutbox();
    // no access to the dossier: the same 404 as any other case action (y, z, w hold no grant; x2 is not the assignee)
    for (const p of [P.y, P.z, P.w, P.x2]) expect((await volunteer(p)).statusCode, p.id).toBe(404);
    expect((await volunteer(P.x1, { displayNameConsent: false })).body.error).toBe('NAME_CONSENT_REQUIRED');
    expect((await volunteer(P.x1, { displayName: ' ' })).body.error).toBe('INVALID_NAME');
    // C7 data minimisation: at most 80 characters, and a name only — no e-mail address, link or number
    expect((await volunteer(P.x1, { displayName: 'C'.repeat(81) })).body.error).toBe('INVALID_NAME');
    for (const n of ['Camille camille@example.org', 'Camille 06 12 34 56 78', 'Camille https://example.org', 'Camille www.example.org']) expect((await volunteer(P.x1, { displayName: n })).body.error, n).toBe('NAME_NOT_MINIMAL');
    expect((await referentRows()).length).toBe(0);
    const v = await volunteer(P.x1);
    expect(v.statusCode, JSON.stringify(v.body)).toBe(201);
    const [r] = await referentRows();
    expect(r).toMatchObject({ status: 'PROPOSED', structureId: S.X, proUserId: P.x1.id, displayName: 'Camille (test)', citizenDecisionAt: null });
    expect(r.displayNameConsentAt).not.toBeNull();
    expect(await referentTrail(r.id)).toEqual([{ actor: 'PROFESSIONAL', from: null, to: 'PROPOSED', reason: null }]);
    expect((await audits('DOSSIER_REFERENT_PROPOSED', r.id)).length).toBe(1);
    // one current proposal per dossier
    expect((await volunteer(P.admin)).body.error).toBe('REFERENT_EXISTS');
    // the person sees a proposal, clearly not yet effective; their e-mail carries no name
    const view = (await referentView()).body;
    expect(view.referent).toBeNull();
    expect(view.proposal).toMatchObject({ displayName: 'Camille (test)', organization: 'Org test X' });
    expect(toCit().some((m) => /personne de contact/.test(m.subject) && !m.text.includes('Camille'))).toBe(true);
    // the proposing organization sees it as « proposed »
    expect((await caseOf(P.x1)).body.referent).toMatchObject({ status: 'PROPOSED', displayName: 'Camille (test)', mine: true });
    // another person can neither see nor decide it
    expect((await referentView(OTHER)).statusCode).toBe(404);
    expect((await referentDecide(true, OTHER)).statusCode).toBe(404);
    expect((await referentEnd(OTHER)).statusCode).toBe(404);
    expect((await referentRows())[0].status).toBe('PROPOSED');
    // the database itself refuses « accepted » without the person's decision
    await expect(db.execute(sql`UPDATE "DossierReferent" SET status = 'ACCEPTED_BY_CITIZEN' WHERE id = ${r.id}`)).rejects.toThrow();
  });

  it('référent: the person agrees — the name is shown to them and to the organizations that already hold a grant; they withdraw it at any time', async (t) => {
    needs(t); await reset(); await clearReferents();
    const b = await sent(S.Z);   // Z holds a grant (authorized by the person) ; W holds none
    expect((await ref(P.z, { action: 'accept', id: b })).statusCode).toBe(200);
    expect((await volunteer(P.x1)).statusCode).toBe(201);
    // not shown to another organization while it is only proposed
    const zCase = (await pro(H.cases, P.z, { query: { scope: 'unassigned' } })).body.cases.find((c) => c.dossierId === DOSSIER).id;
    expect((await caseOf(P.z, zCase)).body.referent).toBeNull();
    const ok = await referentDecide(true);
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    const [r] = await referentRows();
    expect(r.status).toBe('ACCEPTED_BY_CITIZEN');
    expect(r.citizenDecisionAt).not.toBeNull();
    expect((await referentTrail(r.id)).at(-1)).toEqual({ actor: 'CITIZEN', from: 'PROPOSED', to: 'ACCEPTED_BY_CITIZEN', reason: null });
    expect((await audits('DOSSIER_REFERENT_ACCEPTED', r.id)).length).toBe(1);
    expect((await referentDecide(true)).statusCode).toBe(409);   // decided once
    expect((await referentView()).body.referent).toMatchObject({ displayName: 'Camille (test)', organization: 'Org test X' });
    expect((await caseOf(P.x1)).body.referent).toMatchObject({ status: 'ACCEPTED_BY_CITIZEN', mine: true, ownOrganization: true });
    const seenByZ = (await caseOf(P.z, zCase)).body.referent;
    expect(seenByZ).toMatchObject({ status: 'ACCEPTED_BY_CITIZEN', displayName: 'Camille (test)', organization: 'Org test X', mine: false, ownOrganization: false });
    expect(JSON.stringify(seenByZ)).not.toContain(P.x1.id);   // a name and an organization — no account identifier, no e-mail
    // the référent decides nothing for the other organization: Z's rights on its own case are unchanged, X's professional cannot act on Z's referral
    expect((await ref(P.x1, { action: 'complete', id: b, outcome: 'SUPPORT_COMPLETED' })).statusCode).toBe(400);
    // the person withdraws
    const end = await referentEnd();
    expect(end.statusCode, JSON.stringify(end.body)).toBe(200);
    const [after] = await referentRows();
    expect([after.status, after.endedBy]).toEqual(['ENDED', 'CITIZEN']);
    expect((await referentTrail(r.id)).at(-1)).toEqual({ actor: 'CITIZEN', from: 'ACCEPTED_BY_CITIZEN', to: 'ENDED', reason: 'CITIZEN' });
    expect((await referentView()).body).toMatchObject({ referent: null, proposal: null });
    expect((await caseOf(P.x1)).body.referent).toBeNull();
    expect((await caseOf(P.z, zCase)).body.referent).toBeNull();
    expect((await referentEnd()).statusCode).toBe(404);
    // the access X holds is untouched by the end of the référent
    expect((await caseOf(P.x1)).statusCode).toBe(200);
    // a refusal is also the person's decision
    expect((await volunteer(P.x1)).statusCode).toBe(201);
    expect((await referentDecide(false)).statusCode).toBe(200);
    expect((await referentRows()).at(-1)).toMatchObject({ status: 'ENDED', endedBy: 'CITIZEN' });
    expect((await referentRows()).at(-1).citizenDecisionAt).not.toBeNull();
  });

  it('référent: the record grants NO access — a référent without a grant gets the same 404 as anyone, before and after', async (t) => {
    needs(t); await reset(); await clearReferents();
    const probes = async (p) => [
      (await dossierOf(p)).statusCode,
      (await pro(H.cases, p, { query: { scope: 'all' } })).body.cases.filter((c) => c.dossierId === DOSSIER).length,
      (await ref(p, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING' })).statusCode,
      (await volunteer(p)).statusCode,
    ];
    // W never held a grant
    const before = await probes(P.w);
    expect(before).toEqual([404, 0, 404, 404]);
    // even a row written directly « as accepted by the person » opens nothing
    await db.execute(sql`INSERT INTO "DossierReferent" (id, "sharedDiagnosticId", "structureId", "proUserId", "displayName", status, "displayNameConsentAt", "citizenDecisionAt", "updatedAt")
      VALUES (${'m2-ref-w-' + TS}, ${DOSSIER}, ${S.W}, ${P.w.id}, 'Référent sans accès (test)', 'ACCEPTED_BY_CITIZEN', NOW(), NOW(), NOW())`);
    expect(await probes(P.w)).toEqual(before);
    const a = await sent(S.Y);
    expect((await one(P.w, a)).statusCode).toBe(404);
    expect((await ref(P.w, { action: 'accept', id: a })).statusCode).toBe(404);
    // and it is not shown as the référent: its organization holds no grant
    expect((await referentView()).body.referent).toBeNull();
    expect((await caseOf(P.x1)).body.referent).toBeNull();
    await clearReferents();
    // the real path: x1 is the accepted référent, then the person withdraws X's access — x1 is locked out like every member, and the référent ends with the access
    expect((await volunteer(P.x1)).statusCode).toBe(201);
    expect((await referentDecide(true)).statusCode).toBe(200);
    expect((await caseOf(P.x1)).statusCode).toBe(200);
    expect((await dossierOf(P.x1)).statusCode).toBe(200);
    expect((await owner('revoke', { structureId: S.X })).statusCode).toBe(200);
    expect((await dossierOf(P.x1)).statusCode).toBe(404);
    expect((await caseOf(P.x1)).statusCode).toBe(404);
    expect((await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING' })).statusCode).toBe(404);
    const [r] = await referentRows();
    expect([r.status, r.endedBy]).toEqual(['ENDED', 'ACCESS_REVOKED']);
    expect((await referentTrail(r.id)).at(-1)).toMatchObject({ to: 'ENDED', reason: 'ACCESS_REVOKED' });
    expect((await referentView()).body.referent).toBeNull();
  });

  it('référent: a proposal whose organization lost its access cannot be accepted; the professional steps down; a departure ends it without an heir', async (t) => {
    needs(t); await reset(); await clearReferents();
    // access lost between the proposal and the person's answer (fixture: the grant is closed directly, as a path that would not end the row itself)
    expect((await volunteer(P.x1)).statusCode).toBe(201);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE id = ${'g-' + DOSSIER}`);
    expect((await referentView()).body.proposal).toBeNull();
    const refused = await referentDecide(true);
    expect([refused.statusCode, refused.body.error]).toEqual([409, 'REFERENT_NO_LONGER_AVAILABLE']);
    expect((await referentRows()).at(-1)).toMatchObject({ status: 'ENDED', endedBy: 'ACCESS_REVOKED' });
    await reset();
    // step down: only the professional concerned (or an administrator of the same organization)
    expect((await volunteer(P.x1)).statusCode).toBe(201);
    expect((await referentDecide(true)).statusCode).toBe(200);
    for (const p of [P.y, P.w]) expect((await pro(H.cases, p, { method: 'POST', body: { action: 'referent_step_down', id: caseId } })).statusCode).toBe(404);
    const down = await pro(H.cases, P.x1, { method: 'POST', body: { action: 'referent_step_down', id: caseId } });
    expect(down.statusCode, JSON.stringify(down.body)).toBe(200);
    expect((await referentRows()).at(-1)).toMatchObject({ status: 'ENDED', endedBy: 'PROFESSIONAL' });
    expect((await pro(H.cases, P.x1, { method: 'POST', body: { action: 'referent_step_down', id: caseId } })).statusCode).toBe(404);
    // departure: x2 is the référent of the (unassigned) other dossier of X; x2 leaves with x1 as successor — x1 does NOT inherit the role
    expect((await pro(H.cases, P.x2, { method: 'POST', body: { action: 'referent_volunteer', id: foreignCaseId, displayName: 'Sacha (test)', displayNameConsent: true } })).statusCode).toBe(201);
    expect((await referentDecide(true, OTHER, FOREIGN)).statusCode).toBe(200);
    const leave = await pro(H.team, P.admin, { method: 'DELETE', query: { userId: P.x2.id, successorUserId: P.x1.id }, url: `/api/pro/team?userId=${P.x2.id}&successorUserId=${P.x1.id}` });
    expect(leave.statusCode, JSON.stringify(leave.body)).toBe(200);
    const [gone] = await referentRows(FOREIGN);
    expect([gone.status, gone.endedBy, gone.proUserId]).toEqual(['ENDED', 'DEPARTURE', P.x2.id]);
    expect((await referentView(OTHER, FOREIGN)).body).toMatchObject({ referent: null, proposal: null });
    expect((await referentRows(FOREIGN)).length).toBe(1);
    expect((await pro(H.team, P.admin, { method: 'PATCH', body: { targetUserId: P.x2.id, reactivate: true } })).statusCode).toBe(200);
  });

  // ───────────────────────────── art. 15 export (C7 / M2) ─────────────────────────────
  it('art. 15 export: the person gets the référent rows of their dossiers with their history, the referral chain and the sender texts — never the receiver texts, the professional account id or an actor id', async (t) => {
    needs(t); await reset();
    const SENDER_TEXT = `texte-pour-la-personne-${TS}`;
    const b = await sent(S.W, { message: SENDER_TEXT });
    const privacy = await import('../../api/_services/privacy.js');
    const out = await privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') }).getExportData(CIT.id);
    // référent rows (proposed, accepted, ended ones from the scenarios above) with their decisions and history, as the person saw them
    const refs = out.dossierReferents;
    expect(refs.length).toBe((await referentRows()).length);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((f) => f.dossierId === DOSSIER && f.organization === 'Org test X' && typeof f.displayName === 'string' && Array.isArray(f.events) && f.events.length > 0)).toBe(true);
    expect(refs.some((f) => f.status === 'ENDED' && f.endedBy)).toBe(true);
    expect(refs.some((f) => f.citizenDecisionAt)).toBe(true);
    const flat = JSON.stringify(refs);
    expect(flat).not.toContain(P.x1.id); expect(flat).not.toContain(P.x2.id); expect(flat).not.toMatch(/proUserId|actorId/);
    // referrals: the sender's message as Mon Espace shows it, the answer code, and the 0047 chain (previous referral, suggested organization)
    const mineB = out.referrals.find((r) => r.id === b);
    expect(mineB).toMatchObject({ message: SENDER_TEXT, to: 'Org test W' });
    expect(out.referrals.some((r) => r.responseCode === 'REDIRECT_SUGGESTED' && r.suggestedOrganization === 'Org test Z')).toBe(true);
    expect(out.referrals.some((r) => r.previousReferralId)).toBe(true);
    expect(out.referrals.every((r) => !('messageEncrypted' in r))).toBe(true);
    // 0048 history: sender texts only, decrypted; the receivers' answers are counted as organization-held, never released here
    expect(out.referralTextHistory.some((m) => m.referralId === b && m.side === 'SENDER' && m.text === SENDER_TEXT)).toBe(true);
    expect(out.referralTextHistory.every((m) => m.side === 'SENDER')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(SECRET_NOTE);
    expect(out.organizationHeldRecords.referralReceiverTexts.find((x) => x.organization === 'Org test Y')?.count).toBeGreaterThan(0);
    expect(out.exportInfo).toBeTruthy();
  });
});
