#!/usr/bin/env node
/**
 * R32 — editorial translation of the verified PUBLIC content (run on the publisher's machine, with a local engine; never in production).
 *
 *   node scripts/translate-content.mjs --engine translategemma:4b [--back translategemma:4b] [--langs en,tr,ar,de,uk]
 *        [--kinds aide,demarche,guide,actualite,dispositif] [--slug <slug>] [--base https://www.accesdirectaide.fr] [--report <file.json>]
 *   node scripts/translate-content.mjs --status [--base …]        the queue: missing / outdated / withdrawn translations, nothing translated
 *
 * Reads only what the public API publishes (so only verified, visible records — the D-5 rule applies before anything is translated). For each
 * record and language: the French fields of api/lib/contentTranslation.js FIELDS are cut into units, official names are protected, each unit is
 * translated and translated back into French, every field is checked (checkField) and gets a status; the result is written to
 * data/translations/<kind>/<slug>.json with the SHA-256 of the French source. A record whose French text has not changed and whose translation
 * was made by the same engine and checks version is skipped. Translations of records no longer published are deleted (--status lists them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS, KINDS, SCHEMA, checkField, fieldStatus, protect, recordStatus, restore, sourceFields, sourceHash, unitsOf } from '../api/lib/contentTranslation.js';
import { Engine } from './lib/translation-engines.mjs';

export const CHECKS_VERSION = 'r32-checks-2';   // 2: lower-case acronyms and MSA protected, more uncertainty phrasings
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'translations');
const LIST = { aide: 'aides?limit=50', demarche: 'demarches?limit=50', guide: 'guides', actualite: 'actualites?limit=50', dispositif: 'dispositifs' };
const DETAIL = { aide: 'aides/', demarche: 'demarches/', guide: 'guides/', actualite: 'actualites/', dispositif: 'dispositifs/' };

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(base, p) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const r = await fetch(`${base}/api/${p}`);
    if (r.status === 429) { await sleep(65000); continue; }   // the public read API is rate-limited per address
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`${p}: rate-limited`);
}

/** the published records of a kind, in full (detail payloads) */
export async function publishedRecords(base, kind) {
  const list = await getJson(base, LIST[kind]);
  const items = Array.isArray(list) ? list : list.items || [];
  const out = [];
  for (const it of items) { await sleep(700); const d = await getJson(base, DETAIL[kind] + encodeURIComponent(it.slug)); out.push(d.item && typeof d.item === 'object' ? d.item : d); }
  return out;
}

const fileOf = (kind, slug) => path.join(OUT, kind, `${slug}.json`);
const readFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** translates one field into one language @returns {Promise<{ text: any, status: string, checks: any }>} */
async function translateField(engine, back, lang, kind, field, value, previous) {
  const risk = FIELDS[kind][field];
  const { units, rebuild } = unitsOf(value);
  if (!units.length) return { text: value ?? null, status: 'auto_checked', checks: { critical: [], warnings: [], roundtrip: null, units: 0 } };
  const glossed = new Set(); const targets = []; const backs = []; const missing = [];
  for (const u of units) {
    const p = protect(u);
    const raw = await engine.translate('fr', lang, p.text);
    const r = restore(raw, p.slots, lang, glossed);
    missing.push(...r.missing);
    targets.push(r.text);
    if (back) backs.push(await back.translate(lang, 'fr', r.text));
  }
  const text = rebuild(targets);
  const checks = { ...checkField({ lang, risk, source: units.join('\n'), target: targets.join('\n'), back: back ? backs.join('\n') : null, missing }), units: units.length };
  const reviewed = Boolean(previous?.review && previous?.text !== undefined && JSON.stringify(previous.text) === JSON.stringify(text));
  return { text, status: fieldStatus(checks, risk, reviewed), checks, ...(reviewed ? { review: previous.review } : {}) };
}

