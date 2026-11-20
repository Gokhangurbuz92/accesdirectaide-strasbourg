/**
 * G12 (owner 20/11/2026): while there is ONE enabled MFA administrator, that administrator confirms their own « propose → confirm » reviews (organization
 * closure, access-request review, break-glass review) — after 24 h and a fresh reading for decisions that change data; with two or more administrators the
 * two-person rule applies again by itself. Erasure keeps the same rule (18/11).
 */
import { describe, expect, it } from 'vitest';
import { SOLE_ADMIN_DELAY_MS, selfConfirmation, soleConfirmableFrom } from '../../api/_services/sole-admin.js';
import { confirmClosure, listOpenClosures } from '../../api/_services/org-closure.js';
import { confirm as confirmAccessReview, listOpen as listOpenAccessReviews } from '../../api/_services/dsr-review.js';
import { listOpenErasures } from '../../api/_services/dsr-erasure-review.js';
import { reviewBreakGlass } from '../../api/_services/admin-identity.js';

const sole = async () => ({ registered: true, others: 0, sole: true });
const two = async () => ({ registered: true, others: 1, sole: false });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ADMIN = 'owner@example.test';

describe('G12 selfConfirmation', () => {
  it('another administrator: allowed at once, read bound to the proposal', async () => {
    const at = ago(1000);
    expect(await selfConfirmation(null, { reviewer: 'b@example.test', proposedBy: ADMIN, proposedAt: at, check: two })).toEqual({ ok: true, soleAdministrator: false, readFrom: at });
  });
  it('the proposer while other administrators exist: refused (two-person rule)', async () => {
    const r = await selfConfirmation(null, { reviewer: ADMIN, proposedBy: ADMIN.toUpperCase(), proposedAt: ago(2 * SOLE_ADMIN_DELAY_MS), check: two });
    expect([r.ok, r.status, r.code]).toEqual([false, 403, 'second_reviewer_required']);
  });
  it('the sole administrator: refused before 24 h (with the date), allowed after, and must read again after the delay', async () => {
    const early = await selfConfirmation(null, { reviewer: ADMIN, proposedBy: ADMIN, proposedAt: ago(3600e3), check: sole });
    expect([early.ok, early.status, early.code]).toEqual([false, 409, 'sole_admin_delay']);
    expect(Date.parse(early.confirmableFrom)).toBeGreaterThan(Date.now());
    const at = ago(SOLE_ADMIN_DELAY_MS + 60e3);
    const late = await selfConfirmation(null, { reviewer: ADMIN, proposedBy: ADMIN, proposedAt: at, check: sole });
    expect(late).toEqual({ ok: true, soleAdministrator: true, readFrom: new Date(Date.parse(at) + SOLE_ADMIN_DELAY_MS).toISOString() });
  });
  it('« send back » by the sole administrator needs no delay; a review that changes no data neither', async () => {
    expect((await selfConfirmation(null, { reviewer: ADMIN, proposedBy: ADMIN, proposedAt: ago(1000), applying: false, check: sole })).ok).toBe(true);
    expect(await selfConfirmation(null, { reviewer: ADMIN, proposedBy: ADMIN, proposedAt: null, delay: false, check: sole })).toEqual({ ok: true, soleAdministrator: true, readFrom: null });
  });
});

/** a fake db answering the one SELECT each confirm runs first */
const dbWith = (row) => ({ execute: async () => ({ rows: row ? [row] : [] }), insert: () => ({ values: async () => {} }) });

