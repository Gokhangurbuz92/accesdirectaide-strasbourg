// FA-D4 — the institutional observatory's methodology in six languages. The server sends it in French by key (api/_services/territorial-stats.js METHODOLOGY,
// + METHODOLOGY_TERRITORY); the page shows methodText(t)[key] || the server's text. Defects found: four keys (organisations, dominance, gel, base) had no
// entry, so en/tr/ar/de/uk readers saw French; and two French defaults (limites, totaux) were older than the server's text, so French readers saw an
// out-of-date method.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { methodText } from '../../src/lib/observatoryMethodText.js';
import { extractKeys, loadLocale } from '../../scripts/i18n-check.mjs';

const { METHODOLOGY, METHODOLOGY_TERRITORY } = await import('../../api/_services/territorial-stats.js');
const SERVER = { ...METHODOLOGY, territoire: METHODOLOGY_TERRITORY };
const french = methodText((_k, d) => d);
const keys = extractKeys(fs.readFileSync(path.resolve('src/lib/observatoryMethodText.js'), 'utf8')).filter((k) => k.ns === 'institution');

describe('FA-D4 observatory methodology — every server key, current French, five translations', () => {
  it('every key the server sends has a translatable entry', () => {
    expect(Object.keys(SERVER).filter((k) => !(k in french))).toEqual([]);
  });
  it('the French default of each entry is the server text, word for word', () => {
    expect(Object.keys(SERVER).filter((k) => french[k] !== SERVER[k])).toEqual([]);
  });
  it.each(['en', 'tr', 'ar', 'de', 'uk'])('%s: each entry is translated (present, not empty, not the French text)', (lang) => {
    const bundle = loadLocale(lang).institution || {};
    const bad = keys.filter((k) => typeof bundle[k.id] !== 'string' || !bundle[k.id].trim() || bundle[k.id] === k.defaults['']).map((k) => k.id);
    expect(bad).toEqual([]);
    const shown = methodText((k, d) => bundle[k.split(':')[1]] ?? d);
    expect(Object.keys(SERVER).filter((k) => shown[k] === SERVER[k])).toEqual([]);
  });
});
