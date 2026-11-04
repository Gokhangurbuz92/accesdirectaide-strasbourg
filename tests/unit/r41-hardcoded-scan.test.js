/**
 * R41-C — regression guard of the hard-coded interface strings (scripts/i18n-hardcoded-scan.mjs).
 *
 * Every JSX text / user-facing attribute literal that does not go through i18next must be an approved exception (scripts/i18n-hardcoded-exceptions.json:
 * proper names, French legal terms, developer-only diagnostics, unmounted files…). A new French string in a screen fails here; so does mounting a file
 * whose exception was « unmounted » (its strings would reach visitors untranslated).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadExceptions, reachableFiles, scan, scanCode } from '../../scripts/i18n-hardcoded-scan.mjs';

const CATEGORIES = new Set(['unmounted', 'storybook', 'developer-only', 'proper-name', 'french-term', 'french-legal', 'lang-fr', 'unit', 'technical-id', 'example-value', 'trans-component', 'source-branch']);

describe('the hard-coded string scanner', () => {
  it('finds JSX text, user-facing attributes and string children, and ignores <Trans> content', () => {
    const found = scanCode(`
      const A = () => (<div title="Un titre"><p>Bonjour à vous</p>{'Une phrase ici'}<span>{t('x:y', 'Traduit')}</span>
        <Trans i18nKey="x:z" defaults="Voir la <0>page</0>" components={[<a key="a">page</a>]}>Voir la page</Trans><b>12</b></div>);`);
    expect(found.map((f) => `${f.kind}:${f.text}`)).toEqual(['ATTR:Un titre', 'TEXT:Bonjour à vous', 'EXPR:Une phrase ici']);
  });

  it('follows static, dynamic and @/ imports from src/main.jsx', () => {
    const reach = reachableFiles();
    expect(reach.has('src/pages/pro/SharedDossier.jsx')).toBe(true);
    expect(reach.has('src/components/FileVault.jsx')).toBe(true);
    expect(reach.has('src/components/ReportContentButton.jsx')).toBe(false);
  });
});

describe('R41 hard-coded strings', () => {
  const r = scan();
  it('every hard-coded string is an approved exception (count <= the exception list)', () => {
    expect(r.unapproved.map((x) => `${x.file}:${x.line} ${x.text}`)).toEqual([]);
    expect(r.total).toBe(r.approved);
    // the count may only go down: 244 at the end of R41-C (290 by the R40 audit walk at the start); 203 after R42-POLISH deleted 3 dead files
    expect(r.total).toBeLessThanOrEqual(203);
  });
  it('no « unmounted » exception covers a file the application now imports', () => {
    expect(r.staleUnmounted.map((x) => x.file)).toEqual([]);
  });
  it('R42: the dead components with unsupported claims are deleted, not excepted (A7)', () => {
    // ConsentPad (« 30 jours », « SHA-256 infalsifiable »), DiagnosticResults (« valide 7 jours ») and its only importee DiagnosticTraceModal
    for (const f of ['src/components/ConsentPad.jsx', 'src/components/assistant/DiagnosticResults.jsx', 'src/components/assistant/DiagnosticTraceModal.jsx']) {
      expect(fs.existsSync(f), f).toBe(false);
      expect(loadExceptions().some((e) => e.file === f), f).toBe(false);
    }
  });
  it('every exception is used, has a known category and a reason', () => {
    expect(r.unusedExceptions).toEqual([]);
    for (const e of loadExceptions()) {
      expect(CATEGORIES.has(e.category), `${e.file} ${e.category}`).toBe(true);
      expect(e.reason.length, `${e.file} « ${e.text} »`).toBeGreaterThan(10);
    }
  });
});
