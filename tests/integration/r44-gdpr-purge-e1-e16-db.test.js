/**
 * R44 — policy-driven GDPR purge (R43 dossier § 3.3, E1–E16) on a REAL PostgreSQL, synthetic data only. Works on a database migrated to 0042 only
 * (Production today) and on one with every migration: the seed is raw SQL with 0042 columns only.
 *   - refusal: the production policy (PROPOSED — NOT APPROVED) never changes a row, even with GDPR_PURGE_ENABLED=true and every step listed;
 *   - dry run vs execute: the dry run counts and changes nothing; partial approval runs only the approved step (E16);
 *   - E1–E5 appointments (anchor startAt, account unlinked, status-specific, requested-after-start = expired, message erased at +30 days with the
 *     citizenUserId discriminant), E8 notices / pro notifications / failing push, E9 conversations + attachment file, E9b, E10 consents after erasure,
 *     E11 shared copy followed by an organization (redacted, the case and its note survive), E7 report only;
 *   - safeguards: legal hold, restriction (art. 18), open access request; evidence row; idempotent re-run; concurrent runs.
 * Run: bash $S/r44int.sh <wt> ada_r44_purge_full_test tests/integration/r44-gdpr-purge-e1-e16-db.test.js (and $S/r44/purge/int42.sh for 0042)
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv, executableStepIds, setApprovalEnv } from '../helpers/gdpr-purge-approval.js';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
const id = (s) => `r44p-${s}-${TS}`;
const CIT = { a: id('cit-a'), held: id('cit-held'), restricted: id('cit-restr'), open: id('cit-open'), inactive: id('cit-inactive') };
const ERASED = { old: id('erased-old'), recent: id('erased-recent'), partial: id('erased-partial'), dsrOld: id('erased-dsr-old'), dsrHeld: id('erased-dsr-held') };
const APT = ['confOld', 'confRecent', 'reqStale', 'reqFuture', 'refusedOld', 'cancelledOld', 'cancelledRecent', 'proRecent', 'proOld', 'heldOld', 'restrictedOld', 'openOld']
  .reduce((o, k) => ({ ...o, [k]: id(`apt-${k}`) }), {});

describe.skipIf(!hasDatabase)('R44 GDPR purge E1–E16 (real DB, 0042 and full schema)', () => {
  let db, mod, storage, allSteps;
  const blob = {};
  const one = async (q) => (await db.execute(q)).rows[0];
  const n = async (q) => Number((await one(q)).n);
  const run = (env, opts = {}) => mod.runGdprPurge({ policy: approvedTestPolicy(), env, ...opts });
  const apt = (k) => one(sql`SELECT "beneficiaryName", "beneficiaryPhone", "citizenEmailSnapshot", notes, "citizenUserId", status FROM "ProAppointment" WHERE id = ${APT[k]}`);
  const snapshot = async () => ({
    apts: (await db.execute(sql`SELECT id, "beneficiaryName", notes, "citizenUserId", status FROM "ProAppointment" WHERE id LIKE ${'r44p-apt-%-' + TS} ORDER BY id`)).rows,
    other: (await db.execute(sql`SELECT 'notice' k, count(*)::int n FROM "AppointmentNotice" WHERE id LIKE ${'r44p-%-' + TS} UNION ALL SELECT 'conv', count(*)::int FROM "RdvConversation" WHERE id LIKE ${'r44p-%-' + TS}
      UNION ALL SELECT 'consent', count(*)::int FROM "ConsentLog" WHERE id LIKE ${'r44p-%-' + TS} UNION ALL SELECT 'dsr', count(*)::int FROM "DSRRequest" WHERE id LIKE ${'r44p-%-' + TS}
      UNION ALL SELECT 'sd', count(*)::int FROM "SharedDiagnostic" WHERE id LIKE ${'r44p-%-' + TS} UNION ALL SELECT 'push', count(*)::int FROM "PushSubscription" WHERE id LIKE ${'r44p-%-' + TS}
      UNION ALL SELECT 'pn', count(*)::int FROM "ProNotification" WHERE id LIKE ${'r44p-%-' + TS} UNION ALL SELECT 'hold', count(*)::int FROM "LegalHold" WHERE id LIKE ${'r44p-%-' + TS}
      UNION ALL SELECT 'support', count(*)::int FROM "SupportRequest" WHERE id LIKE ${'r44p-%-' + TS} ORDER BY k`)).rows,
  });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    mod = await import('../../api/_handlers/cron/gdpr-purge.js');
    ({ storage } = await import('../../api/lib/storage.js'));
    allSteps = executableStepIds(mod.PURGE_STEPS);
    const str = id('str'); const svc = id('svc'); const pro = id('pro');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${str}, 'R44 P', ${'slug-' + str}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${svc}, ${str}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${pro}, ${pro + '@example.test'}, 'x', 'AGENT', 'active', ${str}, NOW())`);
    for (const [k, cid] of Object.entries({ ...CIT, partial: ERASED.partial })) {
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt", "lastSeenAt") VALUES (${cid}, ${cid + '@example.test'}, 'x', NOW(), ${k === 'inactive' ? ago(800) : ago(1)})`);
    }
    const hold = (hid, rec) => db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES (${hid}, 'CitizenUser', ${rec}, 'R44 TEST', 'test', 'ACTIVE', NOW())`);
    await hold(id('lh-held'), CIT.held);
    await hold(id('lh-dsr'), ERASED.dsrHeld);
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt", "releasedAt") VALUES
      (${id('lh-rel-old')}, 'CitizenUser', 'nobody', 'R44 TEST', 'test', 'RELEASED', ${ago(500)}, ${ago(400)}), (${id('lh-rel-new')}, 'CitizenUser', 'nobody', 'R44 TEST', 'test', 'RELEASED', ${ago(50)}, ${ago(10)})`);
    const dsr = (did, subject, type, status, completed) => db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "createdAt", "completedAt")
      VALUES (${did}, 'CITIZEN_USER', ${subject}, ${type}, ${status}, 'HUMAN_REVIEW', ${completed ?? ago(1)}, ${completed})`);
    await dsr(id('dsr-restr'), CIT.restricted, 'RESTRICT', 'ACTIVE', null);
    await dsr(id('dsr-open'), CIT.open, 'ACCESS_REVIEW', 'IN_REVIEW', null);
    await dsr(id('dsr-e-old'), ERASED.old, 'DELETE', 'COMPLETED', ago(400));
    await dsr(id('dsr-e-recent'), ERASED.recent, 'DELETE', 'COMPLETED', ago(100));
    await dsr(id('dsr-e-partial'), ERASED.partial, 'DELETE', 'COMPLETED', ago(400));
    await dsr(id('dsr-e-dsrold'), ERASED.dsrOld, 'DELETE', 'COMPLETED', ago(1200));
    await dsr(id('dsr-e-dsrheld'), ERASED.dsrHeld, 'DELETE', 'COMPLETED', ago(1200));
    await dsr(id('dsr-access-old'), CIT.a, 'ACCESS_REVIEW', 'COMPLETED', ago(1200));
    for (const s of Object.values(ERASED)) {
      await db.execute(sql`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, created_at, purpose, decision) VALUES (${id('cl-' + s.slice(5, 20))}, 'v1', 'h', 'CITIZEN_USER', ${s}, ${ago(1300)}, 'R44P', true)`);
    }
    const insertApt = (k, { start, status = 'confirmed', citizen = CIT.a, notes = 'message', cancelled = null, created = ago(900) }) => db.execute(sql`INSERT INTO "ProAppointment"
      (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", notes, "citizenUserId", "citizenEmailSnapshot", "cancelledAt", "createdAt", "updatedAt")
      VALUES (${APT[k]}, ${str}, ${svc}, ${start}, ${new Date(start.getTime() + 1_800_000)}, ${status}, 'Jean Dupont', '0600000000', ${notes}, ${citizen}, ${citizen ? 'x@example.test' : null}, ${cancelled}, ${created}, NOW())`);
    await insertApt('confOld', { start: ago(800) });
    await insertApt('confRecent', { start: ago(40), created: ago(800) });   // E1: created 800 days ago, took place 40 days ago — only its message goes
    await insertApt('reqStale', { start: ago(100), status: 'requested' });   // E4
    await insertApt('reqFuture', { start: new Date(Date.now() + 5 * DAY), status: 'requested', created: ago(1) });
    await insertApt('refusedOld', { start: ago(100), status: 'refused' });
    await insertApt('cancelledOld', { start: new Date(Date.now() + 30 * DAY), status: 'cancelled', cancelled: ago(100) });
    await insertApt('cancelledRecent', { start: ago(40), status: 'cancelled', cancelled: ago(10) });
    await insertApt('proRecent', { start: ago(40), citizen: null, notes: 'note of the structure' });   // E5: never erased (no account)
    await insertApt('proOld', { start: ago(800), citizen: null, notes: 'note of the structure' });
    await insertApt('heldOld', { start: ago(800), citizen: CIT.held });
    await insertApt('restrictedOld', { start: ago(800), citizen: CIT.restricted });
    await insertApt('openOld', { start: ago(800), citizen: CIT.open });
    await db.execute(sql`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES
      (${id('an-old')}, ${APT.confOld}, 'BOOKED_BY_STRUCTURE', 'citizen', 'email', 'DELIVERED'), (${id('an-new')}, ${APT.confRecent}, 'BOOKED_BY_STRUCTURE', 'citizen', 'email', 'DELIVERED')`);
    // conversations: one on the old appointment (follows its anonymisation) with an attachment file, one inactive for 800 days, one recent
    blob.att = await storage.upload(Buffer.from('%PDF'), 'application/pdf');
    const conv = async (cid, aptId, last) => {
      await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "createdAt", "updatedAt") VALUES (${cid}, ${aptId}, ${str}, ${CIT.a}, ${last}, ${last}, NOW())`);
      await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", body, "createdAt") VALUES (${cid + '-m'}, ${cid}, 'CITIZEN', ${CIT.a}, 'bonjour', ${last})`);
    };
    await conv(id('conv-old-apt'), APT.confOld, ago(5));
    await db.execute(sql`INSERT INTO "RdvMessageAttachment" (id, "conversationId", "messageId", "uploaderType", "storageKey", "filenameEncrypted", "mimeType", "byteLength", "checksumSha256")
      VALUES (${id('att')}, ${id('conv-old-apt')}, ${id('conv-old-apt') + '-m'}, 'CITIZEN', ${blob.att}, 'x', 'application/pdf', 4, 'x')`);
    await conv(id('conv-idle'), APT.cancelledRecent, ago(800));
    await conv(id('conv-live'), APT.reqFuture, ago(2));
    await db.execute(sql`INSERT INTO "ProNotification" (id, "userId", "structureId", type, title, message, "createdAt") VALUES
      (${id('pn-old')}, ${pro}, ${str}, 'X', 't', 'm', ${ago(200)}), (${id('pn-new')}, ${pro}, ${str}, 'X', 't', 'm', ${ago(10)})`);
    const push = (pid, status, fail, success = null) => db.execute(sql`INSERT INTO "PushSubscription" (id, "userId", "endpointHash", "subscriptionEncrypted", "pushHost", status, "failureCount", "lastFailureAt", "lastSuccessAt", "createdAt")
      VALUES (${pid}, ${CIT.a}, ${pid + '-h'}, 'x', 'push.example.test', ${status}, 3, ${fail}, ${success}, ${ago(300)})`);
    await push(id('push-failing-old'), 'FAILING', ago(40));
    await push(id('push-failing-new'), 'FAILING', ago(5));
    await push(id('push-recovered'), 'FAILING', ago(40), ago(2));
    await db.execute(sql`INSERT INTO "SupportRequest" (id, category, "messageEncrypted", status, "createdAt", "updatedAt", "closedAt") VALUES
      (${id('sr-old')}, 'OTHER', 'x', 'CLOSED', ${ago(500)}, ${ago(400)}, ${ago(400)}), (${id('sr-new')}, 'OTHER', 'x', 'CLOSED', ${ago(50)}, ${ago(10)}, ${ago(10)})`);
    // E11: two expired shared copies; the first is followed by the organization (a case and a note)
    blob.sd = await storage.upload(Buffer.from('%PDF'), 'application/pdf');
    const results = JSON.stringify({ _files: [{ storageKey: blob.sd }] });
    for (const sid of [id('sd-followed'), id('sd-free')]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "createdAt", "expiresAt", situation, results, "viewCount", "ownerCitizenId") VALUES (${sid}, ${ago(20)}, ${ago(1)}, '{}'::jsonb, ${results}::jsonb, 0, ${CIT.a})`);
    }
    await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "openedAt", "updatedAt") VALUES (${id('case')}, ${id('sd-followed')}, ${str}, 'NEW', ${ago(15)}, NOW())`);
    await db.execute(sql`INSERT INTO "ProCaseNote" (id, "caseId", "structureId", visibility, "bodyEncrypted") VALUES (${id('note')}, ${id('case')}, ${str}, 'INTERNAL', 'x')`);
  });

  afterAll(async () => {
    if (!db) return;
    const like = 'r44p-%-' + TS;
    for (const t of ['AppointmentNotice', 'RdvConversation', 'ProCase', 'SharedDiagnostic', 'PushSubscription', 'ProNotification', 'SupportRequest', 'ConsentLog', 'DSRRequest', 'LegalHold']) {
      await db.execute(sql.raw(`DELETE FROM "${t}" WHERE id LIKE '${like}'`));
    }
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${id('str')}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${like}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${id('pro')}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${id('svc')}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id('str')}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`);
  });

  it('refusal: the production policy (PROPOSED — NOT APPROVED) changes nothing even when enabled, pinned and every step listed', async () => {
    const before = await snapshot();
    const restore = setApprovalEnv(allSteps);
    const r = mk();
    try { await mod.default({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); } finally { restore(); }
    expect([r.statusCode, r.body.skipped, r.body.reason, r.body.mode, r.body.policy.status]).toEqual([200, true, 'POLICY_NOT_APPROVED', 'dry-run', 'PROPOSED — NOT APPROVED']);
    expect(await snapshot()).toEqual(before);
    expect(await n(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`)).toBe(0);
  });

  it('dry run (approved policy, dry run asked): counts per step, nothing changed', async () => {
    const before = await snapshot();
    const { status, body } = await run(approvalEnv(allSteps), { dryRunRequested: true });
    expect([status, body.reason]).toEqual([200, 'DRY_RUN_REQUESTED']);
    const count = (sid) => body.steps.find((l) => l.id === sid).count;
    expect(count('appointmentMessagesErased')).toBeGreaterThanOrEqual(2);
    expect(count('anonymisedAppointmentsCount')).toBeGreaterThanOrEqual(1);
    expect(count('inactiveAccountsReport')).toBeGreaterThanOrEqual(1);
    expect(await snapshot()).toEqual(before);
  });

  it('E16 partial approval: only the approved step (message erasure) executes; E5 uses the account discriminant', async () => {
    const { status, body } = await run(approvalEnv(['appointmentMessagesErased']));
    expect(status, JSON.stringify(body.failed_steps)).toBe(200);
    expect(body.appointment_messages_erased).toBeGreaterThanOrEqual(2);
    expect(body.not_approved_steps).toContain('anonymisedAppointmentsCount');
    expect((await apt('confRecent'))).toMatchObject({ notes: null, beneficiaryName: 'Jean Dupont', citizenUserId: CIT.a });   // E1: not anonymised (40 days after its date)
    expect((await apt('cancelledRecent')).notes).toBeNull();                 // cancelled 10 days ago, its date 40 days ago: +30 days from the earlier one
    expect((await apt('proRecent')).notes).toBe('note of the structure');     // no account: the structure's note is never touched
    expect((await apt('confOld')).beneficiaryName).toBe('Jean Dupont');       // not approved yet
    expect((await apt('heldOld')).notes).toBe('message');                     // legal hold
    expect((await apt('restrictedOld')).notes).toBe('message');               // art. 18 restriction
    expect((await apt('openOld')).notes).toBe('message');                     // open access request
  });

  it('full execution: E1–E5, E8, E9, E9b, E10, E11 as defined, safeguards honoured, evidence written', async () => {
    const { status, body } = await run(approvalEnv(allSteps));
    expect(status, JSON.stringify(body.failed_steps)).toBe(200);
    expect(body.status).toBe('success');
    expect(body.audit_evidence).toBe('written');
    const anon = { beneficiaryName: '[anonymisé]', beneficiaryPhone: null, citizenEmailSnapshot: null, notes: null, citizenUserId: null };
    expect(await apt('confOld')).toMatchObject({ ...anon, status: 'confirmed' });          // E1 + E2
    expect(await apt('reqStale')).toMatchObject({ ...anon, status: 'expired' });           // E3 + E4
    expect(await apt('refusedOld')).toMatchObject({ ...anon, status: 'refused' });
    expect(await apt('cancelledOld')).toMatchObject({ ...anon, status: 'cancelled' });     // E3: 3 months after the cancellation
    expect(await apt('proOld')).toMatchObject({ beneficiaryName: '[anonymisé]', notes: null });   // the structure's record, its own approved step
    for (const k of ['confRecent', 'reqFuture', 'cancelledRecent', 'proRecent']) expect((await apt(k)).beneficiaryName, k).toBe('Jean Dupont');
    expect((await apt('reqFuture')).status).toBe('requested');
    for (const k of ['heldOld', 'restrictedOld', 'openOld']) expect(await apt(k), k).toMatchObject({ beneficiaryName: 'Jean Dupont', notes: 'message' });
    // E8 / E9
    expect(await n(sql`SELECT count(*)::int AS n FROM "AppointmentNotice" WHERE id = ${id('an-old')}`)).toBe(0);
    expect(await n(sql`SELECT count(*)::int AS n FROM "AppointmentNotice" WHERE id = ${id('an-new')}`)).toBe(1);
    expect((await db.execute(sql`SELECT id FROM "RdvConversation" WHERE id LIKE ${'r44p-conv-%-' + TS} ORDER BY id`)).rows.map((r) => r.id)).toEqual([id('conv-live')]);
    expect(await n(sql`SELECT count(*)::int AS n FROM "RdvMessageAttachment" WHERE id = ${id('att')}`)).toBe(0);
    await expect(storage.download(blob.att)).rejects.toThrow();   // the attachment's file is gone too
    expect((await db.execute(sql`SELECT id FROM "ProNotification" WHERE id LIKE ${'r44p-pn-%-' + TS}`)).rows.map((r) => r.id)).toEqual([id('pn-new')]);
    expect((await db.execute(sql`SELECT id FROM "PushSubscription" WHERE id LIKE ${'r44p-push-%-' + TS} ORDER BY id`)).rows.map((r) => r.id)).toEqual([id('push-failing-new'), id('push-recovered')]);
    // E9b
    expect((await db.execute(sql`SELECT id FROM "LegalHold" WHERE id LIKE ${'r44p-lh-%-' + TS} ORDER BY id`)).rows.map((r) => r.id)).toEqual([id('lh-dsr'), id('lh-held'), id('lh-rel-new')].sort());
    expect((await db.execute(sql`SELECT id FROM "SupportRequest" WHERE id LIKE ${'r44p-sr-%-' + TS}`)).rows.map((r) => r.id)).toEqual([id('sr-new')]);
    // E10 then E9b in dependency order: the consents of a person erased 12 months ago go (the latest decision included); then a 3-year-old erasure request
    // whose consents are gone; a held person's consents (and so its request) stay; a partial erasure (account still there) keeps them
    const consents = (await db.execute(sql`SELECT subject_id FROM "ConsentLog" WHERE purpose = 'R44P' AND subject_id LIKE ${'r44p-erased-%-' + TS} ORDER BY subject_id`)).rows.map((r) => r.subject_id);
    expect(consents).toEqual([ERASED.dsrHeld, ERASED.partial, ERASED.recent].sort());
    const dsrs = (await db.execute(sql`SELECT id FROM "DSRRequest" WHERE id LIKE ${'r44p-dsr-%-' + TS} ORDER BY id`)).rows.map((r) => r.id);
    expect(dsrs).not.toContain(id('dsr-e-dsrold'));
    expect(dsrs).not.toContain(id('dsr-access-old'));
    expect(dsrs).toEqual(expect.arrayContaining([id('dsr-e-dsrheld'), id('dsr-e-old'), id('dsr-restr'), id('dsr-open')]));
    // E11: the followed copy is redacted (row kept, files deleted), its case and note survive; the free copy is deleted
    const followed = await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${id('sd-followed')}`);
    expect(followed.results).toMatchObject({ _redacted: 'r44-e11' });
    expect(await n(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id = ${id('sd-free')}`)).toBe(0);
    expect(await n(sql`SELECT count(*)::int AS n FROM "ProCase" WHERE id = ${id('case')}`)).toBe(1);
    expect(await n(sql`SELECT count(*)::int AS n FROM "ProCaseNote" WHERE id = ${id('note')}`)).toBe(1);
    await expect(storage.download(blob.sd)).rejects.toThrow();
    // E7: report only — the inactive account is counted, never deleted
    expect(body.steps.find((l) => l.id === 'inactiveAccountsReport')).toMatchObject({ decision: 'report_only' });
    expect(await n(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${CIT.inactive}`)).toBe(1);
    // evidence: one row, counts only
    const ev = await one(sql`SELECT details FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN' ORDER BY timestamp DESC LIMIT 1`);
    expect(ev.details.executed.anonymisedAppointmentsCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(ev.details)).not.toMatch(/Jean|@example|r44p-cit/);
  });

  it('idempotent: a second run changes nothing of the fixture and fails nothing', async () => {
    const before = await snapshot();
    const { status, body } = await run(approvalEnv(allSteps));
    expect([status, body.failed_steps]).toEqual([200, undefined]);
    expect(await snapshot()).toEqual(before);
  });

  it('concurrency: a run while another holds the lock answers 409 and changes nothing; two simultaneous runs never fail or double-apply', async () => {
    const before = await snapshot();
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL }); await other.connect();
    try {
      await other.query('BEGIN'); await other.query(`SELECT pg_advisory_xact_lock(hashtext('ada:gdpr-purge'))`);
      const blocked = await run(approvalEnv(allSteps));
      expect([blocked.status, blocked.body.reason]).toEqual([409, 'ALREADY_RUNNING']);
    } finally { await other.query('ROLLBACK').catch(() => {}); await other.end(); }
    const both = await Promise.all([run(approvalEnv(allSteps)), run(approvalEnv(allSteps))]);
    for (const r of both) { expect([200, 409]).toContain(r.status); expect(r.body.failed_steps).toBeUndefined(); }
    expect(both.some((r) => r.status === 200)).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});
