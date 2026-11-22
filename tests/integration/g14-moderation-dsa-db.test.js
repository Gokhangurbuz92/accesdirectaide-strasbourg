/**
 * G14 (owner decisions 22/11/2026, formulaire G14) — named moderation roles (fail closed), DSA flows (art. 16 notices, 17 statements, 20 appeals,
 * 23 misuse measures) and the 25 expansion purge steps, on REAL PostgreSQL (migration 0059 applied).
 * FIXTURES: every account, text and address below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » texts); deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const T = TS.toString(36);
const DAY = 86400e3;
const ago = (d) => new Date(Date.now() - d * DAY);
const A = { mod1: `g14-mod1-${T}@example.test`, mod2: `g14-mod2-${T}@example.test`, safety: `g14-safe-${T}@example.test`, nomfa: `g14-nomfa-${T}@example.test`, noname: `g14-noname-${T}@example.test` };
const U = { author: `g14-author-${T}`, reporter: `g14-rep-${T}`, other: `g14-other-${T}` };
const BODY = 'FIXTURE SYNTHÉTIQUE — un témoignage de test assez long pour la règle de longueur.';
const STORY = 'FIXTURE SYNTHÉTIQUE — une histoire de test, assez longue pour passer la règle des cinquante caractères.';
const FACTS = 'FIXTURE : le texte nomme une personne reconnaissable (test).';

describe.skipIf(!hasDatabase)('G14 — moderation roles, DSA flows and expansion purge (real DB)', () => {
  let db; let dsa; let sent;
  const send = async (m) => { sent.push(m); return { delivered: true, outcome: 'TEST_RECORDED' }; };
  const one = async (q) => (await db.execute(q)).rows[0];
  const n = async (q) => Number((await one(q))?.n ?? 0);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    dsa = await import('../../api/_services/moderation-dsa.js');
    const admin = (id, email, mfa, name) => sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName")
      VALUES (${id}, ${email}, 'x', 'admin', NOW(), NOW(), 0, ${mfa}, ${name})`;
    await db.execute(admin(`g14-a1-${T}`, A.mod1, true, 'Modératrice Fixture'));
    await db.execute(admin(`g14-a2-${T}`, A.mod2, true, 'Suppléant Fixture'));
    await db.execute(admin(`g14-a3-${T}`, A.safety, true, 'Référente Fixture'));
    await db.execute(admin(`g14-a4-${T}`, A.nomfa, false, 'Sans MFA'));
    await db.execute(admin(`g14-a5-${T}`, A.noname, true, null));
    const schema = await import('../../src/db/schema.js');
    for (const id of Object.values(U)) await db.insert(schema.CitizenUser).values({ id, email: `${id}@example.test`, passwordHash: 'x', emailVerifiedAt: new Date() });
    // no role may pre-exist in this database (the test checks « no named moderator »)
    await db.execute(sql`UPDATE "ModerationRole" SET "revokedAt" = NOW(), "revokedBy" = 'g14-test' WHERE "revokedAt" IS NULL`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ModerationDecision" WHERE "decidedBy" LIKE ${'g14-%'} OR "subjectUserId" LIKE ${'g14-%'} OR "contentId" LIKE ${'%' + T + '%'}`);
    await db.execute(sql`DELETE FROM "ContentNotice" WHERE "contentRef" LIKE ${'%' + T + '%'}`);
    await db.execute(sql`DELETE FROM "ModerationSanction" WHERE "createdBy" LIKE ${'g14-%'}`);
    await db.execute(sql`DELETE FROM "AdminUser" WHERE id LIKE ${'g14-a%-' + T}`);
    await db.execute(sql`DELETE FROM "JobListing" WHERE "structureId" = ${`g14-str-${T}`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${`g14-str-${T}`}`);
    await db.execute(sql`DELETE FROM "AcademyItem" WHERE id LIKE ${'g14-ev%-' + T}`);
    await db.execute(sql`DELETE FROM "LegalHold" WHERE "recordId" LIKE ${'g14-%'}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id LIKE ${'g14-%'}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'g14-%-' + T}`);
  });

  describe('named roles — fail closed', () => {
    it('no named moderator: every expansion feature that needs a person refuses (503 MODERATION_NOT_STAFFED); X04 events need nobody', async () => {
      const s = await dsa.staffingState(db);
      expect(s.available).toBe(true);
      for (const f of ['testimonials', 'stories', 'employment', 'notices', 'entraide']) expect(s.features[f].staffed, f).toBe(false);
      expect(s.features.events.staffed).toBe(true);
      expect(await dsa.requireFeatureStaffed(db, 'testimonials')).toMatchObject({ status: 503, code: 'MODERATION_NOT_STAFFED', reason: 'NO_NAMED_MODERATOR' });
      expect(await dsa.requireStaffRole(db, A.mod1, 'testimonials')).toMatchObject({ status: 503 });
    });
    it('a role goes only to an existing, enabled, MFA, NAMED administrator account, with the charter acknowledged', async () => {
      const roles = dsa.roleAdministration({ db });
      await expect(roles.assign('g14-owner', { email: A.nomfa, role: 'MODERATOR', charterAcknowledged: true })).rejects.toMatchObject({ code: 'ADMIN_MFA_REQUIRED' });
      await expect(roles.assign('g14-owner', { email: A.noname, role: 'MODERATOR', charterAcknowledged: true })).rejects.toMatchObject({ code: 'ADMIN_NAME_REQUIRED' });
      await expect(roles.assign('g14-owner', { email: `nobody-${T}@example.test`, role: 'MODERATOR', charterAcknowledged: true })).rejects.toMatchObject({ code: 'ADMIN_NOT_FOUND' });
      await expect(roles.assign('g14-owner', { email: A.mod1, role: 'MODERATOR' })).rejects.toMatchObject({ code: 'CHARTER_ACKNOWLEDGEMENT_REQUIRED' });
      await expect(roles.assign('g14-owner', { email: A.mod1, role: 'ADMIN' })).rejects.toMatchObject({ code: 'UNKNOWN_ROLE' });
      const out = await roles.assign('g14-owner', { email: A.mod1, role: 'MODERATOR', charterAcknowledged: true });
      expect(out.staffing.features.testimonials.staffed).toBe(true);
      expect(out.staffing.features.entraide).toEqual({ staffed: false, reason: 'NO_NAMED_SAFETY_OFFICER' });
      await expect(roles.assign('g14-owner', { email: A.mod1, role: 'MODERATOR', charterAcknowledged: true })).rejects.toMatchObject({ code: 'ROLE_ALREADY_ASSIGNED' });
      expect(await n(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'MODERATION_ROLE_ASSIGN' AND actor = 'g14-owner'`)).toBeGreaterThanOrEqual(1);
    });
    it('X03 needs a safety officer AND two moderators; a disabled account no longer counts; revoking closes again', async () => {
      const roles = dsa.roleAdministration({ db });
      await roles.assign('g14-owner', { email: A.safety, role: 'ENTRAIDE_SAFETY_OFFICER', charterAcknowledged: true });
      expect((await dsa.staffingState(db)).features.entraide).toEqual({ staffed: false, reason: 'FEWER_THAN_TWO_NAMED_MODERATORS' });
      await roles.assign('g14-owner', { email: A.mod2, role: 'MODERATOR', charterAcknowledged: true });
      expect((await dsa.staffingState(db)).features.entraide.staffed).toBe(true);
      expect(await dsa.requireStaffRole(db, A.safety, 'entraide')).toBeNull();
      expect(await dsa.requireStaffRole(db, A.safety, 'testimonials')).toMatchObject({ status: 403, code: 'MODERATOR_ROLE_REQUIRED' });
      expect(await dsa.requireStaffRole(db, A.mod1, 'entraide', { safetyOnly: true })).toMatchObject({ code: 'SAFETY_OFFICER_ROLE_REQUIRED' });
      await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NOW() WHERE email = ${A.mod2}`);
      expect((await dsa.staffingState(db)).features.entraide.reason).toBe('FEWER_THAN_TWO_NAMED_MODERATORS');
      await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NULL WHERE email = ${A.mod2}`);
      await roles.revoke('g14-owner', { email: A.safety, role: 'ENTRAIDE_SAFETY_OFFICER' });
      expect((await dsa.staffingState(db)).features.entraide.reason).toBe('NO_NAMED_SAFETY_OFFICER');
      await expect(roles.revoke('g14-owner', { email: A.safety, role: 'ENTRAIDE_SAFETY_OFFICER' })).rejects.toMatchObject({ code: 'ROLE_NOT_ASSIGNED' });
    });
  });

  describe('DSA flows', () => {
    const TID = `g14-t-${T}`;
    beforeAll(async () => {
      sent = [];
      await db.execute(sql`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "submittedAt", "publishedAt", "moderatedBy", "moderatedAt", "updatedAt")
        VALUES (${TID}, ${U.author}, 'published', 'Fixture', ${BODY}, 'fr', 'x02-test', NOW(), NOW(), 'g14-x', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "TestimonialReport" (id, "testimonialId", "reporterUserId", reason) VALUES (${`g14-tr-${T}`}, ${TID}, ${U.reporter}, 'PERSONAL_DATA')`);
    });

    it('art. 17: a takedown without facts is refused BEFORE anything changes; with facts: the decision, the author statement (e-mail + space), the reporter notice', async () => {
      const { testimonialModeration } = await import('../../api/_services/testimonials.js');
      const mod = testimonialModeration({ db });
      const run = () => mod.takedown(A.mod1, TID, 'PERSONAL_DATA');
      await expect(dsa.moderatedAction({ db, send }, { actor: A.mod1, contentType: 'testimonial', contentId: TID, decisionAction: 'taken_down', reasonCode: 'PERSONAL_DATA', body: {}, run }))
        .rejects.toMatchObject({ code: 'FACTS_REQUIRED' });
      expect((await one(sql`SELECT status FROM "Testimonial" WHERE id = ${TID}`)).status).toBe('published');
      const out = await dsa.moderatedAction({ db, send }, { actor: A.mod1, contentType: 'testimonial', contentId: TID, decisionAction: 'taken_down', reasonCode: 'PERSONAL_DATA', body: { facts: FACTS }, run });
      expect(out).toMatchObject({ status: 'taken_down', statementChannel: 'email' });
      const d = await one(sql`SELECT * FROM "ModerationDecision" WHERE id = ${out.decisionId}`);
      expect(d).toMatchObject({ subjectUserId: U.author, source: 'report', automated: false, action: 'taken_down', reasonCode: 'PERSONAL_DATA' });
      expect(d.notifierUserIds).toEqual([U.reporter]);
      expect(new Date(d.appealUntil).getTime() - new Date(d.decidedAt).getTime()).toBeGreaterThan(180 * DAY);
      const toAuthor = sent.find((m) => m.to === `${U.author}@example.test`);
      for (const part of ['Faits et circonstances', 'Moyens automatisés : aucun', 'Vos recours', 'six mois', 'juge']) expect(toAuthor.text, part).toContain(part);
      expect(toAuthor.text).not.toContain(BODY);
      expect(toAuthor.text).not.toContain(U.reporter);
      expect(sent.find((m) => m.to === `${U.reporter}@example.test`).category).toBe('moderation-notice-decision');
      const mine = await dsa.citizenModeration({ db }).list(U.author);
      expect(mine.decisions[0]).toMatchObject({ role: 'author', canAppeal: true, action: 'taken_down' });
      expect((await dsa.citizenModeration({ db }).list(U.reporter)).decisions[0].role).toBe('notifier');
      expect((await dsa.citizenModeration({ db }).list(U.other)).decisions).toEqual([]);
    });

    it('art. 20: the author appeals once; the deciding moderator cannot review while another moderator exists; the other one can, and the appellant is told', async () => {
      const cm = dsa.citizenModeration({ db });
      const [d] = (await cm.list(U.author)).decisions;
      expect(await cm.appeal(U.author, d.id, 'court')).toMatchObject({ status: 400, code: 'APPEAL_TEXT_REQUIRED' });
      const ap = await cm.appeal(U.author, d.id, 'FIXTURE : je conteste, le prénom est inventé.');
      expect(ap.status).toBe(201);
      expect(await cm.appeal(U.author, d.id, 'FIXTURE : une seconde fois.')).toMatchObject({ code: 'ALREADY_APPEALED' });
      expect(await cm.appeal(U.other, d.id, 'FIXTURE : je ne suis pas concerné.')).toMatchObject({ code: 'DECISION_NOT_FOUND' });
      const desk = dsa.moderationDesk({ db, send });
      await expect(desk.reviewAppeal(A.mod1, ap.id, { outcome: 'reversed', response: 'FIXTURE : réexamen.' })).rejects.toMatchObject({ code: 'ANOTHER_MODERATOR_REQUIRED' });
      sent = [];
      expect(await desk.reviewAppeal(A.mod2, ap.id, { outcome: 'upheld', response: 'FIXTURE : décision maintenue, motifs.' })).toMatchObject({ status: 'upheld', soleModerator: false });
      expect(sent[0]).toMatchObject({ to: `${U.author}@example.test`, category: 'moderation-appeal-decision' });
    });

    it('art. 20, sole moderator: the same person reviews only 24 h after the appeal (charter § 5)', async () => {
      await dsa.roleAdministration({ db }).revoke('g14-owner', { email: A.mod2, role: 'MODERATOR' });
      const rec = dsa.decisionRecorder({ db, send });
      const d = await rec.record(A.mod1, { contentType: 'testimonial', contentId: `g14-t2-${T}`, action: 'rejected', reasonCode: 'OFF_TOPIC', facts: FACTS, source: 'pre_publication_review', subjectUserId: U.author });
      const ap = await dsa.citizenModeration({ db }).appeal(U.author, d.id, 'FIXTURE : contestation du refus.');
      await expect(dsa.moderationDesk({ db, send }).reviewAppeal(A.mod1, ap.id, { outcome: 'reversed', response: 'FIXTURE : réexamen.' })).rejects.toMatchObject({ code: 'SOLE_MODERATOR_DELAY' });
      const later = dsa.moderationDesk({ db, send, now: () => new Date(Date.now() + 25 * 3600e3) });
      expect(await later.reviewAppeal(A.mod1, ap.id, { outcome: 'reversed', response: 'FIXTURE : réexamen après délai.' })).toMatchObject({ soleModerator: true });
    });

    it('art. 16: the public notice needs its four elements (name and e-mail optional only for CHILD_SAFETY); acknowledgement; « no action » decision; appeal with the code', async () => {
      sent = [];
      const notices = dsa.contentNotices({ db, send });
      const base = { contentType: 'testimonial', contentRef: `https://example.test/temoignages#${T}`, category: 'ILLEGAL_CONTENT', explanation: 'FIXTURE : ce texte me paraît diffamatoire, voici pourquoi.', goodFaith: true };
      expect(await notices.submit({ ...base })).toMatchObject({ status: 400, problems: expect.arrayContaining(['NAME_REQUIRED', 'EMAIL_REQUIRED']) });
      expect(await notices.submit({ ...base, notifierName: 'Fixture', notifierEmail: `g14-notifier-${T}@example.test`, goodFaith: false })).toMatchObject({ code: 'GOOD_FAITH_REQUIRED' });
      const child = await notices.submit({ ...base, category: 'CHILD_SAFETY' });
      expect(child).toMatchObject({ status: 201, priority: 'urgent' });
      const ok = await notices.submit({ ...base, notifierName: 'Fixture', notifierEmail: `g14-notifier-${T}@example.test`, declaredTrustedFlagger: true });
      expect(ok).toMatchObject({ status: 201, priority: 'trusted' });
      const ack = sent.find((m) => m.category === 'moderation-notice-ack');
      expect(ack.to).toBe(`g14-notifier-${T}@example.test`);
      const code = /gardez ce code : (\S+)/.exec(ack.text)[1];
      expect((await one(sql`SELECT "acknowledgedAt" FROM "ContentNotice" WHERE id = ${ok.id}`)).acknowledgedAt).not.toBeNull();
      const queue = await notices.list(A.mod1);
      const ids = queue.map((x) => x.id);
      expect(ids.indexOf(child.id)).toBeLessThan(ids.indexOf(ok.id));   // urgent before trusted
      expect(JSON.stringify(queue)).not.toContain(`g14-notifier-${T}@example.test`);   // the moderator sees whether a contact exists, not the address
      expect(await dsa.noticeAppeal({ db }, { noticeId: ok.id, code, body: 'FIXTURE : trop tôt.' })).toMatchObject({ code: 'NOT_DECIDED' });
      const closed = await notices.close(A.mod1, ok.id, { outcome: 'no_action', facts: 'FIXTURE : le texte ne contient ni nom ni propos illicite.' });
      expect(closed).toMatchObject({ status: 'decided', outcome: 'no_action' });
      expect(sent.some((m) => m.category === 'moderation-notice-decision' && m.to === `g14-notifier-${T}@example.test`)).toBe(true);
      expect(await dsa.noticeAppeal({ db }, { noticeId: ok.id, code: 'wrong-code-000000000000', body: 'FIXTURE : contestation.' })).toMatchObject({ status: 404 });
      expect(await dsa.noticeAppeal({ db }, { noticeId: ok.id, code, body: 'FIXTURE : je conteste la décision.' })).toMatchObject({ status: 201 });
      await expect(notices.close(A.mod1, ok.id, { outcome: 'no_action', facts: FACTS })).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    });

    it('art. 23: a suspension needs a prior warning; a suspended account cannot publish or report; a suspended notifier address cannot notify', async () => {
      const desk = dsa.moderationDesk({ db, send });
      await expect(desk.sanction('g14-mod', { kind: 'suspension', scope: 'publishing', userId: U.author, reason: 'FIXTURE : contenus illicites répétés.', days: 30 })).rejects.toMatchObject({ code: 'PRIOR_WARNING_REQUIRED' });
      await desk.sanction('g14-mod', { kind: 'warning', scope: 'publishing', userId: U.author, reason: 'FIXTURE : premier avertissement.' });
      await expect(desk.sanction('g14-mod', { kind: 'suspension', scope: 'publishing', userId: U.author, reason: 'FIXTURE : contenus illicites répétés.', days: 400 })).rejects.toMatchObject({ code: 'DURATION_INVALID' });
      const s = await desk.sanction('g14-mod', { kind: 'suspension', scope: 'publishing', userId: U.author, reason: 'FIXTURE : contenus illicites répétés.', days: 30 });
      expect(await dsa.suspensionRefusal(db, U.author, 'publishing')).toMatchObject({ status: 403, code: 'ACCOUNT_RESTRICTED' });
      expect(await dsa.suspensionRefusal(db, U.author, 'notices')).toBeNull();
      await desk.liftSanction('g14-mod', s.id);
      expect(await dsa.suspensionRefusal(db, U.author, 'publishing')).toBeNull();
      // a notifier address (HMAC key, never the address)
      const notices = dsa.contentNotices({ db, send, vars: { ADA_ENCRYPTION_KEY: '0'.repeat(64) } });
      const email = `g14-spam-${T}@example.test`;
      const first = await notices.submit({ contentType: 'story', contentRef: `https://example.test/histoires#${T}`, category: 'TERMS_VIOLATION', explanation: 'FIXTURE : signalement infondé numéro un.', notifierName: 'Fixture', notifierEmail: email, goodFaith: true });
      await desk.sanction('g14-mod', { kind: 'warning', scope: 'notices', noticeId: first.id, reason: 'FIXTURE : signalements infondés.' });
      await desk.sanction('g14-mod', { kind: 'suspension', scope: 'notices', noticeId: first.id, reason: 'FIXTURE : signalements infondés répétés.', days: 14 });
      expect(await notices.submit({ contentType: 'story', contentRef: `https://example.test/histoires#${T}-2`, category: 'TERMS_VIOLATION', explanation: 'FIXTURE : signalement infondé numéro deux.', notifierName: 'Fixture', notifierEmail: email, goodFaith: true }))
        .toMatchObject({ status: 403, code: 'NOTICES_SUSPENDED' });
      expect(await n(sql`SELECT count(*)::int n FROM "ModerationSanction" WHERE "notifierKey" IS NOT NULL AND "notifierKey" LIKE ${'%@%'}`)).toBe(0);
    });

    it('transparency: counts only, no automated decision', async () => {
      const t = await dsa.moderationDesk({ db }).transparency(ago(1), new Date(Date.now() + DAY));
      expect(t.automatedDecisions).toBe(0);
      expect(t.decisions.some((r) => r.action === 'taken_down' && r.n >= 1)).toBe(true);
      expect(JSON.stringify(t)).not.toMatch(/@|FIXTURE/);
    });

    it('the decision table refuses an automated decision and a « manifestly illegal » one without its legal ground (CHECK)', async () => {
      const ins = (automated, illegal, ground) => db.execute(sql`INSERT INTO "ModerationDecision" (id, "contentType", "contentId", action, "reasonCode", facts, "legalGround", "termsClause", source, automated, "manifestlyIllegal", "decidedBy", "appealUntil")
        VALUES (gen_random_uuid()::text, 'testimonial', ${`g14-chk-${T}`}, 'rejected', 'X', ${FACTS}, ${ground}, 'Charte § 2', 'own_initiative', ${automated}, ${illegal}, 'g14-chk', NOW())`);
      await expect(ins(true, false, null)).rejects.toThrow();
      await expect(ins(false, true, null)).rejects.toThrow();
    });
  });

  describe('expansion purge steps (approved test copy; conditions met)', () => {
    const STR = `g14-str-${T}`;
    let out;
    const EV = `g14-ev-${T}`;
    beforeAll(async () => {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
        VALUES (${STR}, 'G14', ${'g14-slug-' + T}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
      // X04: an event that ended 40 days ago, one registration with a need, another person's registration
      await db.execute(sql`INSERT INTO "AcademyItem" (id, kind, status, slug, title, "createdBy", "updatedBy", "approvedBy", "publishedAt", "startsAt", "endsAt", capacity, "venueName", "updatedAt")
        VALUES (${EV}, 'EVENT', 'published', ${'g14-ev-' + T}, 'FIXTURE événement', 'g14', 'g14', 'g14', ${ago(60)}, ${ago(41)}, ${ago(40)}, 10, 'Salle', NOW())`);
      await db.execute(sql`INSERT INTO "EventRegistration" (id, "itemId", "citizenUserId", status, "accessibilityNeed", "accessibilityNeedAt", "updatedAt") VALUES (${`g14-reg-${T}`}, ${EV}, ${U.other}, 'REGISTERED', 'LSF_INTERPRETATION', ${ago(50)}, NOW())`);
      // X02: pending 61 days (expires), rejected skeleton 400 days (deleted), pending of a HELD person (kept)
      const t = (id, user, status, body, name, sub, extra = sql``) => db.execute(sql`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "submittedAt", "updatedAt", "moderatedAt")
        VALUES (${id}, ${user}, ${status}, ${name}, ${body}, 'fr', 'x02-test', ${sub}, ${sub}, ${status === 'rejected' ? sub : null}) ${extra}`);
      await t(`g14-tp-${T}`, U.other, 'pending', BODY, 'Fixture', ago(61));
      await t(`g14-ts-${T}`, U.reporter, 'rejected', null, null, ago(400));
      await t(`g14-th-${T}`, U.reporter, 'pending', BODY, 'Fixture', ago(61));
      await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${`g14-hold-${T}`}, 'CitizenUser', ${`g14-th-${T}`}, 'LITIGATION', 'g14', 'ACTIVE')`);
      // X01: a member whose only story is pending 61 days
      await db.execute(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${`g14-cm-${T}`}, ${U.author}, ${'Fix' + T.slice(-8)})`);
      await db.execute(sql`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "submittedAt", "updatedAt") VALUES (${`g14-cs-${T}`}, ${`g14-cm-${T}`}, 'pending', 'FIXTURE titre', ${STORY}, 'fr', 'x01-test', ${ago(61)}, ${ago(61)})`);
      // X05: withdrawn 40 days ago (channel erased), taken down 400 days ago (deleted), draft 200 days (deleted), published past its end (expired)
      const job = (id, status, applyTarget, over) => db.execute(sql`INSERT INTO "JobListing" (id, "structureId", status, title, "contractType", city, "postalCode", description, accommodations, "applyMethod", "applyTarget", "expiresOn", "publishedAt", "moderatedBy", "moderatedAt", "withdrawnAt", "updatedAt")
        VALUES (${id}, ${STR}, ${status}, 'Agent FIXTURE', 'CDI', 'Strasbourg', '67000', ${STORY}, ARRAY['FLEXIBLE_HOURS'], 'email', ${applyTarget}, ${over.expiresOn || '2099-01-01'}, ${over.publishedAt || null}, ${over.moderatedBy || null}, ${over.moderatedAt || null}, ${over.withdrawnAt || null}, ${over.updatedAt || new Date()})`);
      await job(`g14-jw-${T}`, 'withdrawn', 'rh@example.test', { withdrawnAt: ago(40) });
      await job(`g14-jt-${T}`, 'taken_down', null, { moderatedAt: ago(400), moderatedBy: 'g14' });
      await job(`g14-jd-${T}`, 'draft', 'rh@example.test', { updatedAt: ago(200) });
      await job(`g14-jp-${T}`, 'published', 'rh@example.test', { expiresOn: ago(10).toISOString().slice(0, 10), publishedAt: ago(100), moderatedBy: 'g14' });
      // X03: an accepted request idle 100 days with a shared e-mail
      await db.execute(sql`INSERT INTO "EntraideMember" (id, "citizenUserId", pseudonym, status, "charterVersion", "charterAcceptedAt", "updatedAt") VALUES
        (${`g14-em1-${T}`}, ${U.author}, ${'Ea' + T.slice(-8)}, 'active', 'x03-test', NOW(), NOW()), (${`g14-em2-${T}`}, ${U.reporter}, ${'Eb' + T.slice(-8)}, 'active', 'x03-test', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "EntraideOffer" (id, "memberId", category, area, status, "updatedAt") VALUES (${`g14-eo-${T}`}, ${`g14-em1-${T}`}, 'SHOPPING', 'STRASBOURG_CENTRE', 'open', NOW())`);
      await db.execute(sql`INSERT INTO "EntraideRequest" (id, "offerId", "requesterId", status, "decidedAt", "updatedAt") VALUES (${`g14-er-${T}`}, ${`g14-eo-${T}`}, ${`g14-em2-${T}`}, 'accepted', ${ago(100)}, ${ago(100)})`);
      await db.execute(sql`INSERT INTO "EntraideContactShare" (id, "requestId", "memberId", email) VALUES (${`g14-es-${T}`}, ${`g14-er-${T}`}, ${`g14-em1-${T}`}, ${`g14-share-${T}@example.test`})`);
      // DSA: a notice decided 400 days ago (deleted)
      await db.execute(sql`INSERT INTO "ContentNotice" (id, channel, "contentType", "contentRef", category, explanation, "notifierName", "notifierEmail", "goodFaith", status, outcome, "decidedAt", "decidedBy", "createdAt", "updatedAt")
        VALUES (${`g14-cn-${T}`}, 'public_form', 'story', ${`https://example.test/old#${T}`}, 'TERMS_VIOLATION', 'FIXTURE : ancien signalement décidé.', 'Fixture', ${`g14-old-${T}@example.test`}, true, 'decided', 'no_action', ${ago(400)}, 'g14', ${ago(401)}, ${ago(400)})`);

      const { approvedTestPolicy, approvalEnv } = await import('../helpers/gdpr-purge-approval.js');
      const { RETENTION_POLICY } = await import('../../api/_services/retention-policy.js');
      const { createGdprPurgeHandler } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const ids = Object.keys(RETENTION_POLICY.decidedSteps);
      const policy = { ...approvedTestPolicy(), decidedSteps: Object.fromEntries(Object.entries(RETENTION_POLICY.decidedSteps).map(([k, v]) => [k, { ...v, ...(v.condition ? { conditionMetOn: '2026-11-22' } : {}) }])) };
      const env = approvalEnv(ids);
      const keep = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
      Object.assign(process.env, env);
      const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
      try { await createGdprPurgeHandler({ policy })({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, res); } finally {
        for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
      out = res;
    }, 60000);

    it('the run executes every expansion step (none failed)', () => {
      expect(out.statusCode, JSON.stringify(out.body?.failed_steps)).toBe(200);
      const lines = Object.fromEntries(out.body.steps.map((l) => [l.id, l.decision]));
      for (const id of ['eventNeedsClearedAfterEnd', 'testimonialsPendingExpired', 'jobListingApplyTargetsErased', 'entraideRequestsAcceptedEnded', 'contentNoticesDeleted']) expect(lines[id], id).toBe('executed');
      expect(lines.testimonialsReconfirmationReport).toBe('report_only');
    });
    it('X04: the need is cleared, then the registration deleted (30 days after the end)', async () => {
      expect(await n(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE id = ${`g14-reg-${T}`}`)).toBe(0);
    });
    it('X02: the unread testimonial is withdrawn with its consent withdrawal; the skeleton is deleted; the held one is kept', async () => {
      expect(await one(sql`SELECT status, body, "displayName" FROM "Testimonial" WHERE id = ${`g14-tp-${T}`}`)).toEqual({ status: 'withdrawn', body: null, displayName: null });
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${U.other} AND purpose = 'TESTIMONIAL_PUBLICATION' AND decision = false AND proof_level = 'RETENTION_POLICY'`)).toBe(1);
      expect(await n(sql`SELECT count(*)::int n FROM "Testimonial" WHERE id = ${`g14-ts-${T}`}`)).toBe(0);
      expect((await one(sql`SELECT status FROM "Testimonial" WHERE id = ${`g14-th-${T}`}`)).status).toBe('pending');
    });
    it('X01: the unread story is withdrawn (text erased, consent withdrawal)', async () => {
      expect(await one(sql`SELECT status, title, body FROM "CommunityStory" WHERE id = ${`g14-cs-${T}`}`)).toEqual({ status: 'withdrawn', title: null, body: null });
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${U.author} AND purpose = 'COMMUNITY_STORY_PUBLICATION' AND decision = false`)).toBe(1);
    });
    it('X05: channel erased 30 days after the end; ended (365 d) and draft (180 d) listings deleted; a published listing past its date is expired', async () => {
      expect((await one(sql`SELECT "applyTarget" FROM "JobListing" WHERE id = ${`g14-jw-${T}`}`)).applyTarget).toBeNull();
      expect(await n(sql`SELECT count(*)::int n FROM "JobListing" WHERE id IN (${`g14-jt-${T}`}, ${`g14-jd-${T}`})`)).toBe(0);
      expect((await one(sql`SELECT status FROM "JobListing" WHERE id = ${`g14-jp-${T}`}`)).status).toBe('expired');
    });
    it('X03: the idle accepted request ends and the shared e-mail is deleted (with its consent withdrawal)', async () => {
      expect((await one(sql`SELECT status, note FROM "EntraideRequest" WHERE id = ${`g14-er-${T}`}`))).toEqual({ status: 'ended', note: null });
      expect(await n(sql`SELECT count(*)::int n FROM "EntraideContactShare" WHERE id = ${`g14-es-${T}`}`)).toBe(0);
      expect(await n(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${U.author} AND purpose = 'ENTRAIDE_CONTACT_SHARE' AND decision = false`)).toBe(1);
    });
    it('DSA: the notice decided 400 days ago is deleted', async () => {
      expect(await n(sql`SELECT count(*)::int n FROM "ContentNotice" WHERE id = ${`g14-cn-${T}`}`)).toBe(0);
    });
    it('without the X03 condition met (the production record), X03 steps never execute: STEP_CONDITION_OPEN', async () => {
      const { RETENTION_POLICY, stepApprovalProblem } = await import('../../api/_services/retention-policy.js');
      const policy = { ...RETENTION_POLICY, approvedSteps: { entraideRequestsAcceptedEnded: { approvedOn: '2026-11-22', dryRunReviewedOn: '2026-11-22', backupVerified: 'test' } } };
      expect(stepApprovalProblem(policy, { id: 'entraideRequestsAcceptedEnded' })).toBe('STEP_CONDITION_OPEN');
      expect(stepApprovalProblem(RETENTION_POLICY, { id: 'testimonialsPendingExpired' })).toBe('STEP_NOT_APPROVED_IN_POLICY');
    });
  });
});
