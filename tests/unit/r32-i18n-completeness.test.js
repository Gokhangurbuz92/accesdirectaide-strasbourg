/**
 * R32 — the interface is complete in the five target languages: every key used in src/ exists in en, tr, ar, de and uk (every plural category of
 * the language), with the same placeholders and markup as the French default, never empty, never asserting an entitlement.
 */
import { describe, expect, it } from 'vitest';
import { check, extractKeys } from '../../scripts/i18n-check.mjs';
import { LANGUAGES, matchLanguage } from '../../src/i18n/languages.js';

describe('R32 interface translations', () => {
  it('extracts keys, French defaults and plural forms from components', () => {
    const k = extractKeys(`const a = t('home:title', 'Bonjour'); const b = t('home:n', { count: n, defaultValue_one: '{{count}} aide', defaultValue_other: '{{count}} aides' });
      const c = <Trans i18nKey="home:link" defaults="Voir <0>la page</0>" components={[<a />]} />; const d = t('not-a-key');`, 'x.jsx');
    expect(k.map((x) => x.key)).toEqual(['home:title', 'home:n', 'home:link']);
    expect(k[1]).toMatchObject({ plural: true, defaults: { one: '{{count}} aide', other: '{{count}} aides' } });
  });
  it('six languages, Arabic right to left, browser tags matched to a supported language', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['fr', 'en', 'tr', 'ar', 'de', 'uk']);
    expect(LANGUAGES.find((l) => l.code === 'ar').dir).toBe('rtl');
    expect([matchLanguage('uk-UA'), matchLanguage('ar_MA'), matchLanguage('pt-BR'), matchLanguage('')]).toEqual(['uk', 'ar', null, null]);
  });
  it('every key exists in every target language, consistent and without entitlement claims', () => {
    const r = check();
    const problems = Object.fromEntries(Object.entries(r.languages).map(([l, x]) => [l, { missing: x.missing.slice(0, 10), mismatched: x.mismatched.slice(0, 10), claims: x.claims, empty: x.empty.slice(0, 10) }]));
    expect(r.noDefault).toEqual([]);
    expect({ ok: r.ok, problems }).toEqual({ ok: true, problems: Object.fromEntries(Object.keys(r.languages).map((l) => [l, { missing: [], mismatched: [], claims: [], empty: [] }])) });
    expect(r.keys).toBeGreaterThan(0);
  });
});
