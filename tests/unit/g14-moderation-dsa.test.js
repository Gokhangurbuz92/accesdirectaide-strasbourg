/**
 * G14 (owner decisions 22/11/2026, formulaire G14) — unit level, no database: the staffing rule (fail closed without named persons), the DSA art. 16
 * notice elements, the art. 17(3) statement text, the notifier key (HMAC, never the address), the retention policy version with its 25 decided steps
 * (durations of the form; none approved for execution; X03 conditioned on its AIPD), the routes and surfaces, and source pins on the wired handlers.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTRAIDE_MIN_MODERATORS, noticeProblems, notifierKey, staffingFromStaff, statementText } from '../../api/_services/moderation-dsa.js';
import { RETENTION_POLICY, X03_AIPD_CONDITION, isPolicyApproved, policyDays, policySummary, stepApprovalProblem, stepDecision } from '../../api/_services/retention-policy.js';
import { PURGE_STEPS } from '../../api/_handlers/cron/gdpr-purge.js';
import { isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { anyUgcOpen } from '../../api/_handlers/notices.js';

const M = (email, role = 'MODERATOR') => ({ email, role });

describe('staffing — fail closed', () => {
  it('nobody named: every function that needs a person is closed; X04 events need nobody', () => {
    const s = staffingFromStaff([]);
    for (const f of ['testimonials', 'stories', 'employment', 'notices']) expect(s.features[f]).toEqual({ staffed: false, reason: 'NO_NAMED_MODERATOR' });
    expect(s.features.entraide).toEqual({ staffed: false, reason: 'NO_NAMED_SAFETY_OFFICER' });
    expect(s.features.events.staffed).toBe(true);
  });
  it('one moderator opens X02 / X01 / X05 and the notice form, never X03; X03 needs a safety officer AND two moderators (charter § 3)', () => {
    expect(ENTRAIDE_MIN_MODERATORS).toBe(2);
    expect(staffingFromStaff([M('a@x.test')]).features.testimonials.staffed).toBe(true);
    expect(staffingFromStaff([M('a@x.test'), M('s@x.test', 'ENTRAIDE_SAFETY_OFFICER')]).features.entraide.reason).toBe('FEWER_THAN_TWO_NAMED_MODERATORS');
    // the same person twice is still one moderator
    expect(staffingFromStaff([M('a@x.test'), M('a@x.test'), M('s@x.test', 'ENTRAIDE_SAFETY_OFFICER')]).features.entraide.staffed).toBe(false);
    expect(staffingFromStaff([M('a@x.test'), M('b@x.test'), M('s@x.test', 'ENTRAIDE_SAFETY_OFFICER')]).features.entraide.staffed).toBe(true);
  });
  it('without migration 0059 everything that needs a person is closed', () => {
    expect(staffingFromStaff([M('a@x.test')], false).features.testimonials).toEqual({ staffed: false, reason: 'MODERATION_NOT_AVAILABLE' });
  });
});

describe('DSA art. 16 — the four elements of a notice', () => {
  const ok = { contentType: 'story', category: 'ILLEGAL_CONTENT', contentRef: 'https://example.test/h', explanation: 'FIXTURE explication assez longue.', notifierName: 'Fixture', notifierEmail: 'f@example.test', goodFaith: true };
  it('a complete notice passes; each missing element is named', () => {
    expect(noticeProblems(ok)).toEqual([]);
    expect(noticeProblems({ ...ok, explanation: 'court' })).toContain('EXPLANATION_REQUIRED');
    expect(noticeProblems({ ...ok, contentRef: '' })).toContain('CONTENT_REF_REQUIRED');
    expect(noticeProblems({ ...ok, notifierName: null, notifierEmail: null })).toEqual(['NAME_REQUIRED', 'EMAIL_REQUIRED']);
    expect(noticeProblems({ ...ok, goodFaith: false })).toEqual(['GOOD_FAITH_REQUIRED']);
    expect(noticeProblems({ ...ok, category: 'OTHER' })).toEqual(['CATEGORY_INVALID']);
  });
  it('art. 16(2)(c): name and e-mail are optional only for a child-safety notice', () => {
    expect(noticeProblems({ ...ok, category: 'CHILD_SAFETY', notifierName: null, notifierEmail: null })).toEqual([]);
  });
});

describe('DSA art. 17(3) — the statement of reasons', () => {
  const d = { contentType: 'testimonial', action: 'taken_down', reasonCode: 'PERSONAL_DATA', facts: 'FIXTURE faits.', legalGround: null, termsClause: 'Charte de modération, § 2 (contenus refusés)',
    source: 'report', decidedAt: '2026-11-22T10:00:00Z', appealUntil: '2027-05-22T10:00:00Z', restrictionEndsAt: null };
  it('names the measure and its scope, the facts and whether it followed a notice, the rule, no automated means, the redress (six months, court)', () => {
    const s = statementText(d, 'author');
    for (const part of ['a été retiré(e)', 'Portée : l’ensemble du service', 'Faits et circonstances : FIXTURE faits.', 'à la suite d’un signalement', 'Charte de modération, § 2',
      'Moyens automatisés : aucun', 'jusqu’au 2027-05-22 (six mois)', 'saisir le juge']) expect(s, part).toContain(part);
    expect(s).not.toMatch(/Fondement légal/);
    expect(statementText({ ...d, legalGround: 'FIXTURE article de loi' }, 'author')).toContain('Fondement légal et raison de l’illicéité : FIXTURE article de loi');
  });
  it('the notifier version tells the decision on their notice', () => {
    expect(statementText(d, 'notifier')).toMatch(/^Décision du 2026-11-22 sur votre signalement/);
  });
});

describe('art. 23 notifier key', () => {
  it('an HMAC of the lower-cased address under the server key — never the address; null without a key', () => {
    const k = notifierKey('Fixture@Example.test', { ADA_ENCRYPTION_KEY: '1'.repeat(64) });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(notifierKey('fixture@example.test', { ADA_ENCRYPTION_KEY: '1'.repeat(64) })).toBe(k);
    expect(notifierKey('fixture@example.test', {})).toBeNull();
  });
});

describe('retention policy G14', () => {
  it('approved new version (question 32), the earlier one superseded, 6c still the only APPROVED step', () => {
    expect(isPolicyApproved(RETENTION_POLICY)).toBe(true);
    expect(RETENTION_POLICY.version).toBe('g14-r3-2026-11-24-a7-365d');   // R3 (owner 24/11/2026): a new version for the release-3 durations; these durations unchanged
    expect(Object.keys(RETENTION_POLICY.approvedSteps)).toEqual(['unverifiedAccountsDeleted']);
    expect(policySummary(RETENTION_POLICY)).toMatchObject({ approvedStepCount: 1, decidedStepCount: 39 });   // + 11 release-3 steps decided by the owner 24/11/2026   // 25 on 22/11 + the 2 moderation-case steps of 23/11 + G14-PS socialReferralsClosedDeleted (decided by the owner 23/11/2026)
  });
  it('the durations are the « (önerilen) » answers of the form', () => {
    const d = (k) => policyDays(RETENTION_POLICY, k);
    expect([d('EVENT_NEED_AFTER_END_DAYS'), d('EVENT_REGISTRATION_AFTER_END_DAYS'), d('ACADEMY_EVENT_ENDED_DAYS')]).toEqual([1, 30, 365]);   // q14–16
    expect([d('TESTIMONIAL_PENDING_DAYS'), d('STORY_PENDING_DAYS'), d('TESTIMONIAL_REVIEW_DAYS'), d('TESTIMONIAL_SKELETON_DAYS'), d('UGC_REPORT_DAYS')]).toEqual([60, 60, 1095, 365, 90]);   // q17–20
    expect(d('COMMUNITY_MEMBER_INACTIVE_DAYS')).toBe(730);   // q21
    expect([d('JOB_APPLY_TARGET_AFTER_END_DAYS'), d('JOB_LISTING_ENDED_DAYS'), d('JOB_LISTING_DRAFT_DAYS')]).toEqual([30, 365, 180]);   // q23, q25
    expect(d('ENTRAIDE_REQUEST_ACCEPTED_DAYS')).toBe(90);   // q26
    expect([d('ENTRAIDE_OFFER_IDLE_DAYS'), d('ENTRAIDE_REQUEST_PENDING_DAYS'), d('ENTRAIDE_REQUEST_ENDED_DAYS'), d('ENTRAIDE_MEMBER_INACTIVE_DAYS')]).toEqual([90, 30, 365, 730]);   // q27
    expect(d('CONTENT_NOTICE_AFTER_DECISION_DAYS')).toBe(365);   // q28
  });
  it('every decided step exists, uses a policy duration, and cannot execute without its own approval record; X03 steps also need their AIPD', () => {
    for (const [id, dec] of Object.entries(RETENTION_POLICY.decidedSteps)) {
      const step = PURGE_STEPS.find((s) => s.id === id);
      expect(step, id).toBeTruthy();
      if (step.durationKey) expect(() => policyDays(RETENTION_POLICY, step.durationKey), id).not.toThrow();
      // G14-PS: the social referral duration is decided (owner, 23/11/2026) like the others: only the step's own approval is missing
      expect(stepApprovalProblem(RETENTION_POLICY, step), id).toBe('STEP_NOT_APPROVED_IN_POLICY');
      expect(stepDecision(RETENTION_POLICY, id)).toBe(dec);
      if (id.startsWith('entraide')) expect(dec.condition).toBe(X03_AIPD_CONDITION);
    }
    const rec = { approvedOn: '2026-11-23', dryRunReviewedOn: '2026-11-23', backupVerified: 'FIXTURE' };
    expect(stepApprovalProblem({ ...RETENTION_POLICY, approvedSteps: { entraideReportsDeleted: rec } }, { id: 'entraideReportsDeleted' })).toBe('STEP_CONDITION_OPEN');
    expect(stepApprovalProblem({ ...RETENTION_POLICY, approvedSteps: { testimonialReportsDeleted: rec } }, { id: 'testimonialReportsDeleted' })).toBeNull();
  });
});

describe('routes, surfaces, gates', () => {
  it('the notice form and « my decisions » belong to the « notices » surface; the desk to « admin »; Production today opens none of the first two', () => {
    expect([surfaceOf('notices'), surfaceOf('citizen/moderation'), surfaceOf('admin/moderation')]).toEqual(['notices', 'notices', 'admin']);
    const prod = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
    expect(isAllowedInPublicBeta('POST', 'notices', prod)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/moderation', prod)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'admin/moderation', prod)).toBe(true);
  });
  it('the notice form needs at least one content capability open', () => {
    const prod = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
    expect(anyUgcOpen(prod)).toBe(false);
    expect(anyUgcOpen({ ...prod, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials', ADA_CAPABILITIES_OPEN: 'community.testimonials' })).toBe(true);
  });
  it('source pins: every moderation handler checks the named role and records restrictions; submissions check staffing and suspensions', () => {
    for (const f of ['testimonials', 'stories', 'employment', 'entraide']) {
      const s = fs.readFileSync(`api/_handlers/admin/${f}.js`, 'utf8');
      expect(s, f).toContain('requireStaffRole(defaultDb, actor');
      expect(s, f).toMatch(/moderatedAction\(\{ db: defaultDb \}/);
    }
    for (const f of ['testimonials', 'stories']) expect(fs.readFileSync(`api/_handlers/citizen/${f}.js`, 'utf8')).toMatch(/requireFeatureStaffed\(defaultDb, '\w+'\)\) \|\| \(await suspensionRefusal/);
    expect(fs.readFileSync('api/_handlers/citizen/entraide.js', 'utf8')).toContain("requireFeatureStaffed(defaultDb, 'entraide')");
    expect(fs.readFileSync('api/_handlers/pro/employment.js', 'utf8')).toContain("requireFeatureStaffed(defaultDb, 'employment')");
  });
});
