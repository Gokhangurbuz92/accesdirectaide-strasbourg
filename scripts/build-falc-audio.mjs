#!/usr/bin/env node
/**
 * G14-CHAN — OFFLINE build (owner's Mac, never CI, never at runtime) of the French audio of the simplified page drafts with Piper, a local neural
 * text-to-speech engine (0 €, no network once the voice is on disk). See src/content/falc/falcAudio.js for the licence of the voice and the stale-text rule.
 *
 *   PIPER_VOICE=/path/fr_FR-siwis-medium.onnx node scripts/build-falc-audio.mjs [--only home,notFound]
 *
 * Needs: Piper (default command `uvx --python 3.12 --from piper-tts==1.3.0 piper`, isolated in uv's cache, no system change; override with PIPER_CMD)
 * and macOS `afconvert` (AAC / .m4a, 48 kbit/s mono: plays in every current browser). The voice file and its .onnx.json come from
 * rhasspy/piper-voices (`python -m piper.download_voices fr_FR-siwis-medium`); only fr_FR-siwis-medium is accepted (its licence was checked).
 * Writes public/audio/falc/<id>.m4a and src/content/falc/falc-audio-manifest.json (the hash of the text each file says). Commit both.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALC_PAGE_DRAFTS } from '../src/content/falc/citizenPages.fr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/audio/falc');
const MANIFEST = path.join(ROOT, 'src/content/falc/falc-audio-manifest.json');
const VOICE = process.env.PIPER_VOICE || '';
const PIPER = (process.env.PIPER_CMD || 'uvx --python 3.12 --from piper-tts==1.3.0 piper').split(' ').filter(Boolean);
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new Set(String(process.argv[onlyArg + 1] || '').split(',').filter(Boolean)) : null;

// the same text / hash as the player (src/content/falc/falcAudio.js; that module imports a JSON file, so the two small functions are repeated here and a
// unit test checks they agree)
export const speechText = (d) => [d.title, ...d.blocks.flatMap((b) => [b.heading, ...b.lines])].map((x) => String(x).trim()).filter(Boolean).join('\n');
export const textHash = (t) => { let h = 0x811c9dc5; for (const b of Buffer.from(String(t), 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

function fail(msg) { console.error(`build-falc-audio: ${msg}`); process.exit(1); }

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!VOICE || !fs.existsSync(VOICE)) fail('set PIPER_VOICE to the fr_FR-siwis-medium.onnx file');
  if (path.basename(VOICE) !== 'fr_FR-siwis-medium.onnx') fail('only fr_FR-siwis-medium (CC BY 4.0) is accepted: another voice needs its own licence check');
  if (spawnSync('afconvert', ['-h'], { stdio: 'ignore' }).error) fail('afconvert (macOS) is needed for the .m4a files');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { entries: {} };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falc-audio-'));
  for (const draft of Object.values(FALC_PAGE_DRAFTS)) {
    if (ONLY && !ONLY.has(draft.id)) continue;
    const text = speechText(draft); const wav = path.join(tmp, `${draft.id}.wav`); const out = path.join(OUT_DIR, `${draft.id}.m4a`);
    // one sentence per line, a pause between lines (Piper --sentence_silence)
    const p = spawnSync(PIPER[0], [...PIPER.slice(1), '-m', VOICE, '-f', wav, '--sentence-silence', '0.6', '--length-scale', '1.1'], { input: text, encoding: 'utf8' });
    if (p.status !== 0 || !fs.existsSync(wav)) fail(`piper failed for ${draft.id}: ${String(p.stderr).slice(-300)}`);
    const a = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav, out], { encoding: 'utf8' });
    if (a.status !== 0) fail(`afconvert failed for ${draft.id}`);
    const info = spawnSync('afinfo', [out], { encoding: 'utf8' }).stdout || '';
    const seconds = Math.round(Number(info.match(/estimated duration: ([\d.]+)/)?.[1] || 0));
    manifest.entries[draft.id] = { file: `/audio/falc/${draft.id}.m4a`, hash: textHash(text), seconds, bytes: fs.statSync(out).size };
    console.log(`${draft.id}: ${seconds} s, ${fs.statSync(out).size} bytes`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  manifest.voice = 'fr_FR-siwis-medium'; manifest.generatedOn = new Date().toISOString().slice(0, 10);
  manifest.entries = Object.fromEntries(Object.entries(manifest.entries).sort(([x], [y]) => x.localeCompare(y)));
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: ${path.relative(ROOT, MANIFEST)}`);
}