async function translateRecord({ engine, back, langs, kind, record, base }) {
  const hash = sourceHash(kind, record);
  const f = fileOf(kind, record.slug);
  const prev = readFile(f);
  const file = prev && prev.source?.hash === hash ? prev : { schema: SCHEMA, kind, slug: record.slug, recordId: record.id || null, translations: {} };
  file.schema = SCHEMA; file.kind = kind; file.slug = record.slug; file.recordId = record.id || null;
  // the French text that was translated is kept beside its translations: reviewers compare side by side, and the unit gate re-checks every shown field
  file.source = { lang: 'fr', hash, fields: Object.keys(FIELDS[kind]), values: sourceFields(kind, record), verifiedAt: record.date_verification || record.provenance?.verifiedAt || null,
    sourceUrl: record.source_url_exact || record.source_url || record.provenance?.sourceUrl || null, licence: record.contenu_json?.provenance?.licence || record.licence || null, readFrom: base };
  const done = [];
  for (const lang of langs) {
    const old = file.translations[lang];
    if (old && old.engine === engine.id && old.backEngine === (back?.id || null) && old.checksVersion === CHECKS_VERSION) { done.push({ lang, skipped: true, status: recordStatus(old) }); continue; }
    const fields = {};
    for (const field of Object.keys(FIELDS[kind])) {
      const v = record[field];
      if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)) continue;
      fields[field] = await translateField(engine, back, lang, kind, field, v, old?.fields?.[field]);
    }
    file.translations[lang] = { engine: engine.id, engineDigest: engine.digest, backEngine: back?.id || null, checksVersion: CHECKS_VERSION, translatedAt: new Date().toISOString(), review: null, fields };
    done.push({ lang, status: recordStatus(file.translations[lang]), withheld: Object.entries(fields).filter(([, x]) => x.status === 'withheld').map(([k, x]) => `${k}:${[...x.checks.critical, ...x.checks.warnings].join('+')}`) });
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(file, null, 1)}\n`);
  return done;
}

/** the translation queue: what is missing, outdated (French changed) or orphaned (record withdrawn) */
export function queueOf(kind, records, langs) {
  const dir = path.join(OUT, kind);
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => x.replace(/\.json$/, '')) : [];
  const slugs = new Set(records.map((r) => r.slug));
  const out = { missing: [], outdated: [], withdrawn: present.filter((s) => !slugs.has(s)) };
  for (const r of records) {
    const file = readFile(fileOf(kind, r.slug));
    for (const lang of langs) {
      if (!file?.translations?.[lang]) out.missing.push(`${r.slug}:${lang}`);
      else if (file.source?.hash !== sourceHash(kind, r)) out.outdated.push(`${r.slug}:${lang}`);
    }
  }
  return out;
}

async function main() {
  const base = (arg('base', 'https://www.accesdirectaide.fr')).replace(/\/$/, '');
  const langs = (arg('langs', 'en,tr,ar,de,uk')).split(',');
  const kinds = (arg('kinds', KINDS.join(','))).split(',').filter((k) => KINDS.includes(k));
  const only = arg('slug');
  const report = { base, startedAt: new Date().toISOString(), kinds: {}, engine: null };
  if (process.argv.includes('--status')) {
    for (const kind of kinds) report.kinds[kind] = queueOf(kind, await publishedRecords(base, kind), langs);
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  const engine = new Engine(arg('engine', 'translategemma:4b'));
  const backModel = arg('back', arg('engine', 'translategemma:4b'));
  const back = backModel === 'none' ? null : backModel === engine.model ? engine : new Engine(backModel);
  report.engine = await engine.describe();
  for (const kind of kinds) {
    const records = (await publishedRecords(base, kind)).filter((r) => !only || r.slug === only);
    report.kinds[kind] = { records: records.length, results: [] };
    for (const record of records) {
      const done = await translateRecord({ engine, back, langs, kind, record, base });
      report.kinds[kind].results.push({ slug: record.slug, done });
      console.log(`${kind} ${record.slug} ${done.map((d) => `${d.lang}:${d.skipped ? 'kept' : d.status}${d.withheld?.length ? `(${d.withheld.join(' ')})` : ''}`).join(' ')}`);
    }
    if (!only) for (const slug of queueOf(kind, records, langs).withdrawn) { fs.rmSync(fileOf(kind, slug)); console.log(`${kind} ${slug} removed (no longer published)`); }
  }
  report.finishedAt = new Date().toISOString();
  report.engineStats = { forward: engine.stats, back: back && back !== engine ? back.stats : null };
  if (arg('report')) fs.writeFileSync(arg('report'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`TRANSLATE_DONE ${JSON.stringify({ engine: engine.id, stats: engine.stats })}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });
