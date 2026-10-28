/**
 * PKG-6 / N14 (R3) — the model never receives a URL: records reach it without sourceUrl (the server adds each cited record's link to `citations`), so any URL in
 * its text is invented and refused. Handler and evaluation harness build the prompt with the SAME function (the harness measures what citizens get).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelPrompt, ASSISTANT_SYSTEM_INSTRUCTION, evaluationHooks } from '../../api/_handlers/assistant/chat.js';

const records = [{ sourceId: 's1', entityType: 'aide', entityId: 'apl', title: 'APL', content: 'Aide au logement versée par la CAF.', sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', verifiedAt: '2026-07-01' }];

describe('PKG-6 / N14 R3 prompt contract', () => {
  it('records keep their id, title and content but lose their URL; the assessment is passed read-only when given', () => {
    const p = JSON.parse(buildModelPrompt({ query: 'APL ?', territory: { label: 'Strasbourg' }, verifiedRecords: records, assessment: [{ code: 'apl', state: 'CHECK_REQUIRED' }] }));
    expect(p.verifiedRecords).toEqual([{ sourceId: 's1', entityType: 'aide', entityId: 'apl', title: 'APL', content: 'Aide au logement versée par la CAF.', verifiedAt: '2026-07-01' }]);
    expect(JSON.stringify(p)).not.toMatch(/https?:|www\./);
    expect(p.assessmentReadOnly).toEqual([{ code: 'apl', state: 'CHECK_REQUIRED' }]);
    expect(JSON.parse(buildModelPrompt({ query: 'x', territory: null, verifiedRecords: records })).assessmentReadOnly).toBeUndefined();
    expect(records[0].sourceUrl).toBeDefined();   // the caller's records are not mutated: citations still carry the link
  });
  it('the instruction says links are added by the server, forbids eligibility wording and keeps abstentions short', () => {
    expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/N ecris aucune URL/);
    expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/N ecris jamais que la personne est eligible/);
    expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/Si abstain=true, answer dit seulement/);
  });
  it('a URL in the model text is still refused by the unchanged post-validation, and handler + harness share the prompt builder', () => {
    expect(evaluationHooks.answerUsesOnlyRetrievedUrls('Voir https://exemple.fr/apl', records)).toBe(false);
    expect(evaluationHooks.buildModelPrompt).toBe(buildModelPrompt);
    expect(fs.readFileSync('api/_handlers/assistant/chat.js', 'utf8')).toMatch(/prompt: buildModelPrompt\(\{ query: trimmedMessage/);
    expect(fs.readFileSync('scripts/ai-eval.mjs', 'utf8')).toMatch(/prompt: hooks\.buildModelPrompt\(/);
  });
});
