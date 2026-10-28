import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectAttributeConflicts,
  resolveConflict,
  evaluatePrecedence,
  createConflictReviewItem,
  hasUnresolvedConflicts,
  assertPublishable,
  _resetStore
} from '../../api/lib/services/conflict-resolution.js';

describe('conflict-resolution', () => {
  const origUseMocks = process.env.USE_MOCKS;

  beforeEach(() => {
    process.env.USE_MOCKS = 'true';
    _resetStore();
  });

  afterEach(() => {
    if (origUseMocks !== undefined) {
      process.env.USE_MOCKS = origUseMocks;
    } else {
      delete process.env.USE_MOCKS;
    }
  });

  it('detectAttributeConflicts: detects when amounts differ', async () => {
    const sources = [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 200 }
    ];
    const conflicts = await detectAttributeConflicts('e1', sources);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].attribute).toBe('amount');
    expect(conflicts[0].resolutionStatus).toBe('PENDING');
  });

  it('detectAttributeConflicts: no conflict when values agree', async () => {
    const sources = [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 100 }
    ];
    const conflicts = await detectAttributeConflicts('e1', sources);
    expect(conflicts.length).toBe(0);
  });

  it('evaluatePrecedence: national legal source wins for national benefit', () => {
    const srcA = { id: 'sA', competence: 'NATIONAL' };
    const srcB = { id: 'sB', competence: 'LOCAL' };
    const fact = { scope: 'NATIONAL' };
    const result = evaluatePrecedence(srcA, srcB, fact);
    expect(result.winner).toBe('sA');
    expect(result.requiresHumanReview).toBe(false);
  });

  it('evaluatePrecedence: departmental source wins for departmental dispositif', () => {
    const srcA = { id: 'sA', competence: 'NATIONAL' };
    const srcB = { id: 'sB', competence: 'DEPARTMENTAL', territory: '75' };
    const fact = { scope: 'DEPARTMENTAL', territory: '75' };
    const result = evaluatePrecedence(srcA, srcB, fact);
    expect(result.winner).toBe('sB');
    expect(result.requiresHumanReview).toBe(false);
  });

  it('evaluatePrecedence: regional source wins for regional dispositif', () => {
    const srcA = { id: 'sA', competence: 'REGIONAL', territory: 'IDF' };
    const srcB = { id: 'sB', competence: 'DEPARTMENTAL', territory: '75' };
    const fact = { scope: 'REGIONAL', territory: 'IDF' };
    const result = evaluatePrecedence(srcA, srcB, fact);
    expect(result.winner).toBe('sA');
    expect(result.requiresHumanReview).toBe(false);
  });

  it('evaluatePrecedence: requiresHumanReview when competence unclear', () => {
    const srcA = { id: 'sA', competence: 'OTHER' };
    const srcB = { id: 'sB', competence: 'OTHER' };
    const fact = { scope: 'NATIONAL' };
    const result = evaluatePrecedence(srcA, srcB, fact);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.winner).toBe(null);
  });

  it('evaluatePrecedence: NEVER uses LLM confidence', () => {
    const srcA = { id: 'sA', competence: 'OTHER' };
    const srcB = { id: 'sB', competence: 'OTHER' };
    const fact = { scope: 'NATIONAL' };
    const result = evaluatePrecedence(srcA, srcB, fact);
    expect(result.confidence).toBe('LOW'); // Should always be LOW if not resolved by rule
  });

  it('resolveConflict: records admin ID and rationale', async () => {
    const conflicts = await detectAttributeConflicts('e1', [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 200 }
    ]);
    const conflictId = conflicts[0].id;

    const resolved = await resolveConflict(conflictId, 'Value from s1 is correct', 'admin-123');
    expect(resolved.resolutionStatus).toBe('RESOLVED');
    expect(resolved.resolvedBy).toBe('admin-123');
    expect(resolved.resolutionRationale).toBe('Value from s1 is correct');
  });

  it('hasUnresolvedConflicts: true when PENDING exists', async () => {
    await 
    detectAttributeConflicts('e1', [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 200 }
    ]);
    expect(await hasUnresolvedConflicts('e1')).toBe(true);
  });

  it('assertPublishable: throws when unresolved conflicts', async () => {
    await 
    detectAttributeConflicts('e1', [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 200 }
    ]);
    await expect(assertPublishable('e1')).rejects.toThrow('Cannot publish entity e1 with unresolved conflicts');
  });

  it('createConflictReviewItem: creates P1 item', async () => {
    const conflicts = await detectAttributeConflicts('e1', [
      { id: 's1', amount: 100 },
      { id: 's2', amount: 200 }
    ]);
    const item = createConflictReviewItem(conflicts[0]);
    expect(item.type).toBe('CONFLICT_REVIEW');
    expect(item.priority).toBe('P1');
    expect(item.conflictId).toBe(conflicts[0].id);
    expect(item.sourceReferences).toContain('s1');
    expect(item.sourceReferences).toContain('s2');
  });
});
