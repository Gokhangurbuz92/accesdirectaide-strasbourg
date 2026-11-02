/**
 * R32 — local machine-translation engines for the editorial translation of PUBLIC verified content. Runs on the publisher's machine through
 * Ollama (http://127.0.0.1:11434); nothing is sent to an online service, and only public content is ever translated (never personal data).
 * Deterministic settings (temperature 0, fixed seed) and a cache keyed by engine, direction and the SHA-256 of the text (~/.ada-lab/translation-cache)
 * make a re-run reproducible and incremental.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LANGUAGE_NAMES = { fr: 'French', en: 'English', tr: 'Turkish', ar: 'Arabic', de: 'German', uk: 'Ukrainian' };
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CACHE_DIR = process.env.ADA_TRANSLATION_CACHE || path.join(os.homedir(), '.ada-lab', 'translation-cache');

/** prompt per model family (TranslateGemma: the format of its model card; others: an instruction asking for the translation only) */
// R33 repair attempts: the same model, told explicitly what the automatic checks found missing (never a looser check afterwards)
const STRICT = 'Copy every number, date, amount, percentage, form number, link and placeholder such as [[T1]] exactly as written. Keep every negation and condition. Write every word in the target script.';
function promptFor(model, from, to, text, attempt = 0) {
  const F = LANGUAGE_NAMES[from]; const T = LANGUAGE_NAMES[to];
  if (/translategemma/i.test(model)) {
    return `You are a professional ${F} (${from}) to ${T} (${to}) translator. Your goal is to accurately convey the meaning and nuances of the original ${F} text while adhering to ${T} grammar, vocabulary, and cultural sensitivities.${attempt ? ` ${STRICT}` : ''}\nProduce only the ${T} translation, without any additional explanations or commentary. Please translate the following ${F} text into ${T}:\n\n\n${text}`;
  }
  return `/no_think\nTranslate the following ${F} text into ${T}. Keep every placeholder such as [[T1]] exactly as it is, keep numbers, dates and links exactly, keep the meaning exact (negations, conditions, uncertainty). Output only the ${T} translation, nothing else.\n\n${text}`;
}

const clean = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*(?:Translation|Traduction)\s*:\s*/i, '').trim();

export class Engine {
  /** @param {string} model an Ollama model tag, e.g. translategemma:4b */
  constructor(model) {
    this.model = model; this.id = `ollama:${model}`; this.digest = null; this.stats = { calls: 0, cached: 0, ms: 0, chars: 0 };
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    this.cacheFile = path.join(CACHE_DIR, `${model.replace(/[^a-z0-9.-]/gi, '_')}.jsonl`);
    this.cache = new Map();
    if (fs.existsSync(this.cacheFile)) for (const line of fs.readFileSync(this.cacheFile, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); this.cache.set(r.k, r.v); } catch { /* skip a torn line */ } }
  }
  async describe() {
    const r = await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model: this.model }) }).then((x) => x.json()).catch(() => null);
    const tags = await fetch(`${OLLAMA}/api/tags`).then((x) => x.json()).catch(() => ({ models: [] }));
    const m = tags.models?.find((x) => x.name === this.model || x.model === this.model);
    this.digest = m?.digest || null;
    return { id: this.id, digest: this.digest, parameters: r?.details?.parameter_size || null, quantization: r?.details?.quantization_level || null, sizeBytes: m?.size || null, licence: (r?.license || '').split('\n')[0] || null };
  }
  /** @param {string} from @param {string} to @param {string} text */
  /** @param {string} from @param {string} to @param {string} text @param {number} [attempt] 0 = normal; 1, 2 = repair attempts (strict instruction) */
  async translate(from, to, text, attempt = 0) {
    const k = crypto.createHash('sha256').update(`${from}>${to}${attempt ? `#repair${attempt}` : ''}\n${text}`).digest('hex');
    if (this.cache.has(k)) { this.stats.cached += 1; return this.cache.get(k); }
    const t0 = Date.now();
    const body = JSON.stringify({ model: this.model, prompt: promptFor(this.model, from, to, text, attempt), stream: false, keep_alive: '2m', options: { temperature: 0, seed: 7 + attempt, num_predict: Math.min(4096, 200 + text.length * 3) } });
    // R34: a single transient server error (Ollama answered 500 once after 41 minutes) ended a multi-hour run; retry a 5xx up to 3 times, same request
    let res;
    for (let i = 0; i < 4; i += 1) {
      res = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body });
      if (res.ok || res.status < 500 || i === 3) break;
      this.stats.retries = (this.stats.retries || 0) + 1;
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
    if (!res.ok) throw new Error(`engine ${this.model} answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)} — input ${JSON.stringify(text.slice(0, 160))}`);
    const v = clean((await res.json()).response);
    this.stats.calls += 1; this.stats.ms += Date.now() - t0; this.stats.chars += text.length;
    this.cache.set(k, v);
    fs.appendFileSync(this.cacheFile, `${JSON.stringify({ k, v })}\n`, { mode: 0o600 });
    return v;
  }
}
