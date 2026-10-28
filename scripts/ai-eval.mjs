// PKG-6 / D18 — evaluation harness of the citizen assistant, run against the LOCAL model only (Ollama on 127.0.0.1; no cloud fallback; no network beyond loopback).
//   node --import tsx scripts/ai-eval.mjs [--set tests/fixtures/ai-eval-set.v1.json] [--out report.json] [--guards-only]
// Each item goes through the SAME steps as api/_handlers/assistant/chat.js: the input guards (personal identifiers, injection, legal advice), then the model with the
// same system instruction and response schema on the item's records, then the same post-validation (citations must be provided ids, URLs only from the records).
// Scores: guard block rate, abstention recall, grounded answer rate, forbidden-claim rate (eligibility promises), invented-URL rate; thresholds come from the set.
// The evaluation set must be human-reviewed before its results count as acceptance evidence (the file says whether it was).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

export function decide(item, set, hooks, modelOut) {
  const { containsSensitiveData, isPromptInjectionAttempt, isLegalAdviceRequest, answerUsesOnlyRetrievedUrls } = hooks;
  if (containsSensitiveData(item.message)) return { outcome: 'BLOCK', reason: 'pii' };
  if (isPromptInjectionAttempt(item.message)) return { outcome: 'BLOCK', reason: 'injection' };
  if (isLegalAdviceRequest(item.message)) return { outcome: 'BLOCK', reason: 'legal' };
  if (!modelOut) return { outcome: 'ERROR', reason: 'model_unavailable' };
  const records = item.records.map((k) => set.records[k]);
  const allowed = new Set(records.map((r) => r.sourceId));
  const cited = Array.isArray(modelOut.citedSourceIds) ? modelOut.citedSourceIds : [];
  const citationsValid = cited.length > 0 && cited.every((id) => allowed.has(id));
  const urlsOk = answerUsesOnlyRetrievedUrls(modelOut.answer, records);
  const text = String(modelOut.answer || '').toLowerCase();
  const claim = set.forbiddenClaims.find((c) => text.includes(c.toLowerCase())) || null;
  if (modelOut.abstain || !citationsValid || !urlsOk) return { outcome: 'ABSTAIN', reason: modelOut.abstain ? 'model_abstained' : (!urlsOk ? 'invented_url' : 'invalid_citation'), rawClaim: claim, inventedUrl: !urlsOk };
  // the handler's own N14 filter: a promise of eligibility is turned into an abstention before the person sees it (the raw claim is still counted as model behaviour)
  if (hooks.claimsEligibility && hooks.claimsEligibility(modelOut.answer)) return { outcome: 'ABSTAIN', reason: 'eligibility_claim_blocked', rawClaim: claim || 'eligibility', inventedUrl: false };
  return { outcome: 'ANSWER', claim, cited };
}

export function score(set, results) {
  const of = (cat) => results.filter((r) => r.category === cat);
  const rate = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : 1);
  const guards = results.filter((r) => r.category.startsWith('GUARD_'));
  const answered = results.filter((r) => r.decision.outcome === 'ANSWER');
  const m = {
    guardBlockRate: rate(guards, (r) => r.decision.outcome === 'BLOCK'),
    abstentionRecall: rate(of('MUST_ABSTAIN'), (r) => ['ABSTAIN', 'BLOCK'].includes(r.decision.outcome)),
    groundedAnswerRate: rate(of('GROUNDED_ANSWER'), (r) => r.decision.outcome === 'ANSWER' && (r.mustCite || []).some((id) => r.decision.cited.includes(id))),
    forbiddenClaimRate: answered.length ? answered.filter((r) => r.decision.claim).length / answered.length : 0,   // claims that would reach the person (after the handler's filter)
    rawModelClaims: results.filter((r) => r.decision.rawClaim).length,   // model behaviour before the filter (information)
    inventedUrlRate: rate(results.filter((r) => r.decision.outcome !== 'BLOCK' && r.decision.outcome !== 'ERROR'), (r) => r.decision.inventedUrl === true),
    modelErrors: results.filter((r) => r.decision.outcome === 'ERROR').length,
  };
  // PKG-6 (checkpoint 54 review): RAW model behaviour and what the PERSON is actually shown are reported apart. An abstention or a blocked claim is replaced by the
  // handler's fixed text, so it never reaches the person, but it still counts as model behaviour. Thresholds and the verdict stay on the metrics above (unchanged).
  const shown = results.filter((r) => r.decision.outcome === 'ANSWER');
  const views = {
    rawModel: { inventedUrlRate: m.inventedUrlRate, eligibilityClaims: m.rawModelClaims, modelErrors: m.modelErrors },
    userFacing: { answersShown: shown.length, inventedUrlShown: shown.filter((r) => r.decision.inventedUrl === true).length, eligibilityClaimShown: shown.filter((r) => r.decision.claim).length },
  };
  const t = set.thresholds;
  const checks = { guardBlockRate: m.guardBlockRate >= t.guardBlockRate, abstentionRecall: m.abstentionRecall >= t.abstentionRecall, groundedAnswerRate: m.groundedAnswerRate >= t.groundedAnswerRate,
    forbiddenClaimRate: m.forbiddenClaimRate <= t.forbiddenClaimRate, inventedUrlRate: m.inventedUrlRate <= t.inventedUrlRate, noModelErrors: m.modelErrors === 0 };
  return { metrics: m, views, thresholds: t, checks, pass: Object.values(checks).every(Boolean) };
}

async function main() {
  const set = JSON.parse(fs.readFileSync(path.resolve(ROOT, arg('set', 'tests/fixtures/ai-eval-set.v1.json')), 'utf8'));
  const { evaluationHooks: hooks, ASSISTANT_SYSTEM_INSTRUCTION } = await import('../api/_handlers/assistant/chat.js');
  const { generateCitizenLocalStructuredContent } = await import('../api/lib/ai-foundation.js');
  const guardsOnly = process.argv.includes('--guards-only');
  const results = [];
  for (const item of set.items) {
    const pre = decide(item, set, hooks, {});
    let out = null; let latencyMs = 0;
    if (pre.outcome !== 'BLOCK' && !guardsOnly) {
      const t0 = Date.now();
      const r = await generateCitizenLocalStructuredContent({ prompt: hooks.buildModelPrompt({ query: item.message, territory: { label: 'Strasbourg' }, verifiedRecords: item.records.map((k) => set.records[k]) }),
        systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION, zodSchema: hooks.GroundedResponseSchema, tools: [], timeoutMs: 30000 }).catch(() => null);
      latencyMs = Date.now() - t0; out = r && !r.safeErrorState ? r.content : null;
    }
    const decision = pre.outcome === 'BLOCK' ? pre : decide(item, set, hooks, guardsOnly ? { abstain: true } : out);
    results.push({ id: item.id, category: item.category, expect: item.expect, mustCite: item.mustCite, decision, latencyMs });
    process.stdout.write(`${item.id.padEnd(12)} ${decision.outcome}${decision.claim ? ' CLAIM' : ''}${latencyMs ? ` ${latencyMs}ms` : ''}\n`);
  }
  const report = { schema: 'ada.ai-eval-report.v1', at: new Date().toISOString(), model: guardsOnly ? 'none (guards only)' : 'qwen3:8b (local Ollama)', set: { reviewStatus: set.reviewStatus, items: set.items.length }, ...score(set, results), results };
  const outFile = arg('out', null); if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  process.stdout.write(JSON.stringify({ metrics: report.metrics, checks: report.checks, pass: report.pass }, null, 1) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { process.stderr.write(String(e?.message || e) + '\n'); process.exit(1); });
