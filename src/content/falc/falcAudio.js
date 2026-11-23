/**
 * G14-CHAN — pre-rendered French audio of the simplified page drafts (src/content/falc/citizenPages.fr.js), made OFFLINE on the owner's Mac with Piper
 * (scripts/build-falc-audio.mjs) and served as static files (public/audio/falc/<id>.m4a). Nothing is synthesised at runtime and no text leaves the site.
 * A file is played only while the draft's text is still the one it was made from (`falcTextHash`): an edited draft without a rebuilt file shows no
 * player (the device's own read-aloud, src/hooks/useReadAloud.js, stays available) — never audio that says something else than the page.
 * Voice: Piper « fr_FR-siwis-medium », trained on the SIWIS French Speech Synthesis Database (University of Edinburgh), licence CC BY 4.0 (MODEL_CARD of
 * rhasspy/piper-voices, and the database's end-user licence on Edinburgh DataShare, both read on 23/11/2026): redistribution allowed, attribution required
 * (FALC_AUDIO_VOICE.attribution, shown under every player). Piper itself (GPL-3.0) is a build tool only: it is not shipped.
 */
import manifest from './falc-audio-manifest.json';

export const FALC_AUDIO_VOICE = Object.freeze({
  id: 'fr_FR-siwis-medium',
  licence: 'CC BY 4.0',
  attribution: 'Voix de synthèse Piper « siwis » (base SIWIS, Université d’Édimbourg, licence CC BY 4.0).',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/deed.fr',
});

/** the text a draft's audio says: title, then each heading and its lines, one per line @param {{ title: string, blocks: { heading: string, lines: string[] }[] }} draft */
export function falcSpeechText(draft) {
  return [draft.title, ...draft.blocks.flatMap((b) => [b.heading, ...b.lines])].map((x) => String(x).trim()).filter(Boolean).join('\n');
}

/** FNV-1a 32-bit of the UTF-8 text, 8 hex digits (a staleness check, not a security measure) @param {string} text */
export function falcTextHash(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(text))) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** @typedef {{ file: string, hash: string, seconds: number, bytes: number }} FalcAudioEntry */
/** the manifest written by the build @type {{ voice: string, generatedOn: string | null, entries: Record<string, FalcAudioEntry> }} */
export const FALC_AUDIO_MANIFEST = manifest;

/** the audio of a draft, only when it matches the current text @param {{ id: string, title: string, blocks: any[] }} draft @returns {FalcAudioEntry | null} */
export function falcAudioFor(draft, m = FALC_AUDIO_MANIFEST) {
  const e = draft && m?.entries?.[draft.id];
  return e && e.hash === falcTextHash(falcSpeechText(draft)) ? e : null;
}
