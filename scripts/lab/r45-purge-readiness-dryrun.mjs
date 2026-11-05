#!/usr/bin/env node
/**
 * R45 / ENG-LR-9 — purge readiness on a SYNTHETIC 0042 database (LAB only; the Production purge stays CLOSED). Counts only, never a value.
 *
 *   node --import tsx scripts/lab/r45-purge-readiness-dryrun.mjs --out <evidence dir> --work <scratch dir> [--keep]
 *
 *   1 a database at the Production shape 0042 (ada_r45_ops_purge_test), the synthetic seed (scripts/lab/r45-synthetic-seed.mjs) and protected fixtures:
 *     a person under legal hold, a person with an ACTIVE restriction (art. 18), a person with an open access request — each with old appointments,
 *     messages, a conversation (all eligible but for the protection); an emergency access never reviewed; followed shared copies (ProCase, thread)
 *   2 the PRODUCTION policy (PROPOSED — NOT APPROVED, A7 open), GDPR_PURGE_ENABLED=true and every step listed: dry run, per-step counts (A7: per option)
 *   3 the same counts with the protections removed (clone): the difference is what holds / restriction / open requests keep, per step
 *   4 execution on disposable clones with a TEST copy of the policy approved (A7 = 365, then A7 = 730; every step approved): executed = dry-run count for
 *     every step; then the safeguards are checked on the data (protected people untouched, structure records kept, no account deleted, latest consents
 *     kept, audit of held records kept, emergency access kept until reviewed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedRealistic, countAll } from './r45-synthetic-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIG = path.join(ROOT, 'drizzle');
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
if (!arg('--out') || !arg('--work')) { console.error('PURGE_READINESS {"ok":false,"reason":"--out and --work are required"}'); process.exit(3); }
const OUT = path.resolve(String(arg('--out'))); const WORK = path.resolve(String(arg('--work')));
const keep = process.argv.includes('--keep');
const DB = { P: 'ada_r45_ops_purge_test', NOPROT: 'ada_r45_ops_purgenp_test', X365: 'ada_r45_ops_purgex365_test', X730: 'ada_r45_ops_purgex730_test' };
for (const n of Object.values(DB)) if (!/^ada_r45_ops_[a-z0-9_]+_test$/.test(n)) process.exit(3);
const url = (db) => `postgresql://ada_test@127.0.0.1:55434/${db}`;
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
Object.assign(process.env, Object.fromEntries(['JWT_SECRET', 'AUTH_SECRET', 'ADA_ENCRYPTION_KEY', 'CRON_SECRET', 'ADMIN_TOKEN'].map((k) => [k, crypto.randomBytes(32).toString('hex')])),
  { DATABASE_URL: url(DB.P), NODE_ENV: 'test', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab', LOG_LEVEL: 'silent' });

const checks = [];
const check = (label, ok, detail) => { const d = detail === undefined ? undefined : JSON.stringify(detail); checks.push({ label, ok: Boolean(ok), ...(d ? { detail: d.slice(0, 1500) } : {}) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${d ? ` — ${d.slice(0, 260)}` : ''}`); };
async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const admin = (sqls) => withClient('postgres', async (c) => { for (const s of sqls) await c.query(s); });
const dropAll = () => admin(Object.values(DB).map((d) => `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`));
const clone = (src, db) => admin([`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, `CREATE DATABASE ${db} TEMPLATE ${src}`, `ALTER DATABASE ${db} SET timezone TO 'UTC'`]);
const journal = JSON.parse(fs.readFileSync(path.join(MIG, 'meta', '_journal.json'), 'utf8'));
const stage = (name, maxIdx) => {
  const d = path.join(WORK, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(path.join(d, 'meta'), { recursive: true });
  const entries = journal.entries.filter((e) => e.idx <= maxIdx);
  for (const e of entries) fs.copyFileSync(path.join(MIG, `${e.tag}.sql`), path.join(d, `${e.tag}.sql`));
  fs.writeFileSync(path.join(d, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return d;
};

const PROTECTED = { held: 'r45-c-0014', restricted: 'r45-c-0012', openDsr: 'r45-c-0011' };
/** protected fixtures: every one would be purged without its protection */
async function fixtures(c) {
  for (const who of Object.values(PROTECTED)) {
    await c.query(`UPDATE "ProAppointment" SET "startAt" = now() - interval '900 days', "endAt" = now() - interval '900 days' + interval '30 minutes', status = 'done', notes = 'Message synthétique', "cancelledAt" = NULL
      WHERE "citizenUserId" = $1`, [who]);
    const a = (await c.query(`SELECT id, "structureId" FROM "ProAppointment" WHERE "citizenUserId" = $1 ORDER BY id LIMIT 1`, [who])).rows[0];
    const conv = (await c.query(`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now() - interval '800 days', now() - interval '900 days', now())
      ON CONFLICT ("appointmentId") DO UPDATE SET "lastMessageAt" = EXCLUDED."lastMessageAt" RETURNING id`, [`r45-conv-fx-${who}`, a.id, a.structureId, who])).rows[0].id;
    await c.query(`UPDATE "RdvConversation" SET "lastMessageAt" = now() - interval '800 days' WHERE "citizenUserId" = $1`, [who]);
    await c.query(`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", body, "createdAt") VALUES ($1, $2, 'CITIZEN', $3, 'Texte synthétique', now() - interval '800 days')`, [`r45-msg-fx-${who}`, conv, who]);
    await c.query(`UPDATE "SharedDiagnostic" SET "createdAt" = now() - interval '200 days', "expiresAt" = now() - interval '190 days' WHERE "ownerCitizenId" = $1`, [who]);
  }
  await c.query(`INSERT INTO "AuditLog" (id, action, actor, details, timestamp, entity, entity_id) VALUES ('r45-al-bg-open', 'BREAK_GLASS_OPENED', 'synthetic', '{}', now() - interval '400 days', 'BreakGlass', 'r45-bg-1')`);
}

