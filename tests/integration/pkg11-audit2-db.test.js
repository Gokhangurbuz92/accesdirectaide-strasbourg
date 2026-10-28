/**
 * PKG-11 deep audit, pass 2 (2026-10-23) on REAL PostgreSQL — the fixes that only a database can prove.
 *  - content: an edit of a VERIFIED record already on a manual hold is held for RE-VERIFICATION (the marker goes first, the manual reason is kept), so a plain
 *    release is refused; a new hold on a record held for re-verification keeps the marker; the catalogue never archives an organization that has active members
 *    or that is suspended (archiving cut every member's access, with no way back);
 *  - restriction of processing (art. 18): the person's read-only share link stops working while the restriction holds (share/get.js itself is byte-pinned) and
 *    works again once it is lifted; the owner keeps ownership; two simultaneous requests create ONE active restriction;
 *  - territorial statistics: the observatoire publishes the last complete calendar QUARTER and a trend by quarter (no rolling 12-month window to difference);
 *    the export offers that quarter only;
 *  - RSS: an item without a date keeps the date it was first given, so an unchanged undated item is not re-ingested (nor sent back to review) on every run;
 *  - J-1 reminders: « demain » is the Paris calendar day and the time in the message is Paris time.
 * Synthetic data only; skipped without DATABASE_URL; no provider is called.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

// the cron's distributed lock is infrastructure (KV with a dummy URL in QA), not under test here (same as k0-c20 / pkg3-modes-visio)
vi.mock('../../api/_utils/pipelineLock.js', () => ({ withLock: async (_name, fn) => fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ID = { aide: `a2-aide-${TS}`, org: `a2-org-${TS}`, orgSus: `a2-sus-${TS}`, orgDraft: `a2-draft-${TS}`, pro: `a2-pro-${TS}`, cit: `a2-cit-${TS}`, dos: `a2-dos-${TS}`, svc: `a2-svc-${TS}`, rdv: `a2-rdv-${TS}`, rc: `a2-rc-${TS}` };
const READ_TOKEN = `a2-read-${TS}-${crypto.randomBytes(8).toString('hex')}`;
const sha256 = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const FEED_URL = `https://www.service-public.fr/a2-feed-${TS}`;

describe.skipIf(!hasDatabase)('PKG-11 audit pass 2 (real DB)', () => {
  let db, schema, adminContent, verification, restriction, stats, rss, notices;
  const reviewer = { id: 'a2-reviewer@example.test', role: 'admin' };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    adminContent = await import('../../api/_services/admin-content.js'); verification = await import('../../api/_services/content-verification.js');
    restriction = await import('../../api/_services/processing-restriction.js'); stats = await import('../../api/_services/territorial-stats.js');
    rss = await import('../../api/_handlers/cron/ingest-actualites-rss.js'); notices = await import('../../api/_services/appointment-notices.js');
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, cest_quoi, publication_hold, "updatedAt")
      VALUES (${ID.aide}, ${ID.aide}, 'Aide audit 2', 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '3 days', 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', 'Texte vérifié.', 'montant à confirmer', NOW())`);
    for (const [id, statut] of [[ID.org, 'actif'], [ID.orgSus, 'suspendu'], [ID.orgDraft, 'brouillon']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, 'VERIFIED', NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${ID.pro}, ${ID.pro + '@example.test'}, 'x', 'PRO', 'active', ${ID.org}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID.cit}, ${ID.cit + '@example.test'}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${ID.dos}, NOW() + interval '7 days', '{"zipCode":"67000"}'::jsonb, '{"assessment":{"items":[]}}'::jsonb, 0, ${sha256('a2-owner-secret')}, ${sha256(READ_TOKEN)}, 'CITIZEN_SHARE', ${ID.cit})`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const like = `a2-%-${TS}`;
    for (const q of [sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" = ${ID.rdv}`, sql`DELETE FROM "ProAppointment" WHERE id = ${ID.rdv}`, sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`,
      sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${ID.cit}`, sql`DELETE FROM "SharedDiagnostic" WHERE id = ${ID.dos}`, sql`DELETE FROM "AuditLog" WHERE entity_id IN (${ID.aide}, ${ID.org}, ${ID.orgSus}, ${ID.orgDraft})`,
      sql`DELETE FROM "ContentVerification" WHERE "entityId" = ${ID.aide}`, sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${ID.aide}, ${ID.org}, ${ID.orgSus}, ${ID.orgDraft})`,
      sql`DELETE FROM "Aide" WHERE id = ${ID.aide}`, sql`DELETE FROM "ProNotification" WHERE "structureId" LIKE ${like}`, sql`DELETE FROM "ProUser" WHERE id LIKE ${like}`,
      sql`DELETE FROM "Structure" WHERE id LIKE ${like}`, sql`DELETE FROM "CitizenUser" WHERE id LIKE ${like}`, sql`DELETE FROM "Actualite" WHERE canonical_url = ${FEED_URL}`,
      sql`DELETE FROM "SourceDocument" WHERE source_url = ${FEED_URL}`]) await db.execute(q).catch(() => {});
  });

  it('content: an edit over a manual hold is held for re-verification; a later hold keeps the marker; the catalogue never archives an organization with members or a suspended one', async () => {
    const e = await adminContent.updateContent('aide', ID.aide, { cest_quoi: 'Texte modifié sous une suspension manuelle.' }, 'a2-admin@example.test');
    expect(e).toMatchObject({ ok: true, heldForReverification: true });
    let [row] = (await db.execute(sql`SELECT publication_hold h FROM "Aide" WHERE id = ${ID.aide}`)).rows;
    expect(row.h).toMatch(/^Contenu modifié par l’administration .* · montant à confirmer$/);
    expect(await verification.recordVerification({ entityType: 'aide', entityId: ID.aide, action: 'RELEASE_HOLD', reviewer }, { db })).toMatchObject({ ok: false, code: 'REVERIFICATION_REQUIRED' });
    expect((await verification.recordVerification({ entityType: 'aide', entityId: ID.aide, action: 'HOLD', holdReason: 'source à recontrôler', reviewer }, { db })).ok).toBe(true);
    [row] = (await db.execute(sql`SELECT publication_hold h FROM "Aide" WHERE id = ${ID.aide}`)).rows;
    expect(row.h).toMatch(/^Contenu modifié par l’administration/); expect(row.h).toMatch(/source à recontrôler$/);
    expect(await verification.recordVerification({ entityType: 'aide', entityId: ID.aide, action: 'RELEASE_HOLD', reviewer }, { db })).toMatchObject({ ok: false, code: 'REVERIFICATION_REQUIRED' });
    // archiving through the catalogue: refused with active members and for a suspended organization; a draft entry without members can be archived
    expect(await adminContent.archiveContent('structure', ID.org, 'a2-admin@example.test', db)).toMatchObject({ ok: false, code: 'ORGANIZATION_LIFECYCLE' });
    expect(await adminContent.archiveContent('structure', ID.orgSus, 'a2-admin@example.test', db)).toMatchObject({ ok: false, code: 'ORGANIZATION_LIFECYCLE' });
    expect((await db.execute(sql`SELECT statut FROM "Structure" WHERE id IN (${ID.org}, ${ID.orgSus}) ORDER BY id`)).rows.map((r) => r.statut).sort()).toEqual(['actif', 'suspendu']);
    expect(await adminContent.archiveContent('structure', ID.orgDraft, 'a2-admin@example.test', db)).toMatchObject({ ok: true });
  });

  it('restriction: the read-only share link stops while it holds and works again after the lift; ownership is kept; two simultaneous requests make ONE restriction', async () => {
    const get = (await import('../../api/_handlers/share/get.js')).default;
    const read = async () => { const r = mk(); await get({ method: 'POST', url: '/api/share/get', query: {}, headers: { host: 'localhost' }, body: { id: ID.dos, capability: READ_TOKEN } }, r); return r.statusCode; };
    const { holdsOwnerSecret, isLegacyShare } = await import('../../api/_utils/share-access.js');
    const ownerRow = async () => (await db.execute(sql`SELECT "rightsSecretHash", "shareTokenHash" FROM "SharedDiagnostic" WHERE id = ${ID.dos}`)).rows[0];
    expect(await read()).toBe(200);
    const deps = { notify: async () => {} };
    const both = await Promise.all([restriction.requestRestriction(ID.cit, { ground: 'ACCURACY_CONTESTED' }, db, deps), restriction.requestRestriction(ID.cit, { ground: 'ACCURACY_CONTESTED' }, db, deps)]);
    expect(both.every((o) => o.ok)).toBe(true);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "DSRRequest" WHERE "subjectId" = ${ID.cit} AND "requestType" = 'RESTRICT' AND status = 'ACTIVE'`)).rows[0].n).toBe(1);
    expect(await read()).toBe(404);
    const sealed = await ownerRow(); expect(sealed.shareTokenHash.startsWith(restriction.SHARE_SEAL)).toBe(true);
    expect(isLegacyShare(sealed)).toBe(false); expect(holdsOwnerSecret(sealed, 'a2-owner-secret')).toBe(true);   // the owner keeps every right
    expect((await restriction.liftBySubject(ID.cit, db, deps)).ok).toBe(true);
    expect((await ownerRow()).shareTokenHash).toBe(sha256(READ_TOKEN));
    expect(await read()).toBe(200);
  });

  it('statistics: the observatoire and the export use the last complete calendar quarter only (non-overlapping grid)', async () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(stats.lastQuarters(now).map((q) => q.label)).toEqual(['2025-T4', '2026-T1', '2026-T2', '2026-T3']);
    const obs = await stats.observatoire(db, now);
    expect(obs.window).toMatchObject({ from: '2026-07-01', to: '2026-10-01', period: '2026-T3' });
    expect(obs.trend.map((t) => t.quarter)).toEqual(['2025-T4', '2026-T1', '2026-T2', '2026-T3']);
    expect(await stats.territoryCsv('month', db, now)).toMatchObject({ ok: false, code: 'PERIOD_NOT_OFFERED' });
    expect(await stats.territoryCsv('year', db, now)).toMatchObject({ ok: false, code: 'PERIOD_NOT_OFFERED' });
    expect(await stats.territoryCsv('quarter', db, now)).toMatchObject({ ok: true, period: '2026-T3' });
  });

  it('RSS: an undated item keeps its first date, so an unchanged item is skipped on the next run', async () => {
    const input = { source: { id: `a2-src-${TS}`, name: 'Service-Public QA' }, feedUrl: 'https://www.service-public.fr/rss-qa', category: null, territory: null, runId: `a2-run-${TS}`, isOfficial: false,
      item: { title: `Actualité sans date ${TS}`, link: FEED_URL, contentSnippet: 'Résumé QA.' } };
    expect((await rss.upsertActualiteFromFeedItem(input)).action).toBe('created');
    const first = (await db.execute(sql`SELECT date_publication d FROM "Actualite" WHERE canonical_url = ${FEED_URL}`)).rows[0].d;
    await new Promise((r) => { setTimeout(r, 1100); });
    expect((await rss.upsertActualiteFromFeedItem({ ...input, runId: `a2-run2-${TS}` })).action).toBe('skipped');
    expect(new Date((await db.execute(sql`SELECT date_publication d FROM "Actualite" WHERE canonical_url = ${FEED_URL}`)).rows[0].d).getTime()).toBe(new Date(first).getTime());
  });

  it('J-1 reminder: « demain » is the Paris day and the message gives the Paris time', async () => {
    const { start, end } = notices.parisDayWindow(new Date(), 1);
    expect(end.getTime() - start.getTime()).toBeGreaterThanOrEqual(23 * 3600000);
    expect(notices.formatParisTime(start)).toBe('00:00');
    const at = new Date(start.getTime() + 30 * 60000);   // 00:30 in Paris tomorrow — the previous evening in UTC
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.org, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", mode, "updatedAt")
      VALUES (${ID.rdv}, ${ID.org}, ${ID.svc}, ${at}, ${new Date(at.getTime() + 1800000)}, 'confirmed', 'Particulier', ${ID.cit}, 'IN_PERSON', NOW())`);
    const mailer = await import('../../api/_utils/mailer.js'); process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test'; mailer.__clearTestOutbox();
    const cron = (await import('../../api/_handlers/cron/rdv-reminder.js')).default; const r = mk();
    await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const m = mailer.__getTestOutbox().find((x) => x.to === `${ID.cit}@example.test` && /Rappel/.test(x.subject));
    expect(m, 'the Paris-tomorrow appointment is reminded').toBeTruthy();
    expect(m.text).toContain('à 00:30');
  });
});
