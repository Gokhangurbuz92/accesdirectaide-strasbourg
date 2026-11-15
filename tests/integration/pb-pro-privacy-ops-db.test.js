/**
 * Pro / Structure privacy and operations fixes (RECON_PRO_STRUCTURE_TERRITORY 2026-11-15), on REAL PostgreSQL through the real handlers.
 * Synthetic organizations A (admin, pro1, pro2) and B (pro). Synthetic data only; the mailer is the in-memory 'test' provider. Skipped without DATABASE_URL.
 *   A04  one follow-up status (the case status); no note in clear in the dossier JSON; a legacy note moves to the protected case notes
 *   A13  a SIAO hand-over sheet prepared by a professional appears in the person's access log
 *   A15  organisation export: services, booking settings, opening hours, absences (no individual reason), selections (no sealed text), journal; audited
 *   A20  per-member activity figures: the structure's administrator only (another member gets their own line)
 *   A21  a colleague's absence reason is not returned to the team (dates only); the member and a schedule manager read it
 *   A14  dossier export: only json / csv, audited with the validated format; the organisation's access trail (dossier/views) lists it
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quota = infrastructure, not under test here (tests/unit/pb-pro-rate-limits.test.js)
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `pb-A-${TS}`, B: `pb-B-${TS}` };
const P = { admin: { id: `pb-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro1: { id: `pb-p1-${TS}`, st: S.A, role: 'PRO' }, pro2: { id: `pb-p2-${TS}`, st: S.A, role: 'PRO' }, b: { id: `pb-b-${TS}`, st: S.B, role: 'PRO' } };
const CIT = { id: `pb-cit-${TS}`, email: `pb-cit-${TS}@example.test` };
const DOS = `pb-dos-${TS}`; const DOS2 = `pb-dos2-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, end() { return this; } });

describe.skipIf(!hasDatabase)('Pro / Structure privacy and operations fixes (real DB)', () => {
  let db, auth, userAuth; const H = {};
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const one = async (q) => (await db.execute(q)).rows[0];
  const dossier = (p, id = DOS, extra = {}) => pro(H.dossier, p, { url: `/api/pro/dossier?shareId=${id}`, query: { shareId: id }, ...extra });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    H.dossier = (await import('../../api/_handlers/pro/dossier.js')).default; H.cases = (await import('../../api/_handlers/pro/cases.js')).default;
    H.exp = (await import('../../api/_handlers/pro/dossier/export.js')).default; H.views = (await import('../../api/_handlers/pro/dossier/views.js')).default;
    H.structure = (await import('../../api/_handlers/pro/structure.js')).default;
    H.teamStats = (await import('../../api/_handlers/pro/team-stats.js')).default; H.timeoff = (await import('../../api/_handlers/pro/timeoff.js')).default;
    H.siao = (await import('../../api/_handlers/pro/interop-siao.js')).default; H.citDossier = (await import('../../api/_handlers/citizen/dossier.js')).default;
    for (const id of Object.values(S)) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, is_pro_enabled, "updatedAt", "createdAt")
      VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', true, NOW(), NOW())`);
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    for (const [d, k] of [[DOS, 1], [DOS2, 2]]) await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${d}, NOW() + interval '30 days', '{"zipCode":"67000"}'::jsonb, '{}'::jsonb, 0, ${'h' + k + TS}, ${'t' + k + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes) VALUES (${'pbgA-' + TS}, ${DOS}, ${S.A}, ${P.pro1.id}, 'invite', 'PURP-06,PURP-07'),
      (${'pbgB-' + TS}, ${DOS}, ${S.B}, ${P.b.id}, 'invite', 'PURP-06'), (${'pbgA2-' + TS}, ${DOS2}, ${S.A}, ${P.pro1.id}, 'invite', 'PURP-06')`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const L = sql.join(Object.values(S).map((i) => sql`${i}`), sql`, `);
    for (const q of [sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOS}, ${DOS2})`, sql`DELETE FROM "ProTimeOff" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProOrientationBasket" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProRdvService" WHERE "structureId" IN (${L})`, sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProUser" WHERE "structureId" IN (${L})`, sql`DELETE FROM "Structure" WHERE id IN (${L})`,
      sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`]) await db.execute(q).catch(() => {});
  });

  describe('A04 — one follow-up status, no note in clear in the dossier', () => {
    const patch = (p, body, id = DOS) => dossier(p, id, { method: 'PATCH', body });
    it('the dossier page sets the CASE status (history kept, the person reads the same value); a free label is refused', async () => {
      const before = await dossier(P.pro1);
      expect(before.body.followUp).toEqual({ available: true, caseId: null, status: null });
      for (const label of ['Dossier validé', 'À traiter', 'CLOSED', '']) expect((await patch(P.pro1, { status: label })).statusCode, label).toBe(400);
      const out = await patch(P.pro1, { status: 'WAITING_CITIZEN' });
      expect([out.statusCode, out.body.status]).toEqual([200, 'WAITING_CITIZEN']);
      const c = await one(sql`SELECT id, status FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`);
      expect(c).toEqual({ id: out.body.caseId, status: 'WAITING_CITIZEN' });
      expect((await db.execute(sql`SELECT kind, "fromValue", "toValue" FROM "ProCaseEvent" WHERE "caseId" = ${c.id} AND kind = 'STATUS'`)).rows).toEqual([{ kind: 'STATUS', fromValue: 'NEW', toValue: 'WAITING_CITIZEN' }]);
      expect((await dossier(P.pro1)).body.followUp).toEqual({ available: true, caseId: c.id, status: 'WAITING_CITIZEN' });
      // the same value on the case page, and nothing written into the person's dossier JSON
      expect((await pro(H.cases, P.pro1, { query: { id: c.id } })).body.case.status).toBe('WAITING_CITIZEN');
      expect((await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS}`)).results).toEqual({});
      // another organization holding its own grant keeps its own case: nothing of A's
      expect((await dossier(P.b)).body.followUp).toEqual({ available: true, caseId: null, status: null });
    });
    it('an internal note is refused on this route and never stored; an organization without a grant gets 404', async () => {
      const refused = await patch(P.pro1, { status: 'IN_PROGRESS', internalNote: 'NOTE-EN-CLAIR-QA' });
      expect([refused.statusCode, refused.body.error]).toEqual([400, 'INTERNAL_NOTE_NOT_ACCEPTED']);
      expect(JSON.stringify((await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS}`)).results)).not.toContain('NOTE-EN-CLAIR-QA');
      expect((await one(sql`SELECT status FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`)).status).toBe('WAITING_CITIZEN');   // refused as a whole
      expect((await patch(P.b, { status: 'IN_PROGRESS' }, DOS2)).statusCode).toBe(404);
    });
    it('a legacy entry (free label + note in clear) is retired at the next status change: the note becomes a protected internal case note, the other organization’s entry is untouched', async () => {
      await db.execute(sql`UPDATE "SharedDiagnostic" SET results = ${JSON.stringify({ _followUps: { [S.A]: { status: 'Dossier validé', internalNote: 'LEGACY-NOTE-A' }, [S.B]: { status: 'x', internalNote: 'LEGACY-NOTE-B' } } })}::jsonb WHERE id = ${DOS2}`);
      const out = await patch(P.pro1, { status: 'IN_PROGRESS' }, DOS2);
      expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
      const results = (await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS2}`)).results;
      expect(results._followUps).toEqual({ [S.B]: { status: 'x', internalNote: 'LEGACY-NOTE-B' } });
      const note = await one(sql`SELECT visibility, "bodyEncrypted" AS b FROM "ProCaseNote" WHERE "caseId" = ${out.body.caseId}`);
      expect(note.visibility).toBe('INTERNAL'); expect(note.b).not.toContain('LEGACY-NOTE-A');   // sealed at rest
      const page = await pro(H.cases, P.pro1, { query: { id: out.body.caseId } });
      expect(page.body.notes.map((n) => [n.visibility, n.body])).toEqual([['INTERNAL', '[Note reprise de l’ancien suivi du dossier]\nLEGACY-NOTE-A']]);
    });
    it('a closed follow-up is not changed from the dossier page (409)', async () => {
      const c = await one(sql`SELECT id FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`);
      expect((await pro(H.cases, P.pro1, { method: 'POST', body: { action: 'close', id: c.id, outcome: 'INFORMATION_PROVIDED', citizenSummary: 'Information donnée.' } })).statusCode).toBe(200);
      const out = await patch(P.pro1, { status: 'IN_PROGRESS' });
      expect([out.statusCode, out.body.error]).toEqual([409, 'CASE_CLOSED']);
      expect((await dossier(P.pro1)).body.followUp.status).toBe('CLOSED');
      expect((await pro(H.cases, P.pro1, { method: 'POST', body: { action: 'reopen', id: c.id } })).statusCode).toBe(200);
    });
  });

  describe('A13 — the SIAO hand-over is visible to the person', () => {
    const log = async (id = DOS) => (await cit(H.citDossier, { query: { view: 'access', shareId: id } })).body.events.filter((e) => e.action === 'SIAO_HANDOVER_PREPARED');
    it('a sheet prepared with the person’s SIAO consent is listed in her access log, by organisation; a hand-over logged before the fix (no shareId) too', async () => {
      expect(await log()).toEqual([]);
      const out = await pro(H.siao, P.pro1, { method: 'POST', body: { shareId: DOS }, url: '/api/pro/interop-siao' });
      expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
      const events = await log();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'SIAO_HANDOVER_PREPARED', organization: `Org ${S.A}`, label: 'a préparé une fiche de transmission au SIAO (rien n’est envoyé par AccèsDirectAide)' });
      expect(JSON.stringify(events[0])).not.toContain(P.pro1.id);   // by organisation: no staff identifier
      // organisation B has no SIAO purpose: refused, nothing logged
      expect((await pro(H.siao, P.b, { method: 'POST', body: { shareId: DOS }, url: '/api/pro/interop-siao' })).statusCode).toBe(403);
      expect(await log()).toHaveLength(1);
      // a row written before the fix (dossier id only in entity_id) is shown as well; another dossier's log stays empty
      await db.execute(sql`INSERT INTO "AuditLog" (id, action, entity, entity_id, actor_id, details, ip_hash) VALUES (${'pb-siao-old-' + TS}, 'SIAO_HANDOVER_PREPARED', 'DIAGNOSTIC', ${DOS}, ${P.pro1.id}, ${JSON.stringify({ structureId: S.A, purpose: 'PURP-07' })}::jsonb, 'SYSTEM_GATEWAY')`);
      expect(await log()).toHaveLength(2);
      expect(await log(DOS2)).toEqual([]);
    });
  });

  describe('A14 — dossier export formats and the organisation’s access trail', () => {
    const exp = (p, format) => pro(H.exp, p, { url: `/api/pro/dossier/export?shareId=${DOS2}${format === undefined ? '' : `&format=${encodeURIComponent(format)}`}` });
    it('json and csv are served and audited; any other format is refused and leaves no audit row', async () => {
      const exported = async () => (await db.execute(sql`SELECT details->>'format' AS f FROM "AuditLog" WHERE action = 'DOSSIER_EXPORTED' AND details->>'shareId' = ${DOS2} ORDER BY "timestamp"`)).rows.map((r) => r.f);
      for (const bad of ['pdf', 'xml', 'json"\r\nX-Injected: 1']) { const r = await exp(P.pro1, bad); expect([r.statusCode, r.body.error], bad).toEqual([400, 'INVALID_FORMAT']); }
      expect(await exported()).toEqual([]);
      const j = await exp(P.pro1, undefined);
      expect(j.statusCode).toBe(200); expect(j.body.export.reference).toBe(DOS2.slice(0, 8).toUpperCase());
      const c = await exp(P.pro1, 'csv');
      expect(c.statusCode).toBe(200); expect(c.headers['content-type']).toMatch(/text\/csv/); expect(String(c.body)).toContain('Référence');
      expect(await exported()).toEqual(['json', 'csv']);
      expect((await exp(P.b, 'json')).statusCode).toBe(404);   // no grant on this dossier
      const trail = await pro(H.views, P.pro1, { url: `/api/pro/dossier/views?shareId=${DOS2}` });
      expect(trail.body.views.filter((v) => v.action === 'DOSSIER_EXPORTED')).toHaveLength(2);
      expect((await pro(H.views, P.b, { url: `/api/pro/dossier/views?shareId=${DOS2}` })).statusCode).toBe(404);
    });
  });

  describe('A15 — the organisation export holds the organisation’s own records and is journalised', () => {
    it('services, booking settings, opening hours, absences, selections, notification preferences and the journal — own rows only, no individual absence reason, no sealed text', async () => {
      for (const st of [S.A, S.B]) {
        await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", "updatedAt") VALUES (${'pbsvc-' + st}, ${st}, ${'Accueil ' + st}, 30, true, NOW())`);
        await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "contactEmail", "updatedAt") VALUES (${'pbrs-' + st}, ${st}, true, ${'accueil-' + st + '@example.test'}, NOW())`);
        await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", "updatedAt") VALUES (${'pbar-' + st}, ${st}, 1, '09:00', '12:00', NOW())`);
      }
      await db.execute(sql`INSERT INTO "ProTimeOff" (id, "structureId", "proUserId", "startAt", "endAt", reason, "updatedAt") VALUES
        (${'pbto1-' + TS}, ${S.A}, ${P.pro1.id}, NOW() + interval '5 days', NOW() + interval '6 days', 'MOTIF-SANTE-QA', NOW()),
        (${'pbto2-' + TS}, ${S.A}, NULL, NOW() + interval '20 days', NOW() + interval '27 days', 'Fermeture annuelle', NOW()),
        (${'pbto3-' + TS}, ${S.B}, ${P.b.id}, NOW() + interval '5 days', NOW() + interval '6 days', 'MOTIF-B-QA', NOW())`);
      await db.execute(sql`INSERT INTO "ProOrientationBasket" (id, "structureId", "ownerProUserId", "needCodes", items, "privateEncrypted", "updatedAt") VALUES
        (${'pbbk-' + TS}, ${S.A}, ${P.pro1.id}, '{}', ${JSON.stringify([{ key: 'k1', kind: 'aide', refId: 'aide-qa-1', followUp: 'A_PROPOSER', addedAt: '2026-11-01T10:00:00.000Z' }])}::jsonb, 'SEALED-LABEL-QA', NOW())`);
      await db.execute(sql`UPDATE "ProUser" SET "notificationPrefs" = '{"referrals": false}'::jsonb WHERE id = ${P.pro2.id}`);

      expect((await pro(H.structure, P.pro1, { query: { export: '1' } })).statusCode).toBe(403);
      const out = await pro(H.structure, P.admin, { query: { export: '1' } });
      expect(out.statusCode, JSON.stringify(out.body).slice(0, 300)).toBe(200);
      const e = out.body.export; const txt = JSON.stringify(e);
      expect(e.services.map((x) => [x.name, x.durationMinutes, x.isActive])).toEqual([[`Accueil ${S.A}`, 30, true]]);
      expect(e.bookingSettings).toMatchObject({ isPublished: true, contactEmail: `accueil-${S.A}@example.test` });
      expect(e.openingHours).toEqual([expect.objectContaining({ weekday: 1, startTime: '09:00', endTime: '12:00' })]);
      expect(e.absences.map((a) => [a.scope, a.member, a.reason])).toEqual([['member', `${P.pro1.id}@example.test`, null], ['structure', null, 'Fermeture annuelle']]);
      expect(e.selections).toEqual([expect.objectContaining({ id: `pbbk-${TS}`, owner: `${P.pro1.id}@example.test`, linkedToCase: false, items: [{ kind: 'aide', refId: 'aide-qa-1', followUp: 'A_PROPOSER', addedAt: '2026-11-01T10:00:00.000Z' }] })]);
      expect(e.team.find((m) => m.email === `${P.pro2.id}@example.test`).notificationPrefs).toEqual({ referrals: false });
      expect(e.journal.length).toBeGreaterThan(0); expect(e.journal.length).toBe(e.journalTotal); expect(e.journalTruncated).toBe(false);
      expect(e.journal.some((j) => j.action === 'DOSSIER_EXPORTED' && j.actor === `${P.pro1.id}@example.test`)).toBe(true);
      for (const j of e.journal) expect(Object.keys(j).sort()).toEqual(['action', 'actor', 'at', 'details']);
      for (const leak of ['MOTIF-SANTE-QA', 'MOTIF-B-QA', 'SEALED-LABEL-QA', `Accueil ${S.B}`, 'password', 'mfa_secret', 'ip_hash', 'ipHash', 'zipCode', P.b.id]) expect(txt, leak).not.toContain(leak);
      const audit = (await db.execute(sql`SELECT actor_id, details FROM "AuditLog" WHERE action = 'ORGANIZATION_EXPORTED' AND details->>'structureId' = ${S.A}`)).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_id: P.admin.id, details: { members: 3, services: 1, absences: 2, selections: 1, structureId: S.A } });
      // the next export shows the previous one in the journal
      expect((await pro(H.structure, P.admin, { query: { export: '1' } })).body.export.journal[0]).toMatchObject({ action: 'ORGANIZATION_EXPORTED', actor: `${P.admin.id}@example.test` });
    });
  });

  describe('A20 — per-member activity figures are for the structure’s administrator', () => {
    it('a member gets the global block and their own line only; the administrator gets the team; another organisation gets nothing of this one', async () => {
      const mine = await pro(H.teamStats, P.pro1);
      expect(mine.statusCode, JSON.stringify(mine.body)).toBe(200);
      expect(mine.body.members.map((m) => m.id)).toEqual([P.pro1.id]); expect(mine.body.membersScope).toBe('self');
      expect(mine.body.global).toHaveProperty('appointmentsUpcoming');
      expect(JSON.stringify(mine.body)).not.toContain(P.pro2.id); expect(JSON.stringify(mine.body)).not.toContain(P.admin.id);
      const team = await pro(H.teamStats, P.admin);
      expect(team.body.members.map((m) => m.id).sort()).toEqual([P.admin.id, P.pro1.id, P.pro2.id].sort()); expect(team.body.membersScope).toBe('team');
      expect((await pro(H.teamStats, P.b)).body.members.map((m) => m.id)).toEqual([P.b.id]);
      // the role is read from the database on each request: a token still saying STRUCTURE_ADMIN for a member who is now PRO gets the member view
      const stale = auth.signProToken({ id: P.pro2.id, email: `${P.pro2.id}@example.test`, structureId: S.A, role: 'STRUCTURE_ADMIN' });
      const r = mk(); await H.teamStats({ method: 'GET', url: '/api/pro/team/stats', query: {}, headers: { host: 'localhost', authorization: `Bearer ${stale}` } }, r);
      expect(r.statusCode === 200 ? r.body.members.map((m) => m.id) : []).toEqual(r.statusCode === 200 ? [P.pro2.id] : []);
      expect([200, 401, 403]).toContain(r.statusCode);
    });
  });

  describe('A21 — a colleague’s absence reason stays with that colleague and the schedule managers', () => {
    it('the team sees the dates; the reason goes to the member and to a manager; a closure of the structure keeps its reason', async () => {
      await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${S.A}`);
      await db.execute(sql`INSERT INTO "ProTimeOff" (id, "structureId", "proUserId", "startAt", "endAt", reason, "updatedAt") VALUES
        (${'pbt1-' + TS}, ${S.A}, ${P.pro1.id}, NOW() + interval '5 days', NOW() + interval '6 days', 'MOTIF-SANTE-QA', NOW()),
        (${'pbt2-' + TS}, ${S.A}, NULL, NOW() + interval '20 days', NOW() + interval '27 days', 'Fermeture annuelle', NOW()),
        (${'pbt3-' + TS}, ${S.A}, ${P.pro2.id}, NOW() + interval '8 days', NOW() + interval '9 days', NULL, NOW())`);
      const view = async (p) => Object.fromEntries((await pro(H.timeoff, p, { url: '/api/pro/timeoff' })).body.items.map((i) => [i.id.split('-')[0], [i.reason, i.reasonWithheld, Boolean(i.startAt && i.endAt)]]));
      const colleague = await pro(H.timeoff, P.pro2, { url: '/api/pro/timeoff' });
      expect(colleague.statusCode).toBe(200);
      expect(JSON.stringify(colleague.body)).not.toContain('MOTIF-SANTE-QA');
      expect(await view(P.pro2)).toEqual({ pbt1: [null, true, true], pbt2: ['Fermeture annuelle', false, true], pbt3: [null, false, true] });
      expect((await view(P.pro1)).pbt1).toEqual(['MOTIF-SANTE-QA', false, true]);   // the member
      expect((await view(P.admin)).pbt1).toEqual(['MOTIF-SANTE-QA', false, true]);   // a schedule manager
      await db.execute(sql`UPDATE "ProUser" SET "canManageSchedule" = true WHERE id = ${P.pro2.id}`);
      expect((await view(P.pro2)).pbt1).toEqual(['MOTIF-SANTE-QA', false, true]);   // a member the administrator designated for the schedule
      await db.execute(sql`UPDATE "ProUser" SET "canManageSchedule" = false WHERE id = ${P.pro2.id}`);
      expect(JSON.stringify((await pro(H.timeoff, P.b, { url: '/api/pro/timeoff' })).body)).not.toMatch(/MOTIF-SANTE-QA|Fermeture annuelle/);   // another organisation
    });
  });
});
