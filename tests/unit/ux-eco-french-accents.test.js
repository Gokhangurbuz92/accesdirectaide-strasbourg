/**
 * UX ecosystem (2026-11-12) — the French interface strings of the ADA Pro appointment screens were written without accents (« Creer un RDV »,
 * « Selectionnez un creneau », « Parametres RDV enregistres », « Reessayer »…). They are the French source of the six languages; this guard keeps the
 * common unaccented forms out of the French defaults of the whole interface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../src');
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : files(path.join(d, e.name))) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(d, e.name)] : []));
const BAD = /\b(Creer|creer|Reessayer|reessayer|Selectionnez|Selectionner|creneaux?|Creneaux|Parametres|parametres|beneficiaire|Telephone|Presentiel|Duree|probleme|periode|Periode|Desactiver|enregistres)\b/;

describe('UX ecosystem: French defaults keep their accents', () => {
  it('no common unaccented French word in a t(key, default) default', () => {
    const hits = [];
    for (const f of files(ROOT)) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'[a-z]+:[^']+',\s*'((?:[^'\\]|\\.)*)'/g)) if (BAD.test(m[1])) hits.push(`${path.relative(ROOT, f)}: ${m[1].slice(0, 80)}`);
    }
    expect(hits).toEqual([]);
  });
});
