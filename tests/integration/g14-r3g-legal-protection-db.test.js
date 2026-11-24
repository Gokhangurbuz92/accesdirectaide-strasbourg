/**
 * G14-R3G — the representative of a protected adult on a REAL PostgreSQL, through the real router (capability gate + assisted-session gate) and handler.
 * Migration 0064 is in the journal since release 3 (idx 64); on a database where it is not applied yet this suite applies it when the table is absent, and proves its
 * rollback and re-application at the end.
 *   before verification nothing opens; the neutral answer (no account oracle); the administrator verifies the facts → ACT (tutelle): view (logged for the
 *   person), sensitive step hidden, cancel at once; CONFIRM (curatelle): a request the person confirms; contest = suspension at once; reinstatement;
 *   expiry ends every power; renounce; the C23 rule of the « mode accompagnant » (third party refused under ACT, allowed under CONFIRM, the verified
 *   representative with the code of their link); a stranger sees nothing; the database refuses an MJPM habilitation familiale and an ACTIVE link without
 *   its verification record.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PASSWORD = 'Synthetique-R3g-2026x';
const P = { id: `lp-p-${TS}`, email: `lp-p-${TS}@example.test` };   // protected adult under tutelle (ACT)
const Q = { id: `lp-q-${TS}`, email: `lp-q-${TS}@example.test` };   // protected adult under curatelle (CONFIRM)
const T = { id: `lp-t-${TS}`, email: `lp-t-${TS}@example.test` };   // tuteur (relative)
const C = { id: `lp-c-${TS}`, email: `lp-c-${TS}@example.test` };   // curateur (MJPM)
const X = { id: `lp-x-${TS}`, email: `lp-x-${TS}@example.test` };   // a stranger
const STR = `lp-str-${TS}`; const SVC = `lp-svc-${TS}`; const PRO = `lp-pro-${TS}`;
const APT = `lp-apt-${TS}`; const APT_Q = `lp-aptq-${TS}`; const ITEM = `lp-item-${TS}`; const ITEM_S = `lp-items-${TS}`; const ITEM_Q = `lp-itemq-${TS}`;
const ADMIN = 'admin-r3g@example.test';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const DECLARE = (o = {}) => ({ action: 'declare', personEmail: P.email, measure: 'TUTELLE', representativeKind: 'FAMILLE', scopePerson: true, scopeAssets: true,
  courtName: 'tribunal judiciaire de Strasbourg', decisionDate: '2025-06-02', measureEndsOn: '2030-06-02', decisionRef: 'RG 25/00042', truthful: true, password: PASSWORD, ...o });

describe.skipIf(!hasDatabase)('G14-R3G — représentant légal d’un majeur protégé (real DB)', () => {
  let db, userAuth, routes, svc, normal, installedHere = false;
  const route = async (path) => (await routes.find((r) => r.path === path).handler()).default;
  const http = async (path, { method = 'GET', body, query = {}, cookie } = {}) => {
    const r = mk(); const h = await route(path);
    const qs = new URLSearchParams(query).toString();
    await h({ method, url: `/api/${path}${qs ? `?${qs}` : ''}`, query, body, headers: { host: 'localhost', ...(cookie ? { cookie } : {}) } }, r); return r;
  };
  const lp = (u, body) => http('citizen/legal-protection', { method: 'POST', cookie: normal(u), body });
  const lpGet = (u, query = {}) => http('citizen/legal-protection', { cookie: normal(u), query });
  const auditOf = async (userId) => (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE entity = 'CitizenUser' AND entity_id = ${userId} ORDER BY timestamp, id`)).rows;
  const mandateOf = async (personId, repId) => (await db.execute(sql`SELECT * FROM "LegalProtectionMandate" WHERE "protectedUserId" = ${personId} AND "representativeUserId" = ${repId} ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ routes } = await import('../../api/routes.js'));
    svc = await import('../../api/_services/legal-protection.js');
    if (!(await db.execute(sql`SELECT to_regclass('"LegalProtectionMandate"') IS NOT NULL AS ok`)).rows[0].ok) {
      await db.execute(sql.raw(fs.readFileSync('drizzle/0064_r3g_legal_protection.sql', 'utf8').replaceAll('--> statement-breakpoint', '')));
      installedHere = true;
    }
    const { recordAgeDeclaration } = await import('../../api/_utils/age-policy.js');
    const hash = await userAuth.hashPassword(PASSWORD);
    for (const u of [P, Q, T, C, X]) {
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, ${hash}, NOW(), NOW())`);
      await recordAgeDeclaration(u.id, { adult: true, channel: 'account' });
    }
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${STR}, 'Service mandataire Test', ${`lp-slug-${TS}`}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${PRO}, ${`lp-pro-${TS}@example.test`}, 'x', 'AGENT', 'active', ${STR}, true, NOW())`);
    const start = new Date(Date.now() + 5 * 864e5);
    for (const [id, owner] of [[APT, P.id], [APT_Q, Q.id]]) await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
      VALUES (${id}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Personne Test', ${PRO}, ${owner}, NOW(), NOW())`);
    for (const [id, owner, title] of [[ITEM, P.id, 'Déposer le dossier CAF'], [ITEM_S, P.id, 'Constituer le dossier MDPH'], [ITEM_Q, Q.id, 'Demander la prime d’activité']]) {
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${id}, ${owner}, 'MANUAL', 'custom', ${title}, NOW())`);
    }
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    // the representative's view of Mon Parcours follows the same switch as a trusted person's (closed in the limited version unless « on »)
    process.env.ADA_PARCOURS_DELEGATE_READ = 'on';
    normal = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  }, 120000);
  afterAll(async () => {
    if (!db) return;
    const ids = [P.id, Q.id, T.id, C.id, X.id];
    const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${list}) OR actor_id IN (${list}) OR actor_id = ${ADMIN}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${list})`);
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (${APT}, ${APT_Q})`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${APT}, ${APT_Q})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${list})`);   // cascades the links, tokens, steps
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
    if (installedHere) await db.execute(sql.raw(fs.readFileSync('drizzle/rollback/0064_down.sql', 'utf8')));
    delete process.env.ADA_PARCOURS_DELEGATE_READ;
  });

  it('declaration: password and statement required; neutral answer whether the account exists or not; nothing opens before verification', async () => {
    expect((await lp(T, DECLARE({ password: 'wrong' }))).statusCode).toBe(403);
    expect((await lp(T, DECLARE({ truthful: false }))).body.error).toBe('STATEMENT_REQUIRED');
    expect((await lp(T, DECLARE({ measureEndsOn: '2046-01-01' }))).body.error).toBe('END_DATE_BEYOND_LAW');
    const unknown = await lp(T, DECLARE({ personEmail: `nobody-${TS}@example.test` }));
    const known = await lp(T, DECLARE());
    expect([unknown.statusCode, known.statusCode]).toEqual([202, 202]);
    expect(unknown.body.message).toBe(known.body.message);
    const m = await mandateOf(P.id, T.id);
    expect(m).toMatchObject({ status: 'DECLARED', measure: 'TUTELLE', mode: 'REPRESENTATION', verifiedAt: null });
    expect(m.decisionRefHmac).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(m)).not.toContain('00042');
    // the person sees it at once (page + notification centre); the representative has no power yet
    const mine = await lpGet(P);
    expect(mine.body.asPerson).toHaveLength(1); expect(mine.body.asPerson[0]).toMatchObject({ state: 'DECLARED', powers: null, representativeEmail: T.email });
    expect(JSON.stringify(mine.body)).not.toMatch(/decisionRefHmac/);
    const inbox = await http('citizen/notifications', { cookie: normal(P) });
    expect(inbox.body.notifications.map((n) => n.kind)).toContain('LEGAL_PROTECTION_DECLARED');
    expect((await lpGet(T, { id: m.id, view: 'rdv' })).body.error).toBe('MANDATE_NOT_ACTIVE');
    expect((await lp(T, { action: 'act', id: m.id, type: 'RDV_CANCEL', appointmentId: APT })).body.error).toBe('MANDATE_NOT_ACTIVE');
  });

  it('the database refuses what the law refuses: an MJPM habilitation familiale, a verified link without its verification record', async () => {
    await expect(db.execute(sql`INSERT INTO "LegalProtectionMandate" (id, "protectedUserId", "representativeUserId", "representativeKind", "mjpmForm", measure, mode, "scopePerson", "courtName", "decisionDate", "measureEndsOn")
      VALUES (${`bad1-${TS}`}, ${X.id}, ${C.id}, 'MJPM', 'SERVICE', 'HABILITATION_FAMILIALE_GENERALE', 'REPRESENTATION', true, 'TJ Test', '2025-01-01', '2030-01-01')`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO "LegalProtectionMandate" (id, "protectedUserId", "representativeUserId", "representativeKind", measure, mode, "scopePerson", "courtName", "decisionDate", "measureEndsOn", status, areas)
      VALUES (${`bad2-${TS}`}, ${X.id}, ${T.id}, 'FAMILLE', 'TUTELLE', 'REPRESENTATION', true, 'TJ Test', '2025-01-01', '2030-01-01', 'VERIFIED', '{RDV}')`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO "LegalProtectionMandate" (id, "protectedUserId", "representativeUserId", "representativeKind", measure, mode, "scopePerson", "courtName", "decisionDate", "measureEndsOn")
      VALUES (${`bad3-${TS}`}, ${X.id}, ${T.id}, 'FAMILLE', 'CURATELLE_SIMPLE', 'REPRESENTATION', true, 'TJ Test', '2025-01-01', '2030-01-01')`)).rejects.toThrow();
  });

  it('the administrator verifies (method + note + areas); the admin route itself needs a named admin session', async () => {
    const adm = await http('admin/legal-protection', { method: 'POST', body: { action: 'list' } });
    expect([401, 403]).toContain(adm.statusCode);
    const q = await svc.adminQueue();
    const item = q.pending.find((x) => x.personEmail === P.email);
    expect(item).toMatchObject({ representativeEmail: T.email, measure: 'TUTELLE', state: 'DECLARED' });
    const m = await mandateOf(P.id, T.id);
    expect((await svc.adminVerify(ADMIN, { id: m.id, method: 'ORIGINAL_SHOWN', note: 'court', measure: 'TUTELLE', scopePerson: true, scopeAssets: true, areas: ['RDV', 'PARCOURS'], courtName: m.courtName, decisionDate: '2025-06-02', measureEndsOn: '2030-06-02' })).code).toBe('NOTE_REQUIRED');
    const v = await svc.adminVerify(ADMIN, { id: m.id, method: 'ORIGINAL_SHOWN', note: 'Original du jugement présenté en visio, noms et dates conformes.', measure: 'TUTELLE', scopePerson: true, scopeAssets: true,
      areas: ['RDV', 'PARCOURS'], courtName: m.courtName, decisionDate: '2025-06-02', measureEndsOn: '2030-06-02' });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(v.mandate).toMatchObject({ state: 'VERIFIED', validUntil: '2030-06-02', powers: { mode: 'ACT', areas: ['RDV', 'PARCOURS'] } });
    expect((await auditOf(P.id)).map((a) => a.action)).toEqual(expect.arrayContaining(['LEGAL_PROTECTION_DECLARED', 'LEGAL_PROTECTION_VERIFIED']));
  });

  it('ACT (tutelle): views logged for the person, sensitive step hidden, the cancellation done at once and told; a stranger sees nothing', async () => {
    const m = await mandateOf(P.id, T.id);
    const rdv = await lpGet(T, { id: m.id, view: 'rdv' });
    expect(rdv.statusCode, JSON.stringify(rdv.body)).toBe(200);
    expect(rdv.body.appointments.map((a) => a.id)).toEqual([APT]);
    const par = await lpGet(T, { id: m.id, view: 'parcours' });
    expect(par.body.items.map((i) => i.id)).toEqual([ITEM]);   // « dossier MDPH » (disability) is never shown
    expect(par.body.hiddenSensitive).toBe(1);
    expect((await lpGet(X, { id: m.id, view: 'rdv' })).statusCode).toBe(404);
    expect((await lp(T, { action: 'act', id: m.id, type: 'PARCOURS_STATUS', itemId: ITEM_S, status: 'IN_PROGRESS' })).statusCode).toBe(404);   // sensitive = unknown
    const cancel = await lp(T, { action: 'act', id: m.id, type: 'RDV_CANCEL', appointmentId: APT });
    expect(cancel.statusCode, JSON.stringify(cancel.body)).toBe(200); expect(cancel.body.executed).toBe(true);
    expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${APT}`)).rows[0].status).toBe('cancelled');
    const actions = (await auditOf(P.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LEGAL_REP_VIEWED_RDV', 'LEGAL_REP_VIEWED_PARCOURS', 'LEGAL_REP_ACTION_EXECUTED']));
    const log = await lpGet(P, { log: m.id });
    expect(log.body.events.map((e) => e.event)).toEqual(expect.arrayContaining(['LEGAL_REP_ACTION_EXECUTED', 'LEGAL_PROTECTION_VERIFIED']));
  });

  it('assisted mode under ACT: a third party is refused; the verified representative is accepted with the code of their link, in the covered areas', async () => {
    const START = { action: 'start', consent: true, helperName: 'Conseillère Test', helperRole: 'TRAVAILLEUR_SOCIAL', areas: ['RDV'], minutes: 30, password: PASSWORD };
    expect((await http('citizen/assist', { method: 'POST', cookie: normal(P), body: START })).body.error).toBe('ASSIST_REPRESENTATIVE_REQUIRED');
    expect((await http('citizen/assist', { method: 'POST', cookie: normal(P), body: { ...START, helperRole: 'REPRESENTANT_LEGAL', representativeCode: '00000000' } })).body.error).toBe('REPRESENTATIVE_NOT_VERIFIED');
    const m = await mandateOf(P.id, T.id);
    const code = await lp(T, { action: 'helper-code', id: m.id });
    expect(code.body.code).toMatch(/^\d{4} \d{4}$/);
    expect((await http('citizen/assist', { method: 'POST', cookie: normal(P), body: { ...START, helperRole: 'REPRESENTANT_LEGAL', representativeCode: code.body.code, areas: ['COFFRE'] } })).body.error).toBe('AREA_NOT_COVERED');
    const ok = await http('citizen/assist', { method: 'POST', cookie: normal(P), body: { ...START, helperName: 'Tuteur Test', helperRole: 'REPRESENTANT_LEGAL', representativeCode: code.body.code } });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.session.helper).toMatchObject({ role: 'REPRESENTANT_LEGAL', verifiedRepresentative: true });
    await db.execute(sql`UPDATE "AuthToken" SET "usedAt" = NOW() WHERE "userId" = ${P.id} AND type = 'ASSIST_SESSION'`);
  });

  it('contest = suspension at once (no power, no code); the administrator reinstates with a note the person reads', async () => {
    const m = await mandateOf(P.id, T.id);
    const c = await lp(P, { action: 'contest', id: m.id });
    expect(c.body.state).toBe('SUSPENDED');
    expect((await lpGet(T, { id: m.id, view: 'rdv' })).body.error).toBe('MANDATE_NOT_ACTIVE');
    expect((await lp(T, { action: 'helper-code', id: m.id })).body.error).toBe('MANDATE_NOT_ACTIVE');
    expect((await svc.adminQueue()).contested.map((x) => x.id)).toContain(m.id);
    expect((await svc.adminReinstate(ADMIN, { id: m.id, note: 'Jugement revu : la mesure est en cours, la personne a été informée.' })).ok).toBe(true);
    const mine = await lpGet(P);
    expect(mine.body.asPerson[0]).toMatchObject({ state: 'VERIFIED', contested: true, verificationNote: 'Jugement revu : la mesure est en cours, la personne a été informée.' });
  });

  it('expiry ends every power by itself (validUntil passed = EXPIRED)', async () => {
    const m = await mandateOf(P.id, T.id);
    await db.execute(sql`UPDATE "LegalProtectionMandate" SET "measureEndsOn" = '2025-12-01', "validUntil" = '2025-12-01' WHERE id = ${m.id}`);
    expect((await lpGet(T, { id: m.id, view: 'rdv' })).body.error).toBe('MANDATE_NOT_ACTIVE');
    expect((await lpGet(P)).body.asPerson[0].state).toBe('EXPIRED');
    // and the third party is no longer refused for this person (no verified live link)
    expect((await svc.assistRuleFor(P.id, { helperRole: 'TRAVAILLEUR_SOCIAL' })).ok).toBe(true);
  });

  it('CONFIRM (curatelle renforcée, MJPM service with SIRET): a request the PERSON confirms; a third party may assist; renounce ends it', async () => {
    const d = await lp(C, DECLARE({ personEmail: Q.email, measure: 'CURATELLE_RENFORCEE', representativeKind: 'MJPM', mjpmForm: 'SERVICE', decisionRef: '' }));
    expect(d.statusCode).toBe(202);
    const m = await mandateOf(Q.id, C.id);
    expect(m).toMatchObject({ mode: 'ASSISTANCE', representativeKind: 'MJPM', mjpmForm: 'SERVICE' });
    expect((await svc.adminVerify(ADMIN, { id: m.id, method: 'CERTIFIED_COPY_EXAMINED', note: 'Copie certifiée examinée au bureau, mesure en cours.', measure: 'CURATELLE_RENFORCEE',
      representativeKind: 'MJPM', mjpmForm: 'SERVICE', scopePerson: true, scopeAssets: true, areas: ['PARCOURS'], courtName: m.courtName, decisionDate: '2025-06-02', measureEndsOn: '2030-06-02' })).ok).toBe(true);
    expect((await lpGet(C, { id: m.id, view: 'rdv' })).body.error).toBe('AREA_NOT_COVERED');
    const ask = await lp(C, { action: 'act', id: m.id, type: 'PARCOURS_STATUS', itemId: ITEM_Q, status: 'IN_PROGRESS' });
    expect(ask.statusCode, JSON.stringify(ask.body)).toBe(202); expect(ask.body.executed).toBe(false);
    expect((await db.execute(sql`SELECT status FROM "ParcoursItem" WHERE id = ${ITEM_Q}`)).rows[0].status).not.toBe('IN_PROGRESS');
    const mine = await lpGet(Q);
    expect(mine.body.requests).toHaveLength(1);
    expect((await http('citizen/notifications', { cookie: normal(Q) })).body.notifications.map((n) => n.kind)).toContain('LEGAL_PROTECTION_ACTION_REQUEST');
    expect((await lp(C, { action: 'resolve-request', requestId: mine.body.requests[0].id, accept: true })).statusCode).toBe(404);   // only the person
    const done = await lp(Q, { action: 'resolve-request', requestId: mine.body.requests[0].id, accept: true });
    expect(done.statusCode, JSON.stringify(done.body)).toBe(200);
    expect((await db.execute(sql`SELECT status FROM "ParcoursItem" WHERE id = ${ITEM_Q}`)).rows[0].status).toBe('IN_PROGRESS');
    expect((await lp(Q, { action: 'resolve-request', requestId: mine.body.requests[0].id, accept: true })).statusCode).toBe(404);   // single use
    expect((await svc.assistRuleFor(Q.id, { helperRole: 'TRAVAILLEUR_SOCIAL' })).ok).toBe(true);   // assistance: the person keeps acting with whom they choose
    expect((await lp(C, { action: 'renounce', id: m.id })).statusCode).toBe(200);
    expect((await lpGet(C, { id: m.id, view: 'parcours' })).body.error).toBe('MANDATE_NOT_ACTIVE');
  });

  it('migration 0064: rollback then re-application leave the database as expected (on this suite\'s database)', async () => {
    const down = fs.readFileSync('drizzle/rollback/0064_down.sql', 'utf8'); const up = fs.readFileSync('drizzle/0064_r3g_legal_protection.sql', 'utf8').replaceAll('--> statement-breakpoint', '');
    // the down file also forgets the journal row: keep it to put it back after the re-application (the database stays as migrated)
    const rec = (await db.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`)).rows[0].ok
      ? (await db.execute(sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE created_at = 1795060000000`)).rows : [];
    await db.execute(sql.raw(down));
    expect((await db.execute(sql`SELECT to_regclass('"LegalProtectionMandate"') IS NOT NULL AS ok`)).rows[0].ok).toBe(false);
    await db.execute(sql.raw(down));   // idempotent
    await db.execute(sql.raw(up));
    for (const r of rec) await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${r.hash}, ${r.created_at})`);
    const cons = (await db.execute(sql`SELECT count(*)::int n FROM pg_constraint WHERE conrelid = '"LegalProtectionMandate"'::regclass`)).rows[0].n;
    expect(cons).toBe(26);   // 22 CHECK + primary key + 3 foreign keys
  });
});
