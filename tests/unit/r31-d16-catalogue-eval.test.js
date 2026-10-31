/**
 * R31 / D16 — the catalogue query set and its scorer, and the regression the evaluation exposed: the global search matched démarches, places and news
 * against the WHOLE query as one phrase (« demande logement social » found no démarche). Measurements: STRASBOURG_FULL_PRODUCT_PLAN/evidence/r31/d16-*.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { scoreSection, summarize } from '../../scripts/search-eval-live.mjs';
import { searchWords } from '../../api/lib/search-query.js';

const set = JSON.parse(fs.readFileSync('data/search-eval/retrieval-eval.v2.catalogue.json', 'utf8'));

describe('D16 catalogue query set', () => {
  it('keeps engineering labels apart from human judgments, and covers every kind of query', () => {
    expect(set.labelStatus).toBe('PROPOSED_BY_ENGINEERING');
    expect(set.humanJudgments).toEqual([]);
    const cats = new Set(set.queries.map((q) => q.category));
    for (const c of ['need', 'synonym', 'spelling', 'programme', 'territorial', 'ambiguous', 'abstention']) expect(cats.has(c), c).toBe(true);
    expect(new Set(set.queries.map((q) => q.id)).size).toBe(set.queries.length);
    for (const q of set.queries) {
      if (['ambiguous', 'abstention'].includes(q.category)) expect(q.labels).toEqual([]);
      else expect(q.labels.length, q.id).toBeGreaterThan(0);
      for (const l of q.labels) { expect(['aide', 'demarche', 'structure']).toContain(l.kind); expect([1, 2]).toContain(l.grade); expect(Boolean(l.slug) !== Boolean(l.slugPrefix)).toBe(true); }
    }
  });
  it('scores recall@5 and the reciprocal rank per section', () => {
    const labels = [{ kind: 'demarche', slug: 'a', grade: 2 }, { kind: 'demarche', slug: 'b', grade: 1 }, { kind: 'structure', slugPrefix: 'mission-locale', grade: 2 }];
    expect(scoreSection('demarche', [{ slug: 'x' }, { slug: 'b' }], labels)).toEqual({ recall: 0.5, rr: 0.5, hits: ['b'] });
    expect(scoreSection('structure', [{ slug: 'mission-locale-neuhof' }], labels)).toEqual({ recall: 1, rr: 1, hits: ['mission-locale*'] });
    expect(scoreSection('aide', [{ slug: 'apl' }], labels)).toEqual({ recall: null, rr: null, hits: [] });
    const s = summarize([{ id: 'q', category: 'need', scores: { demarche: { recall: 0.5, rr: 0.5 }, structure: { recall: 1, rr: 1 } } }, { id: 'z', category: 'abstention', shown: 0, scores: {} }]);
    expect(s.demarche).toEqual({ queries: 1, recallAt5: 0.5, mrr: 0.5 });
    expect(s.abstention).toEqual([{ id: 'z', shown: 0 }]);
  });
});

describe('D16 regression — global search sections use the word search', () => {
  const src = fs.readFileSync('api/_handlers/search.js', 'utf8');
  it('no section matches the whole query as one phrase any more', () => {
    expect(src).not.toMatch(/queryLike/);
    expect(src).toMatch(/searchDemarches\(\{ q: payload\.query/);
    expect(src).toMatch(/searchStructures\(\{ q: payload\.query/);
    expect(src).toMatch(/wordPlan\(payload\.query, \['"titre"', '"resume"'\]/);
  });
  it('the query words are the meaningful ones', () => {
    expect(searchWords('demande logement social')).toEqual(['demande', 'logement', 'social']);
    expect(searchWords('MDPH Strasbourg')).toEqual(['mdph', 'strasbourg']);
    expect(searchWords('acheter une voiture de luxe')).toEqual(['acheter', 'voiture', 'luxe']);
  });
});