describe('G12 wired into the reviews', () => {
  it('organization closure: the sole administrator gets the 24 h date instead of « another person »', async () => {
    const proposedAt = ago(3600e3);
    const db = dbWith({ id: 'c1', status: 'IN_REVIEW', sid: 's1', o: { request: {}, proposal: { decision: 'APPROVE', proposedBy: ADMIN, proposedAt } } });
    const r = await confirmClosure('c1', { action: 'confirm', note: 'Fin de la convention.', proposedAt }, ADMIN, db, { soleAdministratorCheck: sole });
    expect([r.status, r.code]).toEqual([409, 'sole_admin_delay']);
    const r2 = await confirmClosure('c1', { action: 'confirm', note: 'Fin de la convention.', proposedAt }, ADMIN, db, { soleAdministratorCheck: two });
    expect([r2.status, r2.code]).toEqual([403, 'second_reviewer_required']);
  });
  it('access-request review: same rule', async () => {
    const proposedAt = ago(3600e3);
    const db = dbWith({ id: 'd1', o: { proposal: { decision: 'WITHHOLD', proposedBy: ADMIN, proposedAt } } });
    const r = await confirmAccessReview('d1', { action: 'confirm', note: 'Je confirme.', proposedAt }, ADMIN, db, { soleAdministratorCheck: sole });
    expect([r.status, r.code]).toEqual([409, 'sole_admin_delay']);
  });
  it('break-glass review: the sole administrator reviews their own use; with two administrators the other one must', async () => {
    const auth = { authType: 'admin_jwt', mfa_verified: true, email: ADMIN };
    const calls = [];
    const db = { execute: async () => ({ rows: calls.length++ === 0 ? [{ actor: ADMIN }] : [] }), insert: () => ({ values: async (v) => { calls.push(v); } }) };
    expect(await reviewBreakGlass(auth, { id: 'e1', note: 'Accès utilisé pour corriger un compte bloqué.' }, { db, soleCheck: sole })).toEqual({ ok: true });
    expect(calls.at(-1).details.soleAdministrator).toBe(true);
    const db2 = { execute: async () => ({ rows: [{ actor: ADMIN }] }), insert: () => ({ values: async () => {} }) };
    expect((await reviewBreakGlass(auth, { id: 'e1', note: 'Accès utilisé pour corriger un compte bloqué.' }, { db: db2, soleCheck: two })).code).toBe('TWO_PERSON_RULE');
  });
});

describe('G13 — the lists announce the sole-administrator date only while the proposer is the sole enabled MFA administrator', () => {
  const proposedAt = '2026-11-19T10:00:00.000Z';
  const expected = new Date(Date.parse(proposedAt) + SOLE_ADMIN_DELAY_MS).toISOString();
  const listDb = (rows) => ({ execute: async () => ({ rows }) });
  const withProposal = { id: 'x1', status: 'IN_REVIEW', createdAt: '2026-11-18T10:00:00.000Z', sid: 's1', nom: 'Structure test', o: { request: {}, proposal: { decision: 'APPROVE', proposedBy: ADMIN, proposedAt } } };
  const noProposal = { id: 'x2', status: 'IN_REVIEW', createdAt: '2026-11-18T10:00:00.000Z', sid: 's2', nom: 'Structure test 2', o: { request: {} } };
  const LISTS = [['access review', listOpenAccessReviews], ['erasure', listOpenErasures], ['organization closure', listOpenClosures]];

  for (const [name, list] of LISTS) {
    it(`${name}: date with one administrator, null with a second one, null without a proposal`, async () => {
      const one = await list(listDb([withProposal, noProposal]), { soleAdministratorCheck: sole });
      expect(one.requests.map((r) => r.soleAdministratorConfirmableFrom)).toEqual([expected, null]);
      const both = await list(listDb([withProposal, noProposal]), { soleAdministratorCheck: two });
      expect(both.requests.map((r) => r.soleAdministratorConfirmableFrom)).toEqual([null, null]);
      expect(both.requests[0].stage).toBe('AWAITING_SECOND_REVIEWER');   // the rest of the row is unchanged
    });
  }

  it('the check is asked about the proposer, once per proposer; a failing check shows no date', async () => {
    const asked = [];
    const check = async (_db, email) => { asked.push(email); return { sole: true }; };
    const from = soleConfirmableFrom({}, check);
    expect(await Promise.all([from({ proposedBy: ' Owner@Example.test ', proposedAt }), from({ proposedBy: ADMIN, proposedAt }), from(null), from({ proposedBy: ADMIN, proposedAt: 'x' })]))
      .toEqual([expected, expected, null, null]);
    expect(asked).toEqual([ADMIN]);
    expect(await soleConfirmableFrom({}, async () => { throw new Error('db down'); })({ proposedBy: ADMIN, proposedAt })).toBeNull();
    // the real check counts enabled MFA administrators: the proposer alone → sole; a second one → not sole
    const real = soleConfirmableFrom({ execute: async () => ({ rows: [{ self: 1, others: 1 }] }) });
    expect(await real({ proposedBy: ADMIN, proposedAt })).toBeNull();
    const realSole = soleConfirmableFrom({ execute: async () => ({ rows: [{ self: 1, others: 0 }] }) });
    expect(await realSole({ proposedBy: ADMIN, proposedAt })).toBe(expected);
  });
});
