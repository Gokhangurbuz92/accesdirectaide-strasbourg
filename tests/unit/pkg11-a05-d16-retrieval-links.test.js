/**
 * PKG-11 / A05 + D16 — pure parts: the link check contacts only allow-listed https hosts and stays off unless enabled; the index text, its hash and the
 * retrieval metrics are deterministic; the local embedder refuses any address that is not this machine.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkOne } from '../../api/_services/link-check.js';
import { embeddingTextOf, evaluateRetrieval, localOllamaEmbedder, sha256 } from '../../api/lib/retrieval-index.js';

describe('PKG-11 / A05 link check', () => {
  it('an address outside the allow-list (or not https) is never requested', async () => {
    const calls = []; const f = async (u) => { calls.push(u); return { status: 200, headers: { get: () => null } }; };
    expect((await checkOne('https://example.test/page', { fetchImpl: f })).class).toBe('OUTSIDE_ALLOWLIST');
    expect((await checkOne('http://www.service-public.fr/page', { fetchImpl: f })).class).toBe('OUTSIDE_ALLOWLIST');
    expect((await checkOne('https://evil.example/?service-public.fr', { fetchImpl: f })).class).toBe('OUTSIDE_ALLOWLIST');
    expect(calls).toEqual([]);
    expect((await checkOne('https://www.service-public.fr/page', { fetchImpl: f })).class).toBe('OK');
  });
  it('the cron is off unless the owner enables it', () => {
    expect(readFileSync('api/_handlers/cron/link-check.js', 'utf8')).toMatch(/if \(process\.env\.LINK_CHECK_ENABLED !== '1'\) return res\.status\(200\)\.json\(\{ success: true, skipped: 'disabled'/);
  });
});

describe('PKG-11 / D16 retrieval index', () => {
  it('the embedded text is the same fields in the same order, normalized; its hash changes with the text only', () => {
    const a = { titre: ' RSA ', cest_quoi: 'Un  revenu', pour_qui: null, ce_que_ca_aide: 'x', summary_falc: '', mots_cles: ['revenu', 'minimum'] };
    expect(embeddingTextOf(a)).toBe('RSA\nUn revenu\nx\nrevenu minimum');
    expect(sha256(embeddingTextOf(a))).toBe(sha256(embeddingTextOf({ ...a, unrelated: 'y' })));
    expect(sha256(embeddingTextOf(a))).not.toBe(sha256(embeddingTextOf({ ...a, cest_quoi: 'Un revenu minimum' })));
  });
  it('recall@k and MRR', async () => {
    const results = { q1: ['a', 'b'], q2: ['x', 'y', 'c'], q3: ['z'] };
    const m = await evaluateRetrieval({ search: async (q) => results[q], queries: [{ q: 'q1', relevant: ['a'] }, { q: 'q2', relevant: ['c'] }, { q: 'q3', relevant: ['w'] }], k: 2 });
    expect(m.recallAtK).toBeCloseTo(1 / 3); expect(m.mrr).toBeCloseTo((1 + 1 / 3 + 0) / 3);
  });
  it('the local embedder refuses any address that is not this machine; the evaluation set is marked unreviewed', () => {
    expect(() => localOllamaEmbedder({ url: 'https://api.example.com/embeddings' })).toThrow(/must run on this machine/);
    expect(() => localOllamaEmbedder({ url: 'http://127.0.0.1:11434/api/embeddings' })).not.toThrow();
    const set = JSON.parse(readFileSync('data/search-eval/retrieval-eval.v1.json', 'utf8'));
    expect(set.status).toBe('PROPOSED_UNREVIEWED'); expect(set.documents).toHaveLength(12); expect(set.queries).toHaveLength(16);
    for (const q of set.queries) for (const r of q.relevant) expect(set.documents.map((d) => d.key)).toContain(r);
  });
});
