#!/usr/bin/env node
/**
 * G14-CHAN (Part B) — a French readability HEURISTIC for the simplified page drafts (src/content/falc/citizenPages.fr.js). WARN level only: it never fails a
 * build, it points at sentences worth a second look by the participatory review (docs/falc/KIT_TEST_LECTEURS_FALC.md).
 *
 * Score: Kandel & Moles (1958), the French adaptation of the Flesch reading ease: 207 − 1.015 × (words / sentences) − 73.6 × (syllables / words).
 * It is a HEURISTIC, NOT A STANDARD: it was calibrated on adult written French of the 1950s, counts syllables approximately (written vowel groups, a
 * silent final « e » removed) and knows nothing about the meaning, the order of ideas, the examples or the reader — which is what the Unapei FALC rules
 * and the review with readers check. No threshold below is normative; they were chosen for this project as warning levels:
 *   draft score  < 70  WARN   (on the Flesch-style scale 70-80 reads « fairly easy », 80+ « easy »)
 *   sentence     > 15 words   WARN   (the Unapei rules ask for short sentences without a number; 15 is this project's warning level)
 *   word         ≥ 5 syllables WARN  (long words; listed, they may be needed and explained in the glossary)
 *   node scripts/falc-readability.mjs [--json]     exit 0 always (GitHub annotations « ::warning » under CI)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FALC_PAGE_DRAFTS } from '../src/content/falc/citizenPages.fr.js';

export const THRESHOLDS = Object.freeze({ minScore: 70, maxSentenceWords: 15, longWordSyllables: 5 });
const VOWELS = 'aeiouyàâäéèêëîïôöùûüÿœæ';
const GROUP = new RegExp(`[${VOWELS}]+`, 'g');

/** the words of a text (letters, apostrophes and hyphens inside a word; numbers count as one word) @param {string} text */
export const wordsOf = (text) => String(text).toLowerCase().replace(/[’']/g, ' ').match(/[a-zàâäçéèêëîïôöùûüÿœæ0-9-]+/g)?.filter((w) => /[a-zàâäçéèêëîïôöùûüÿœæ0-9]/.test(w)) || [];

/** approximate French syllables of one word (written vowel groups; a final silent « e / es / ent » after a consonant is not a syllable) @param {string} word */
export function syllables(word) {
  // a « y » between two vowels is a consonant sound that splits them (lo-yer, pa-yée)
  const w = String(word).toLowerCase().replace(/([aeiouàâéèêîôû])y(?=[aeiouàâéèêîôû])/g, '$1j');
  if (/^[0-9]+$/.test(w)) return Math.max(1, w.length);   // a number read aloud: about one syllable per digit
  let n = (w.match(GROUP) || []).length;
  if (n > 1 && /[^aeiouyàâäéèêëîïôöùûüÿœæ](e|es|ent)$/.test(w) && !/(ée|ées)$/.test(w)) n -= 1;
  return Math.max(1, n);
}

/** sentences: one per line in the drafts, and split again on . ! ? @param {string[]} lines */
export const sentencesOf = (lines) => lines.flatMap((l) => String(l).split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => wordsOf(s).length);

/** Kandel-Moles score of a list of sentences @param {string[]} sentences */
export function kandelMoles(sentences) {
  const words = sentences.flatMap(wordsOf);
  if (!sentences.length || !words.length) return null;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return 207 - 1.015 * (words.length / sentences.length) - 73.6 * (syl / words.length);
}

/** the warnings of one draft @param {{ id: string, title: string, blocks: { heading: string, lines: string[] }[] }} draft */
export function draftReport(draft) {
  const sentences = sentencesOf([draft.title, ...draft.blocks.flatMap((b) => [b.heading, ...b.lines])]);
  const score = kandelMoles(sentences);
  const warnings = [];
  if (score !== null && score < THRESHOLDS.minScore) warnings.push(`score ${score.toFixed(1)} < ${THRESHOLDS.minScore}`);
  for (const s of sentences) { const n = wordsOf(s).length; if (n > THRESHOLDS.maxSentenceWords) warnings.push(`${n} words: « ${s} »`); }
  const long = [...new Set(sentences.flatMap(wordsOf).filter((w) => syllables(w) >= THRESHOLDS.longWordSyllables))];
  if (long.length) warnings.push(`long words: ${long.join(', ')}`);
  return { id: draft.id, sentences: sentences.length, score: score === null ? null : Math.round(score * 10) / 10, warnings };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const reports = Object.values(FALC_PAGE_DRAFTS).map(draftReport);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ heuristic: 'Kandel-Moles', thresholds: THRESHOLDS, reports }, null, 1));
  else for (const r of reports) {
    console.log(`${r.id}: Kandel-Moles ${r.score} (${r.sentences} sentences)${r.warnings.length ? '' : ' — no warning'}`);
    for (const w of r.warnings) console.log(process.env.GITHUB_ACTIONS ? `::warning title=FALC readability (heuristic) ${r.id}::${w}` : `  WARN ${w}`);
  }
  process.exit(0);
}
