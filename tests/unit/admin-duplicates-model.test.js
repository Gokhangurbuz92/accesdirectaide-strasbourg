/**
 * Registre des doublons — the bulk review model (src/pages/admin/k5/duplicatesModel.js): a draft takes the suggestion's evidence only when the chosen
 * decision IS the suggestion; incomplete drafts never leave; a draft is bound to the versions shown; only well-documented suggestions can be preselected.
 */
import { describe, expect, it } from 'vitest';
import { batchItems, chunks, draftFor, draftProblems, filterPairs, paginate, reconcileDrafts, sortPairs, summary, wellDocumented } from '../../src/pages/admin/k5/duplicatesModel.js';

const V = (c) => c.repeat(64);
const pair = (n, assessment = {}, extra = {}) => ({
  key: `a${n}|b${n}`, a: `a${n}`, b: `b${n}`, expectedDecisionId: null,
  A: { id: `a${n}`, nom: `Alpha ${n}`, ville: n % 2 ? 'Strasbourg' : 'Haguenau', version: V('a'), siret: null }, B: { id: `b${n}`, nom: `Beta ${n}`, ville: 'Strasbourg', version: V('b') },
  detection: { sameAddress: true, nameSimilarity: 0.2 }, assessment: { suggestion: null, confidence: null, warnings: [], ...assessment }, ...extra,
});
const distinct = { suggestion: 'DISTINCT', confidence: 'high', wellDocumented: true, evidenceUrl: 'https://finess.esante.gouv.fr/x', note: 'Deux établissements FINESS distincts.' };
const same = { suggestion: 'SAME_ENTITY', confidence: 'high', wellDocumented: true, evidenceUrl: 'https://finess.esante.gouv.fr/y', note: 'Même n° FINESS, même adresse.', primaryId: 'a2' };

describe('drafts', () => {
  it('the suggestion fills evidence and note only for the suggested decision', () => {
    const p = pair(1, distinct);
    expect(draftFor(p, 'DISTINCT')).toMatchObject({ evidenceUrl: distinct.evidenceUrl, note: distinct.note, fromSuggestion: true, versionA: V('a'), versionB: V('b') });
    const other = draftFor(p, 'SAME_ENTITY');
    expect([other.evidenceUrl, other.note, other.primaryId, other.fromSuggestion]).toEqual(['', '', '', false]);
    expect(draftProblems(p, other)).toEqual(['PRIMARY', 'EVIDENCE', 'NOTE']);
  });
  it('a draft is bound to the versions shown: a changed record makes it stale', () => {
    const p = pair(1, distinct); const d = draftFor(p, 'DISTINCT');
    expect(draftProblems(p, d)).toEqual([]);
    expect(draftProblems({ ...p, A: { ...p.A, version: V('c') } }, d)).toEqual(['STALE']);
    const r = reconcileDrafts([{ ...p, A: { ...p.A, version: V('c') } }, pair(2, distinct)], { [p.key]: d, [pair(2).key]: draftFor(pair(2, distinct), 'DISTINCT'), 'gone|x': d });
    expect([Object.keys(r.drafts), r.stale]).toEqual([['a2|b2'], ['a1|b1']]);
  });
});

describe('batch', () => {
  it('only the selected, complete drafts leave, each with its own evidence, note, versions and the pair state seen', () => {
    const p1 = pair(1, distinct); const p2 = pair(2, same); const p3 = pair(3); const p4 = pair(4, distinct);
    const drafts = { [p1.key]: draftFor(p1, 'DISTINCT'), [p2.key]: draftFor(p2, 'SAME_ENTITY'), [p3.key]: draftFor(p3, 'DISTINCT'), [p4.key]: draftFor(p4, 'DISTINCT') };
    const items = batchItems([p1, p2, p3, p4], new Set([p1.key, p2.key, p3.key]), drafts);
    expect(items.map((i) => i.a)).toEqual(['a1', 'a2']);   // p3 incomplete, p4 not selected
    expect(items[1]).toEqual({ a: 'a2', b: 'b2', decision: 'SAME_ENTITY', primaryId: 'a2', evidenceUrl: same.evidenceUrl, note: same.note, versionA: V('a'), versionB: V('b'), expectedDecisionId: null });
    expect(items[0]).not.toHaveProperty('primaryId');
    const s = summary([p1, p2], items);
    expect(s).toEqual({ same: 1, distinct: 1, held: [{ keep: 'Alpha 2', leave: 'Beta 2', leaveId: 'b2' }] });
    expect(chunks(Array.from({ length: 60 }, (_, i) => i)).map((c) => c.length)).toEqual([25, 25, 10]);
  });
  it('preselection takes only well-documented suggestions — there is no « mark everything as duplicates »', () => {
    const list = [pair(1, distinct), pair(2, same), pair(3, { suggestion: 'DISTINCT', confidence: 'medium', wellDocumented: false, evidenceUrl: 'https://x.gouv.fr' }), pair(4)];
    expect(wellDocumented(list).map((p) => p.a)).toEqual(['a1', 'a2']);
  });
});

describe('filter, sort, paginate', () => {
  const list = [pair(1, distinct), pair(2, same), pair(3, { warnings: [{ code: 'SAME_NAME' }] }), pair(4, { suggestion: 'DISTINCT', confidence: 'medium' })];
  it('filters by search, suggestion, confidence, warnings and state', () => {
    expect(filterPairs(list, { q: 'alpha 3' }).map((p) => p.a)).toEqual(['a3']);
    expect(filterPairs(list, { suggestion: 'none' }).map((p) => p.a)).toEqual(['a3']);
    expect(filterPairs(list, { suggestion: 'DISTINCT' }).map((p) => p.a)).toEqual(['a1', 'a4']);
    expect(filterPairs(list, { confidence: 'medium' }).map((p) => p.a)).toEqual(['a4']);
    expect(filterPairs(list, { warnings: 'with' }).map((p) => p.a)).toEqual(['a3']);
    expect(filterPairs(list, { state: 'draft' }, { 'a2|b2': {} }).map((p) => p.a)).toEqual(['a2']);
    expect(filterPairs(list, { state: 'failed' }, {}, { 'a4|b4': { ok: false } }).map((p) => p.a)).toEqual(['a4']);
    expect(filterPairs(list, { detection: 'address' }).length).toBe(4);
  });
  it('sorts and paginates', () => {
    expect(sortPairs(list, 'confidence').map((p) => p.a)).toEqual(['a1', 'a2', 'a4', 'a3']);
    expect(sortPairs([...list].reverse(), 'name').map((p) => p.a)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(paginate(list, 9, 3)).toMatchObject({ page: 2, pages: 2 });
    expect(paginate(list, 2, 3).items.map((p) => p.a)).toEqual(['a4']);
  });
});
