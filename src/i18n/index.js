/**
 * R32 — the interface language (i18next + react-i18next).
 *
 * Convention: every interface string stays in French IN THE COMPONENT, as the default value of its key — `t('home:hero.title', 'Trouver une aide')`.
 * French therefore needs no resource file, the French text remains readable where it is used (and visible to the source guards such as the
 * decision-wording check), and a key missing in another language falls back to French instead of showing a key. The five other languages live in
 * src/i18n/locales/<lang>/<namespace>.json and are loaded only for a visitor who chose that language. scripts/i18n-check.mjs (and its unit test)
 * verifies that every key exists in every language, with the same placeholders and markup.
 *
 * The choice is kept in the browser only (localStorage « ada_lang », a setting the visitor asked for — no account, no cookie, nothing sent to the
 * server). `?lang=xx` in an address selects a language too (shared links, alternate links for search engines). The browser's own language is only
 * a suggestion (LanguageSuggestion): the site never switches language by itself.
 */
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { useSyncExternalStore } from 'react';
import { LANGUAGE_CODES, SOURCE_LANGUAGE, languageOf, matchLanguage } from './languages.js';

export { LANGUAGES, LANGUAGE_CODES, SOURCE_LANGUAGE, TARGET_LANGUAGES, languageOf, matchLanguage } from './languages.js';

export const STORAGE_KEY = 'ada_lang';
export const LANGUAGE_EVENT = 'ada:language';

const loaders = /** @type {Record<string, () => Promise<any>>} */ (import.meta.glob('./locales/*/*.json'));
const loaded = new Set([SOURCE_LANGUAGE]);

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: SOURCE_LANGUAGE,
  fallbackLng: false,
  supportedLngs: [...LANGUAGE_CODES],
  ns: ['common'],
  defaultNS: 'common',
  keySeparator: false,
  nsSeparator: ':',
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
  partialBundledLanguages: true,
  resources: {},
  initAsync: false,
  react: { useSuspense: false, bindI18n: 'languageChanged loaded' },
});

export default i18n;

const hasWindow = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Loads every namespace file of a language (once). French has none: its strings are the defaults in the components. @param {string} code */
export async function loadLanguage(code) {
  if (!LANGUAGE_CODES.includes(code) || loaded.has(code)) return;
  const prefix = `./locales/${code}/`;
  await Promise.all(Object.entries(loaders).filter(([p]) => p.startsWith(prefix)).map(async ([p, load]) => {
    const mod = await load();
    i18n.addResourceBundle(code, p.slice(prefix.length).replace(/\.json$/, ''), mod.default ?? mod, true, true);
  }));
  loaded.add(code);
}

/** <html lang dir> follow the interface language (screen readers pick their voice from it; Arabic reads right to left). @param {string} code */
export function applyDocumentLanguage(code) {
  if (!hasWindow()) return;
  const l = languageOf(code) || languageOf(SOURCE_LANGUAGE);
  document.documentElement.lang = l.code;
  document.documentElement.dir = l.dir;
}

/** the stored choice, if any @returns {string | null} */
export function storedLanguage() {
  if (!hasWindow()) return null;
  try { return matchLanguage(window.localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

/** `?lang=xx` of the current address, if it names a supported language */
export function languageFromAddress() {
  if (!hasWindow()) return null;
  try { return matchLanguage(new URLSearchParams(window.location.search).get('lang')); } catch { return null; }
}

/** the language the visitor's browser prefers, when it is one of ours and not French (used only to SUGGEST a language) */
export function browserLanguage() {
  if (!hasWindow()) return null;
  const tags = window.navigator.languages?.length ? window.navigator.languages : [window.navigator.language];
  for (const tag of tags) { const c = matchLanguage(tag); if (c) return c === SOURCE_LANGUAGE ? null : c; }
  return null;
}

/** Changes the interface language; `persist` keeps the choice for the next visits. @param {string} code @param {{ persist?: boolean }} [opts] */
export async function setLanguage(code, { persist = true } = {}) {
  const next = matchLanguage(code) || SOURCE_LANGUAGE;
  await loadLanguage(next);
  await i18n.changeLanguage(next);
  applyDocumentLanguage(next);
  if (persist && hasWindow()) { try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* private browsing: the choice lasts for this page */ } }
  if (hasWindow()) window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language: next } }));
  return next;
}

/** Before the first render: the language of the address, else the stored choice, else French. */
export async function bootLanguage() {
  const fromAddress = languageFromAddress();
  const code = fromAddress || storedLanguage() || SOURCE_LANGUAGE;
  try { await setLanguage(code, { persist: Boolean(fromAddress) }); } catch { await setLanguage(SOURCE_LANGUAGE, { persist: false }); }
  return i18n.language;
}

const subscribe = (/** @type {() => void} */ cb) => { i18n.on('languageChanged', cb); return () => i18n.off('languageChanged', cb); };

/** the current interface language, re-rendering on change @returns {{ code: string, dir: 'ltr' | 'rtl', intl: string, name: string, isSource: boolean }} */
export function useLanguage() {
  const code = useSyncExternalStore(subscribe, () => i18n.language || SOURCE_LANGUAGE, () => SOURCE_LANGUAGE);
  const l = languageOf(code) || languageOf(SOURCE_LANGUAGE);
  return { code: l.code, dir: /** @type {'ltr'|'rtl'} */ (l.dir), intl: l.intl, name: l.name, isSource: l.code === SOURCE_LANGUAGE };
}

/** useTranslation bound to this instance (works in tests and server rendering without a provider) @param {string | string[]} [ns] */
export function useT(ns = 'common') {
  return useTranslation(ns, { i18n });
}

const intlOf = (/** @type {string | undefined} */ code) => (languageOf(code || i18n.language) || languageOf(SOURCE_LANGUAGE)).intl;

/** a date in the interface language (« 12 octobre 2026 », « 12 October 2026 »…); '' for an invalid value */
export function formatDate(value, options = { day: 'numeric', month: 'long', year: 'numeric' }, code = undefined) {
  const d = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlOf(code), { timeZone: 'Europe/Paris', ...options }).format(d);
}

/** a number in the interface language */
export function formatNumber(value, options = {}, code = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(intlOf(code), options).format(n) : '';
}

/** an amount in euros in the interface language */
export function formatEuro(value, options = {}, code = undefined) {
  return formatNumber(value, { style: 'currency', currency: 'EUR', ...options }, code);
}
