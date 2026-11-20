/**
 * G12 (owner 20/11/2026): while there is ONE enabled MFA administrator, that administrator confirms their own « propose → confirm » reviews (organization
 * closure, access-request review, break-glass review) — after 24 h and a fresh reading for decisions that change data; with two or more administrators the
 * two-person rule applies again by itself. Erasure keeps the same rule (18/11).
 */
import { describe, expect, it } from 'vitest';
import { SOLE_ADMIN_DELAY_MS, selfConfirmation } from '../../api/_services/sole-admin.js';
import { confirmClosure } from '../../api/_services/org-closure.js';
import { confirm as confirmAccessReview } from '../../api/_services/dsr-review.js';
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
