/**
 * Actualités v2 — the optional AI illustration adapter. NO provider is approved (owner directive 11/11/2026: never silently activate an external image
 * API or incur paid usage), so `illustrationProvider()` returns null and the site uses the original ADA drawings (src/components/news/NewsIllustration).
 *
 * When the owner approves a provider and its budget, it is plugged in here behind NEWS_AI_IMAGES_APPROVED=on + NEWS_AI_IMAGES_PROVIDER=<name>, and
 * every image it makes follows these rules (enforced by `conceptPrompt` and by the editorial workflow, which labels kind « ai »):
 *  - a CONCEPT of the theme (housing, family, health…), never a depiction of a real event, place-specific scene, disaster, protest, crime or victim;
 *  - no real person, no face of a recognisable person, no logo, no text imitating a document;
 *  - illustrative style (flat, drawn), never photorealistic evidence;
 *  - always shown with « Illustration générée par IA » and stored with its provider and prompt (provenance).
 */
import { TOPIC_IDS } from './editorial.js';

export const AI_LABEL = 'Illustration générée par IA';

/** @param {Record<string, string | undefined>} [env] @returns {null | { name: string }} */
export function illustrationProvider(env = process.env) {
  if (env.NEWS_AI_IMAGES_APPROVED !== 'on' || !env.NEWS_AI_IMAGES_PROVIDER) return null;
  // no adapter is implemented until a provider is approved: an approved name without an adapter is refused, never a guess
  return null;
}

/** @type {Record<string, string>} */
const THEMES = {
  logement: 'a simple house and keys', famille: 'abstract family figures holding hands', sante: 'a stethoscope and a heart shape', droits: 'a document with a check mark',
  emploi: 'a briefcase and a rising arrow', education: 'books and a graduation cap', handicap: 'an accessible ramp and doorway', justice: 'balanced scales',
  environnement: 'leaves and a sun', economie: 'coins and a bar chart', international: 'a stylised globe', politique: 'a columned public building',
  technologie: 'a laptop and connection lines', culture: 'a theatre mask and music notes', strasbourg: 'a stylised cathedral spire and river', societe: 'abstract people shapes',
};
/** the only prompt an AI illustration may receive: a theme, never an event @param {string} topic @returns {string | null} */
export function conceptPrompt(topic) {
  if (!TOPIC_IDS.includes(topic) || topic === 'une') return null;
  return `Flat editorial illustration, conceptual, no people faces, no text, no logos, no real places or events, soft colours: ${THEMES[topic]}.`;
}
