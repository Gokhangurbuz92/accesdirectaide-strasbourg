/**
 * G14-R4 — X05 job board moderation end to end on REAL PostgreSQL (migrations 0056 / 0059 applied), with a NAMED sole moderator (owner model):
 * a published listing of a verified employer → a public notice (art. 16) → the queue shows its 24 h / 7-day deadline → a takedown with facts (art. 17)
 * through the job board's own action → the statement of reasons reaches the employer's ADMINISTRATOR (self-registered role « STRUCTURE_ADMIN ») →
 * the notice is closed « action taken » and the notifier is told → the notifier appeals with its code; the sole moderator reviews only after 24 h (art. 20)
 * → a warning, then a suspension of the notifier address for misuse (art. 23) → the content-free SLA counts.
 * FIXTURES: synthetic accounts and texts (example.test, « FIXTURE »), deleted afterwards. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const T = `r4x5${Date.now().toString(36)}`;
const DAY = 86400e3; const HOUR = 3600e3;
const MOD = `${T}-mod@example.test`; const EMPLOYER = `${T}-rh@example.test`; const NOTIFIER = `${T}-notifier@example.test`;
const STR = `${T}-str`; const JOB = `${T}-job`;
const TEXT = 'FIXTURE SYNTHÉTIQUE — description d’un poste d’agent d’accueil, assez longue pour la règle des cinquante caractères.';

describe.skipIf(!hasDatabase)('G14-R4 — X05 moderation end to end (real DB, sole named moderator)', () => {
  let db; let dsa; let jobs; let sent = [];
  const send = async (m) => { sent.push(m); return { delivered: true, outcome: 'TEST_RECORDED' }; };
  const one = async (q) => (await db.execute(q)).rows[0];
  let clock = new Date();
  const now = () => clock;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    dsa = await import('../../api/_services/moderation-dsa.js');
    jobs = await import('../../api/_services/job-board.js');
    await db.execute(sql`UPDATE "ModerationRole" SET "revokedAt" = NOW(), "revokedBy" = 'r4-test' WHERE "revokedAt" IS NULL`);
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName")
      VALUES (${`${T}-a1`}, ${MOD}, 'x', 'admin', NOW(), NOW(), 0, true, 'Modérateur Fixture')`);
    await dsa.roleAdministration({ db }).assign('r4-owner', { email: MOD, role: 'MODERATOR', charterAcknowledged: true });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${STR}, 'Employeur FIXTURE', ${`${T}-slug`}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, "structureId", status, "updatedAt") VALUES (${`${T}-pro`}, ${EMPLOYER}, 'x', 'STRUCTURE_ADMIN', ${STR}, 'active', NOW())`);
    await db.execute(sql`INSERT INTO "JobListing" (id, "structureId", status, title, "contractType", city, "postalCode", description, accommodations, "applyMethod", "applyTarget", "expiresOn", "publishedAt", "moderatedBy", "moderatedAt", "updatedAt")
      VALUES (${JOB}, ${STR}, 'published', 'Agent FIXTURE', 'CDI', 'Strasbourg', '67000', ${TEXT}, '{FLEXIBLE_HOURS}', 'email', ${EMPLOYER}, '2099-01-01', NOW(), 'r4', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ModerationAppeal" WHERE "decisionId" IN (SELECT id FROM "ModerationDecision" WHERE "contentId" LIKE ${`${T}%`} OR "decidedBy" = ${MOD})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ModerationDecision" WHERE "contentId" LIKE ${`${T}%`} OR "decidedBy" = ${MOD}`);
    await db.execute(sql`DELETE FROM "ContentNotice" WHERE "contentRef" LIKE ${`%${T}%`}`);
    await db.execute(sql`DELETE FROM "ModerationSanction" WHERE "createdBy" = ${MOD}`);
    await db.execute(sql`DELETE FROM "ModerationRole" WHERE "adminUserId" = ${`${T}-a1`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "JobListing" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
    await db.execute(sql`DELETE FROM "AdminUser" WHERE id = ${`${T}-a1`}`).catch(() => {});
  });

  let noticeId; let urgentId; let decisionId; let code;
  it('art. 16: two public notices on the listing — the urgent one is due in 24 h, the other in 7 days; the queue shows the deadline, never the address', async () => {
    const notices = dsa.contentNotices({ db, send, now });
    const base = { contentType: 'job_listing', contentRef: `https://example.test/offres-emploi#${T}`, explanation: 'FIXTURE : l’offre exige une information sur la santé, ce qui est interdit.', goodFaith: true };
    const ok = await notices.submit({ ...base, category: 'ILLEGAL_CONTENT', notifierName: 'Fixture', notifierEmail: NOTIFIER });
    const urgent = await notices.submit({ ...base, category: 'SAFETY_THREAT', notifierName: 'Fixture', notifierEmail: NOTIFIER });
    expect([ok.priority, urgent.priority]).toEqual(['ordinary', 'urgent']);
    noticeId = ok.id; urgentId = urgent.id;
    const acks = sent.filter((m) => m.category === 'moderation-notice-ack' && m.to === NOTIFIER);
    expect(acks).toHaveLength(2);
    code = /gardez ce code : (\S+)/.exec(acks[1].text)[1];   // the code of the urgent notice
    const queue = (await notices.list(MOD)).filter((x) => [ok.id, urgent.id].includes(x.id));
    expect(queue.map((x) => x.id)).toEqual([urgent.id, ok.id]);   // urgent first
    const [u, o] = queue;
    expect(new Date(u.dueAt).getTime() - new Date(u.createdAt).getTime()).toBe(24 * HOUR);
    expect(new Date(o.dueAt).getTime() - new Date(o.createdAt).getTime()).toBe(7 * 24 * HOUR);
    expect([u.overdue, o.overdue]).toEqual([false, false]);
    expect(JSON.stringify(queue)).not.toContain(NOTIFIER);
    clock = new Date(Date.now() + 25 * HOUR);   // a day later: the urgent notice is late
    const sla = await dsa.contentNotices({ db, now }).slaStatus();
    expect(sla.overdueUrgent).toBeGreaterThanOrEqual(1);
    expect((await dsa.contentNotices({ db, now }).list(MOD)).find((x) => x.id === urgent.id).overdue).toBe(true);
    clock = new Date();
  });

  it('art. 17: takedown with facts through the job board action; the statement reaches the employer administrator; the notice is closed and the notifier told', async () => {
    sent = [];
    const mod = jobs.jobModeration({ db });
    const run = () => mod.takedown(MOD, JOB, 'HEALTH_DATA_REQUESTED');
    await expect(dsa.moderatedAction({ db, send }, { actor: MOD, contentType: 'job_listing', contentId: JOB, decisionAction: 'taken_down', reasonCode: 'HEALTH_DATA_REQUESTED', body: { noticeId }, run }))
      .rejects.toMatchObject({ code: 'FACTS_REQUIRED' });
    expect((await one(sql`SELECT status FROM "JobListing" WHERE id = ${JOB}`)).status).toBe('published');
    const out = await dsa.moderatedAction({ db, send }, { actor: MOD, contentType: 'job_listing', contentId: JOB, decisionAction: 'taken_down', reasonCode: 'HEALTH_DATA_REQUESTED',
      body: { noticeId, facts: 'FIXTURE : l’offre demande un certificat médical avant l’entretien.' }, run });
    expect(out).toMatchObject({ status: 'taken_down', statementChannel: 'email' });
    decisionId = out.decisionId;
    const toEmployer = sent.find((m) => m.to === EMPLOYER && m.category === 'moderation-statement');
    expect(toEmployer, 'the self-registered administrator (role STRUCTURE_ADMIN) receives the statement').toBeTruthy();
    for (const part of ['Faits et circonstances', 'Moyens automatisés : aucun', 'Vos recours']) expect(toEmployer.text).toContain(part);
    expect(toEmployer.text).not.toContain(NOTIFIER);
    expect((await one(sql`SELECT * FROM "ModerationDecision" WHERE id = ${decisionId}`))).toMatchObject({ subjectStructureId: STR, automated: false, noticeId });
    // the takedown linked to the notice closes it « action taken » in the same step (a second close is refused)
    await expect(dsa.contentNotices({ db, send }).close(MOD, noticeId, { outcome: 'action_taken', decisionId })).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    expect((await one(sql`SELECT status, outcome FROM "ContentNotice" WHERE id = ${noticeId}`))).toMatchObject({ status: 'decided', outcome: 'action_taken' });
    expect(sent.some((m) => m.to === NOTIFIER && m.category === 'moderation-notice-decision')).toBe(true);
    const pub = await jobs.publicListings({ db });
    expect(pub.some((x) => x.id === JOB)).toBe(false);
  });

  it('art. 20 + 23: the urgent notice closed « no action »; the notifier appeals with its code; the sole moderator reviews only after 24 h; misuse → warning then suspension', async () => {
    sent = [];
    const notices = dsa.contentNotices({ db, send });
    await notices.close(MOD, urgentId, { outcome: 'no_action', facts: 'FIXTURE : aucune menace dans l’offre.' });
    const ap = await dsa.noticeAppeal({ db }, { noticeId: urgentId, code, body: 'FIXTURE : je conteste, l’offre reste dangereuse selon moi.' });
    expect(ap).toMatchObject({ status: 201 });
    const appealId = ap.id || ap.appealId || (await one(sql`SELECT a.id FROM "ModerationAppeal" a JOIN "ModerationDecision" d ON d.id = a."decisionId" WHERE d."noticeId" = ${urgentId}`)).id;
    const desk = dsa.moderationDesk({ db, send });
    await expect(desk.reviewAppeal(MOD, appealId, { outcome: 'upheld', response: 'FIXTURE : réexamen.' })).rejects.toMatchObject({ code: 'SOLE_MODERATOR_DELAY' });
    const later = dsa.moderationDesk({ db, send, now: () => new Date(Date.now() + 25 * HOUR) });
    expect(await later.reviewAppeal(MOD, appealId, { outcome: 'upheld', response: 'FIXTURE : réexamen après délai.' })).toMatchObject({ soleModerator: true });
    const notices2 = dsa.contentNotices({ db, send, vars: { ADA_ENCRYPTION_KEY: '0'.repeat(64) } });
    const again = await notices2.submit({ contentType: 'job_listing', contentRef: `https://example.test/offres-emploi#${T}-1`, category: 'TERMS_VIOLATION', explanation: 'FIXTURE : signalement infondé numéro un.', notifierName: 'Fixture', notifierEmail: NOTIFIER, goodFaith: true });
    await expect(desk.sanction(MOD, { kind: 'suspension', scope: 'notices', noticeId: again.id, reason: 'FIXTURE : récidive.', days: 30 })).rejects.toMatchObject({ code: 'PRIOR_WARNING_REQUIRED' });
    await desk.sanction(MOD, { kind: 'warning', scope: 'notices', noticeId: again.id, reason: 'FIXTURE : signalements infondés répétés.' });
    await desk.sanction(MOD, { kind: 'suspension', scope: 'notices', noticeId: again.id, reason: 'FIXTURE : récidive.', days: 30 });
    expect(await notices2.submit({ contentType: 'job_listing', contentRef: `https://example.test/offres-emploi#${T}-2`, category: 'TERMS_VIOLATION', explanation: 'FIXTURE : encore un signalement infondé.',
      notifierName: 'Fixture', notifierEmail: NOTIFIER, goodFaith: true })).toMatchObject({ status: 403, code: 'NOTICES_SUSPENDED' });
  });
});