/** what must survive any purge run (counts, computed the same way before and after) */
async function invariants(c) {
  const n = async (q, p = []) => Number((await c.query(q, p)).rows[0].n);
  const P = Object.values(PROTECTED);
  return {
    citizenAccounts: await n(`SELECT count(*)::int n FROM "CitizenUser"`),
    protectedAppointmentsIntact: await n(`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = ANY($1) AND notes IS NOT NULL AND "beneficiaryName" <> '[anonymisé]'`, [P]),
    protectedConversations: await n(`SELECT count(*)::int n FROM "RdvConversation" WHERE "citizenUserId" = ANY($1)`, [P]),
    protectedDossiers: await n(`SELECT count(*)::int n FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ANY($1)`, [P]),
    heldStructureAppointmentsIntact: await n(`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = 'r45-str-03' AND "beneficiaryName" <> '[anonymisé]'`),
    structureCases: await n(`SELECT count(*)::int n FROM "ProCase"`),
    structureCaseNotes: await n(`SELECT count(*)::int n FROM "ProCaseNote"`),
    structureThreads: await n(`SELECT count(*)::int n FROM "SharedDossierThread"`),
    structureThreadMessages: await n(`SELECT count(*)::int n FROM "SharedDossierMessage"`),
    followedDossiers: await n(`SELECT count(*)::int n FROM "SharedDiagnostic" d WHERE EXISTS (SELECT 1 FROM "ProCase" p WHERE p."sharedDiagnosticId" = d.id) OR EXISTS (SELECT 1 FROM "SharedDossierThread" t WHERE t."sharedDiagnosticId" = d.id)`),
    latestConsentOfLiveAccounts: await n(`SELECT count(*)::int n FROM (SELECT DISTINCT ON (subject_id, purpose) id FROM "ConsentLog" c WHERE EXISTS (SELECT 1 FROM "CitizenUser" u WHERE u.id = c.subject_id) ORDER BY subject_id, purpose, created_at DESC) x`),
    ageDeclarationsOfLiveAccounts: await n(`SELECT count(*)::int n FROM "ConsentLog" c WHERE purpose = 'AGE_DECLARATION_ADULT' AND EXISTS (SELECT 1 FROM "CitizenUser" u WHERE u.id = c.subject_id)`),
    auditOfHeldRecords: await n(`SELECT count(*)::int n FROM "AuditLog" a WHERE a.entity_id = $1 OR a.actor_id = $1`, [PROTECTED.held]),
    breakGlassUnreviewed: await n(`SELECT count(*)::int n FROM "AuditLog" WHERE id = 'r45-al-bg-open'`),
    activeLegalHolds: await n(`SELECT count(*)::int n FROM "LegalHold" WHERE status = 'ACTIVE'`),
    activeRestrictions: await n(`SELECT count(*)::int n FROM "DSRRequest" WHERE "requestType" = 'RESTRICT' AND status = 'ACTIVE'`),
    openRequests: await n(`SELECT count(*)::int n FROM "DSRRequest" WHERE "requestType" <> 'DELETE' AND status IN ('RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW')`),
    erasureProofsWithinPeriod: await n(`SELECT count(*)::int n FROM "DSRRequest" r WHERE r."requestType" = 'DELETE' AND r.status = 'COMPLETED' AND r."completedAt" > now() - interval '1095 days'`),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  await dropAll();
  await admin([`CREATE DATABASE ${DB.P} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${DB.P} SET timezone TO 'UTC'`]);
  await withClient(DB.P, async (c) => { for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`); });
  for (const [n, i] of [['p41', 41], ['p42', 42]]) { const pool = new pg.Pool({ connectionString: url(DB.P), max: 2 }); try { await migrate(drizzle(pool), { migrationsFolder: stage(n, i) }); } finally { await pool.end(); } }
  const hist = await withClient(DB.P, async (c) => Number((await c.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n));
  check('database at 0042 (43 history rows), synthetic seed + protected fixtures', hist === 43);
  await withClient(DB.P, async (c) => { await seedRealistic(c); await fixtures(c); });
  const seeded = await withClient(DB.P, (c) => countAll(c));

  const schema = await import('../../src/db/schema.js');
  const { runGdprPurge, PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
  const { approvedTestPolicy, approvalEnv, executableStepIds } = await import('../../tests/helpers/gdpr-purge-approval.js');
  const all = executableStepIds(PURGE_STEPS);
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const runOn = async (db, opts) => { const pool = new pg.Pool({ connectionString: url(db), max: 3 }); try { return await runGdprPurge({ database: drizzle(pool, { schema }), logger: quiet, ...opts }); } finally { await pool.end(); } };
  const now = new Date();

  // 2. production policy dry run
  const before = await withClient(DB.P, (c) => countAll(c));
  const prod = await runOn(DB.P, { now, env: { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: 'r45-proposal-2-2026-11-05', GDPR_PURGE_APPROVED_STEPS: all.join(',') } });
  const afterProd = await withClient(DB.P, (c) => countAll(c));
  check('production policy (PROPOSED, A7 open), enabled + every step listed: DRY RUN, zero rows changed, no evidence row', prod.body.mode === 'dry-run' && prod.body.reason === 'POLICY_NOT_APPROVED' && JSON.stringify(before) === JSON.stringify(afterProd),
    { reason: prod.body.reason, ownerChoiceOpen: prod.body.policy.ownerChoicesOpen, ownerChoiceSteps: prod.body.owner_choice_required_steps });
  const inv0 = await withClient(DB.P, (c) => invariants(c));

  // 3. protections removed (clone): what the safeguards keep, per step
  await clone(DB.P, DB.NOPROT);
  await withClient(DB.NOPROT, async (c) => {
    await c.query(`DELETE FROM "LegalHold" WHERE status = 'ACTIVE'`);
    await c.query(`DELETE FROM "DSRRequest" WHERE ("requestType" = 'RESTRICT' AND status = 'ACTIVE') OR ("requestType" <> 'DELETE' AND status IN ('RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW'))`);
  });
  const dryApproved = async (db, a7) => (await runOn(db, { now, policy: approvedTestPolicy({ a7 }), env: approvalEnv(all, { a7 }), dryRunRequested: true })).body;
  const d730 = await dryApproved(DB.P, 730); const d365 = await dryApproved(DB.P, 365); const np730 = await dryApproved(DB.NOPROT, 730);

  // 4. execution on clones (test copy approved), A7 = 365 and 730
  const exec = {};
  for (const [db, a7] of [[DB.X365, 365], [DB.X730, 730]]) {
    await clone(DB.P, db);
    const r = await runOn(db, { now, policy: approvedTestPolicy({ a7 }), env: approvalEnv(all, { a7 }) });
    exec[a7] = { status: r.status, body: r.body, inv: await withClient(db, (c) => invariants(c)), counts: await withClient(db, (c) => countAll(c)) };
  }

  const rows = PURGE_STEPS.map((s) => {
    const p = prod.body.steps.find((l) => l.id === s.id);
    const e365 = exec[365].body.steps.find((l) => l.id === s.id); const e730 = exec[730].body.steps.find((l) => l.id === s.id);
    const dr365 = d365.steps.find((l) => l.id === s.id); const dr730 = d730.steps.find((l) => l.id === s.id); const np = np730.steps.find((l) => l.id === s.id);
    return { id: s.id, ecode: s.ecode, kind: s.kind, table: s.table, durationKey: s.durationKey, sharedController: Boolean(s.sharedController),
      productionDecision: p.decision, productionCount: p.count, productionCountsByOption: p.countsByOption ?? null,
      dry365: dr365.count, exec365: e365.count, exec365Decision: e365.decision, dry730: dr730.count, exec730: e730.count, exec730Decision: e730.decision,
      protectedBySafeguards: (np.count ?? 0) - (dr730.count ?? 0) };
  });
  // dependent steps (notices, conversations of anonymised appointments) are counted BEFORE the anonymisation in a dry run: their executed count is ≥ the dry run
  const dependent = new Set(PURGE_STEPS.filter((s) => (s.dependsOn || []).length).map((s) => s.id));
  for (const a7 of [365, 730]) {
    const mism = rows.filter((r) => r.kind !== 'report' && !dependent.has(r.id) && r[`exec${a7}Decision`] === 'executed' && r[`exec${a7}`] !== r[`dry${a7}`]).map((r) => r.id);
    check(`A7 = ${a7} (test copy): every independent executed step touched exactly its dry-run count`, mism.length === 0 && exec[a7].status === 200, { mismatched: mism, status: exec[a7].status, failed: exec[a7].body.failed_steps });
  }
  for (const id of ['anonymisedAppointmentsCount', 'appointmentsStructureRecordAnonymised']) {
    const r = rows.find((x) => x.id === id);
    check(`A7 dry run per option = the count each option executes (${id})`, r.productionCountsByOption?.['365'] === r.exec365 && r.productionCountsByOption?.['730'] === r.exec730 && r.exec365 >= r.exec730, { byOption: r.productionCountsByOption, exec365: r.exec365, exec730: r.exec730 });
  }
  for (const a7 of [365, 730]) {
    const i = exec[a7].inv;
    check(`A7 = ${a7}: legal hold, restriction and open request honoured — the protected people's appointments, messages, conversations and dossiers untouched`,
      i.protectedAppointmentsIntact === inv0.protectedAppointmentsIntact && i.protectedConversations === inv0.protectedConversations && i.protectedDossiers === inv0.protectedDossiers && i.heldStructureAppointmentsIntact === inv0.heldStructureAppointmentsIntact, { before: inv0, after: i });
    check(`A7 = ${a7}: structure records kept (cases, notes, threads, thread messages; followed copies redacted, not deleted)`,
      i.structureCases === inv0.structureCases && i.structureCaseNotes === inv0.structureCaseNotes && i.structureThreads === inv0.structureThreads && i.structureThreadMessages === inv0.structureThreadMessages && i.followedDossiers === inv0.followedDossiers);
    check(`A7 = ${a7}: no account deleted; latest consent decision and the 18+ declaration of every live account kept`,
      i.citizenAccounts === inv0.citizenAccounts && i.latestConsentOfLiveAccounts === inv0.latestConsentOfLiveAccounts && i.ageDeclarationsOfLiveAccounts === inv0.ageDeclarationsOfLiveAccounts);
    check(`A7 = ${a7}: audit trail of a held person kept, unreviewed emergency access kept, protections themselves kept, erasure proofs (the replay ledger source) kept for their period`,
      i.auditOfHeldRecords === inv0.auditOfHeldRecords && i.breakGlassUnreviewed === 1 && i.activeLegalHolds === inv0.activeLegalHolds && i.activeRestrictions === inv0.activeRestrictions && i.openRequests === inv0.openRequests
      && i.erasureProofsWithinPeriod === inv0.erasureProofsWithinPeriod && inv0.erasureProofsWithinPeriod >= 1, { auditOfHeld: [inv0.auditOfHeldRecords, i.auditOfHeldRecords], erasureProofs: [inv0.erasureProofsWithinPeriod, i.erasureProofsWithinPeriod] });
    check(`A7 = ${a7}: one GDPR_PURGE_RUN evidence row (counts and step ids only)`, exec[a7].body.audit_evidence === 'written');
  }
  check('the safeguards keep rows in the person-linked steps (dry run with protections removed counts more)', rows.filter((r) => r.protectedBySafeguards > 0).length >= 4,
    rows.filter((r) => r.protectedBySafeguards > 0).map((r) => [r.id, r.protectedBySafeguards]));

  if (!keep) await dropAll();
  for (const s of ['p41', 'p42']) fs.rmSync(path.join(WORK, s), { recursive: true, force: true });
  const left = await withClient('postgres', async (c) => Number((await c.query(`select count(*)::int n from pg_database where datname = ANY($1)`, [Object.values(DB)])).rows[0].n));
  check('databases dropped', keep || left === 0);
  const report = { kind: 'r45-purge-readiness', synthetic: true, production: false, startedAt, finishedAt: new Date().toISOString(), policyVersion: prod.body.policy.version,
    policyStatus: prod.body.policy.status, seeded: Object.fromEntries(Object.entries(seeded).filter(([, v]) => v > 0)), invariantsBefore: inv0, steps: rows, checks, ok: checks.every((x) => x.ok) };
  fs.writeFileSync(path.join(OUT, 'purge-readiness-dryrun.json'), JSON.stringify(report, null, 1));
  console.log(`PURGE_READINESS ${JSON.stringify({ ok: report.ok, checks: checks.length, failed: checks.filter((x) => !x.ok).length })}`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch(async (e) => { console.error(`PURGE_READINESS {"ok":false,"message":${JSON.stringify(String(e?.message || e).slice(0, 300))}}`); try { if (!keep) await dropAll(); } catch { /* best effort */ } process.exitCode = 2; });
