/**
 * R32 — integrity of the committed content translations (data/translations/<kind>/<slug>.json): schema, fingerprint, statuses, and the automatic
 * checks run AGAIN on every field that the public may see (numbers, links, official names, entitlement claims, French left untranslated). A field
 * shown as « reviewed by a person » must carry the reviewer and the date. Nothing here can make a translation « correct »: it only proves that no
 * shown translation fails the checks it was published under.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELDS, SCHEMA, STATUSES, checkField, sourceHash } from '../../api/lib/contentTranslation.js';
import { TARGET_LANGUAGES } from '../../src/i18n/languages.js';

const ROOT = path.join(process.cwd(), 'data', 'translations');
const files = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).flatMap((k) => fs.readdirSync(path.join(ROOT, k)).filter((f) => f.endsWith('.json')).map((f) => path.join(ROOT, k, f))) : [];
// every string of a field value, in order (the French segmenter would skip lines without Latin letters, e.g. Arabic)
const flat = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join('\n') : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => k !== 'provenance').map(([, x]) => flat(x)).join('\n') : '');

describe('committed content translations', () => {
  it('exist for the published catalogue (or the gate is vacuous on purpose)', () => { expect(Array.isArray(files)).toBe(true); });
  it.each(files.map((f) => [path.relative(ROOT, f), f]))('%s', (_, f) => {
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(t.schema).toBe(SCHEMA);
    expect(Object.keys(FIELDS)).toContain(t.kind);
    expect(t.source.hash).toBe(sourceHash(t.kind, t.source.values));   // the stored French text is the one the fingerprint was made from
    for (const [lang, entry] of Object.entries(t.translations)) {
      expect(TARGET_LANGUAGES).toContain(lang);
      expect(entry.engine).toMatch(/^ollama:/);
      for (const [field, x] of Object.entries(entry.fields)) {
        expect(Object.keys(FIELDS[t.kind])).toContain(field);
        expect([...STATUSES, 'withheld', 'machine_draft']).toContain(x.status);
        if (x.status === 'human_reviewed') expect(x.review).toMatchObject({ by: expect.any(String), at: expect.any(String) });
        if (x.status !== 'auto_checked' && x.status !== 'human_reviewed') continue;
        const c = checkField({ lang, risk: FIELDS[t.kind][field], source: flat(t.source.values[field]), target: flat(x.text) });
        expect({ field, lang, critical: c.critical }).toEqual({ field, lang, critical: [] });
      }
    }
  });
});
