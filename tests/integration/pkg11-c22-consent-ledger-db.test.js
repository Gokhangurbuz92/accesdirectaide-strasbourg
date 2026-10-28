/**
 * PKG-11 / C22 — the consent ledger on REAL PostgreSQL, through the real API entry where a person acts (synthetic data only):
 *  - drizzle/0030: a recorded decision can never be rewritten (UPDATE refused by the database), a change of mind is a new row;
 *  - the owner's purpose decisions on a shared dossier (PURP-05 AI, PURP-07 SIAO) are ledger rows written in the SAME transaction as the grant: an unchanged
 *    decision adds nothing, and when the proof cannot be written the purpose does not change;
 *  - the privacy service withdraws by appending (idempotent), the earlier grant stays as recorded;
 *  - retention deletes only SUPERSEDED rows older than 3 years: the latest decision of a subject for a purpose is kept, however old.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const TS = Date.now();
const CIT = { id: `c22-cit-${TS}`, email: `c22-cit-${TS}@example.test` };
const ST = `c22-st-${TS}`; const CSRF = 'c22csrf' + TS; const GRANT = `c22-g-${TS}`;
const PROBE = `c22_probe_${TS}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe('PKG-11 / C22 append-only consent ledger (real DB)', () => {
  let db, api, userAuth, share;
  const call = async (method, url, { body, headers = {} } = {}) => {
    const req = { method, url, query: {}, body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF, ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const own = (body) => call('POST', '/api/public/dossier-grants', { body: { shareId: share.id, ...body }, headers: { 'x-share-owner-secret': share.owner } });
  const ledger = async () => (await db.execute(sql`SELECT purpose, decision, withdrawn_at IS NOT NULL AS w, collection_channel AS ch, proof_level AS p, policy_hash AS h
    FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id = ${`${share.id}:${ST}`} ORDER BY created_at, id`)).rows;
  const purposes = async () => (await db.execute(sql`SELECT purposes FROM "SharedDossierGrant" WHERE id = ${GRANT}`)).rows[0].purposes.split(',').sort();

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; userAuth = await import('../../api/_utils/user-auth.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ST}, ${'C22 Org ' + TS}, ${ST}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    const created = await call('POST', '/api/share/create', { body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(created.statusCode).toBe(200); expect(created.body.shareId).toBeTruthy();
    share = { id: created.body.shareId, owner: created.body.ownerSecret };
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", purposes, "grantedVia", "createdAt") VALUES (${GRANT}, ${share.id}, ${ST}, 'c22-pro', 'PURP-06', 'invite', NOW())`);
  }, 90000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql.raw(`ALTER TABLE "ConsentLog" DROP CONSTRAINT IF EXISTS ${PROBE}`)).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id LIKE ${'%' + TS + '%'} OR subject_id LIKE ${(share?.id || 'none') + ':%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details::text LIKE ${'%' + ST + '%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE id = ${GRANT}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${share?.id || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ST}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('the database refuses to rewrite a recorded decision (trigger ConsentLog_append_only); the row stays as recorded', async () => {
    const id = `c22-row-${TS}`;
    await db.execute(sql`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision) VALUES (${id}, 'v', 'h', 'CITIZEN_USER', ${CIT.id}, 'NOTIF_SMS_SERVICE', true)`);
    const err = await db.execute(sql`UPDATE "ConsentLog" SET decision = false WHERE id = ${id}`).then(() => null, (e) => e);
    expect(err?.code ?? err?.cause?.code).toBe('23000');
    expect(String(err?.cause?.message || err?.message)).toMatch(/append-only/);   // drizzle wraps the database error in `cause`
    expect((await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE id = ${id}`)).rows[0].decision).toBe(true);
  });

  it('owner purpose decisions are ledger rows written with the grant; an unchanged decision adds nothing; earlier rows never change', async () => {
    expect((await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);
    expect((await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);   // same decision again
    expect((await own({ action: 'set_siao', structureId: ST, siao: true })).statusCode).toBe(200);
    expect((await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-06'] })).statusCode).toBe(200);              // AI withdrawn
    expect((await own({ action: 'set_siao', structureId: ST, siao: false })).statusCode).toBe(200);
    expect(await purposes()).toEqual(['PURP-06']);
    const rows = await ledger();
    expect(rows.map((r) => [r.purpose, r.decision, r.w])).toEqual([['PURP-05', true, false], ['PURP-07', true, false], ['PURP-05', false, true], ['PURP-07', false, true]]);
    for (const r of rows) {
      expect([r.ch, r.p]).toEqual(['owner_link', 'OWNER_SECRET']);
      expect(r.h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('no proof, no change: when the ledger row cannot be written the purpose stays as it was', async () => {
    await db.execute(sql.raw(`ALTER TABLE "ConsentLog" ADD CONSTRAINT ${PROBE} CHECK (subject_id <> '${share.id}:${ST}') NOT VALID`));
    try {
      const res = await own({ action: 'set_purposes', structureId: ST, purposes: ['PURP-06', 'PURP-05'] });
      expect(res.statusCode).toBe(500);
      expect(await purposes()).toEqual(['PURP-06']);
      expect((await ledger()).length).toBe(4);
    } finally {
      await db.execute(sql.raw(`ALTER TABLE "ConsentLog" DROP CONSTRAINT IF EXISTS ${PROBE}`));
    }
  });

  it('the privacy service withdraws by appending (idempotent) and keeps the earlier grant as recorded', async () => {
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    const service = createPrivacyRightsService({ db, cryptoLib: crypto });
    const subject = `c22-subject-${TS}`;
    await service.grantConsent('citizen', subject, 'MARKETING_EMAIL', 'v2', 'web', false, 'strong');
    await service.withdrawConsent(subject, 'MARKETING_EMAIL');
    await service.withdrawConsent(subject, 'MARKETING_EMAIL');
    const rows = (await db.execute(sql`SELECT decision, withdrawn_at IS NOT NULL AS w, policy_version AS v, policy_hash AS h FROM "ConsentLog" WHERE subject_id = ${subject} ORDER BY created_at, id`)).rows;
    expect(rows.map((r) => [r.decision, r.w, r.v])).toEqual([[true, false, 'v2'], [false, true, 'v2']]);
    expect(rows[0].h).toBe(crypto.createHash('sha256').update('v2:MARKETING_EMAIL').digest('hex'));   // was the literal 'todo-hash'
    expect((await service.getCurrentConsent(subject, 'MARKETING_EMAIL')).decision).toBe(false);
  });

  it('retention deletes only superseded rows older than 3 years: the latest decision is kept however old', async () => {
    const { purgeSupersededConsents, RETENTION } = await import('../../api/_handlers/cron/gdpr-purge.js');
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    const row = (subject, decision, days, tag) => db.execute(sql`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at)
      VALUES (${`c22-${tag}-${TS}`}, 'v', 'h', 'CITIZEN_USER', ${subject}, 'NOTIF_SMS_SERVICE', ${decision}, ${days}::timestamptz)`);
    const X = `c22-x-${TS}`, Y = `c22-y-${TS}`, Z = `c22-z-${TS}`;
    await row(X, true, ago(5 * 365), 'x1'); await row(X, false, ago(4 * 365), 'x2');   // both old: only the superseded grant goes
    await row(Y, true, ago(5 * 365), 'y1');                                            // old but the latest: kept
    await row(Z, true, ago(5 * 365), 'z1'); await row(Z, false, ago(365), 'z2');       // old grant superseded by a recent withdrawal: the grant goes
    const deleted = await purgeSupersededConsents(db, new Date(Date.now() - RETENTION.CONSENT_LOG_DAYS * 86400000));
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = (await db.execute(sql`SELECT id FROM "ConsentLog" WHERE subject_id IN (${X}, ${Y}, ${Z}) ORDER BY id`)).rows.map((r) => r.id);
    expect(left).toEqual([`c22-x2-${TS}`, `c22-y1-${TS}`, `c22-z2-${TS}`]);
  });
});
