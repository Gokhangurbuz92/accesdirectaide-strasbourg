/**
 * G14-CHAN (Part B) — the French readability heuristic (scripts/falc-readability.mjs, Kandel-Moles): the arithmetic and the syllable counting are checked
 * here; the drafts' scores are only WARNINGS (printed, never a failure: a heuristic is not a standard, see the script's header).
 */
import { describe, expect, it } from 'vitest';
import { FALC_PAGE_DRAFTS } from '../../src/content/falc/citizenPages.fr.js';
import { THRESHOLDS, draftReport, kandelMoles, sentencesOf, syllables, wordsOf } from '../../scripts/falc-readability.mjs';

describe('G14-CHAN French readability heuristic', () => {
  it('counts French syllables approximately (vowel groups, silent final e)', () => {
    expect(['aide', 'loyer', 'maison', 'démarche', 'organisme', 'vérification', 'payée', 'ils parlent'.split(' ')[1], 'CAF', '2026'].map(syllables))
      .toEqual([1, 2, 2, 2, 3, 5, 2, 1, 1, 4]);
    expect(wordsOf('C’est l’organisme qui décide.')).toEqual(['c', 'est', 'l', 'organisme', 'qui', 'décide']);
  });
  it('Kandel-Moles = 207 − 1.015 × words/sentence − 73.6 × syllables/word', () => {
    const s = ['Le chat dort.', 'Il fait beau.'];   // 6 words, 2 sentences, 6 syllables
    expect(kandelMoles(s)).toBeCloseTo(207 - 1.015 * 3 - 73.6 * 1, 6);
    expect(kandelMoles([])).toBeNull();
    expect(sentencesOf(['Une phrase. Une autre !', '', 'Fin'])).toEqual(['Une phrase.', 'Une autre !', 'Fin']);
  });
  it('every draft gets a score; warnings are reported, never a failure (heuristic thresholds)', () => {
    expect(THRESHOLDS).toEqual({ minScore: 70, maxSentenceWords: 15, longWordSyllables: 5 });
    for (const d of Object.values(FALC_PAGE_DRAFTS)) {
      const r = draftReport(d);
      expect(Number.isFinite(r.score), d.id).toBe(true);
      for (const w of r.warnings) console.warn(`[FALC readability, heuristic WARN] ${d.id}: ${w}`);
    }
  });
});
