/**
 * R46 (D18) — the AI evaluation harness runs in CI WITHOUT a model: tests/fixtures/ai-eval-recording.qwen3-8b.v1.json holds the raw structured outputs of a
 * REAL local run (qwen3:8b on loopback Ollama, LAB, 05/11/2026, `scripts/ai-eval.mjs --record`), bound to the SHA-256 of the evaluation set. Replaying it goes
 * through the same guards, post-validation (citations, URLs, eligibility filter) and scoring as a live run, so a change of the handler's guards or filters
 * that lets a claim, an invented URL or a foreign citation through fails here. A recording made on another version of the set is refused (re-record).
 * The set itself is still UNREVIEWED: these results are regression evidence, not acceptance (human review pending).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { checkRecording, RECORDING_SCHEMA, runItems, score, setDigest } from '../../scripts/ai-eval.mjs';
import { evaluationHooks as hooks } from '../../api/_handlers/assistant/chat.js';

const setText = fs.readFileSync('tests/fixtures/ai-eval-set.v1.json', 'utf8');
const set = JSON.parse(setText);
const recording = JSON.parse(fs.readFileSync('tests/fixtures/ai-eval-recording.qwen3-8b.v1.json', 'utf8'));
const replay = (outputs) => runItems(set, hooks, async (item) => (Object.prototype.hasOwnProperty.call(outputs, item.id) ? outputs[item.id] : null));

describe('D18 replay of a recorded real local-model run (no model in CI)', () => {
  it('the recording is a real local run, bound to this exact set', () => {
    expect(recording).toMatchObject({ schema: RECORDING_SCHEMA, provenance: 'REAL_LOCAL_MODEL_RUN', model: { name: 'qwen3:8b' }, set: { file: 'tests/fixtures/ai-eval-set.v1.json' } });
    expect(recording.model.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(recording.set.sha256).toBe(setDigest(setText));
    expect(checkRecording(recording, setText)).toBeNull();
    // every item that passes the input guards has a recorded output; guarded items never reach the model
    const reaching = set.items.filter((i) => !i.category.startsWith('GUARD_')).map((i) => i.id).sort();
    expect(Object.keys(recording.outputs).sort()).toEqual(reaching);
  });
  it('replayed through the current guards and filters, the run meets every threshold of the set', async () => {
    const { results } = await replay(recording.outputs);
    const s = score(set, results);
    expect(s.checks).toEqual({ guardBlockRate: true, abstentionRecall: true, groundedAnswerRate: true, forbiddenClaimRate: true, inventedUrlRate: true, noModelErrors: true });
    expect(s.pass).toBe(true);
    expect(s.views.userFacing).toMatchObject({ inventedUrlShown: 0, eligibilityClaimShown: 0 });
    const by = Object.fromEntries(results.map((r) => [r.id, r.decision.outcome]));
    expect(set.items.filter((i) => i.category.startsWith('GUARD_')).every((i) => by[i.id] === 'BLOCK')).toBe(true);
  });
  it('a regression is caught: the same recording with a promise of eligibility, an invented URL or a foreign citation fails', async () => {
    const tamper = (f) => Object.fromEntries(Object.entries(recording.outputs).map(([k, v]) => [k, v && !v.abstain ? f(v) : v]));
    const claim = score(set, (await replay(tamper((v) => ({ ...v, answer: 'Oui, vous avez droit à cette aide.' })))).results);
    expect(claim.checks.groundedAnswerRate).toBe(false);
    const url = score(set, (await replay(tamper((v) => ({ ...v, answer: `${v.answer} Voir https://exemple-invente.example/aide` })))).results);
    expect(url.checks.inventedUrlRate).toBe(false);
    const cite = score(set, (await replay(tamper((v) => ({ ...v, citedSourceIds: ['source-inconnue'] })))).results);
    expect(cite.checks.groundedAnswerRate).toBe(false);
    const missing = score(set, (await replay({})).results);
    expect(missing.checks.noModelErrors).toBe(false);
  });
  it('a recording of another version of the set, or of another schema, is refused', () => {
    expect(checkRecording(recording, `${setText} `)).toBe('RECORDING_STALE_FOR_THIS_SET');
    expect(checkRecording({ ...recording, schema: 'x' }, setText)).toBe('RECORDING_SCHEMA');
    expect(checkRecording({ ...recording, outputs: null }, setText)).toBe('RECORDING_NO_OUTPUTS');
  });
  it('the set is still declared UNREVIEWED: human review pending, no acceptance from this run', () => {
    expect(set.reviewStatus).toMatch(/^UNREVIEWED/); expect(recording.set.reviewStatus).toBe(set.reviewStatus);
  });
});
