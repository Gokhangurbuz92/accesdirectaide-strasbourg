import { useEffect, useMemo, useRef, useState } from 'react';
import { SOURCE_LANGUAGE, languageOf, useLanguage } from '@/i18n';

/**
 * R32 — the text of a verified record (aide, démarche, guide, news, dispositif, structure) in the interface language, when a translation exists
 * and may be shown; otherwise the French text, marked `lang="fr"` so screen readers and the page reader pronounce it in French.
 *
 *   const tr = useContentTranslation('aide', aide);
 *   <h1 {...tr.attrs('titre')}>{tr.value('titre')}</h1>
 *   <ContentTranslationNotice translation={tr} />
 *
 * `value(field)` returns the same type as the record field, `attrs(field)` the `{ lang, dir }` of the element holding it. `status`: 'source'
 * (French interface), 'loading', 'unavailable', 'auto_checked', 'partial', 'human_reviewed', 'outdated', 'withheld'. The server
 * (GET /api/translations) decides what may be shown: only fields that passed the automatic checks (or a recorded human review) and only while
 * the French text is the one that was translated. Lists load one light request per kind (titles and summaries); the full text of a record is
 * loaded only when the page displays more than its title and summary. Structures (lieux) are never translated (names, addresses).
 *
 * @param {'aide' | 'demarche' | 'guide' | 'actualite' | 'dispositif' | 'structure'} kind @param {Record<string, any> | null | undefined} record
 */
const TRANSLATED = new Set(['aide', 'demarche', 'guide', 'actualite', 'dispositif']);
const SUMMARY = { aide: ['titre', 'description', 'cest_quoi'], demarche: ['titre', 'description_courte'], guide: ['titre'], actualite: ['titre', 'resume'], dispositif: ['titre', 'summary_falc'] };
// R33: the search result cards carry normalised names (title, description); the translation files keep the record's own field names
const ALIAS = { aide: { title: 'titre' }, demarche: { title: 'titre', description: 'description_courte' }, actualite: { title: 'titre', description: 'resume' }, guide: { title: 'titre' } };
const cache = new Map();

function load(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return cache.get(url);
}

/** for tests */
export function clearTranslationCache() { cache.clear(); }

export default function useContentTranslation(kind, record) {
  const { code } = useLanguage();
  const slug = record?.slug;
  const active = code !== SOURCE_LANGUAGE && TRANSLATED.has(kind) && typeof slug === 'string' && slug.length > 0;
  const [batch, setBatch] = useState(/** @type {any} */ (null));
  const [full, setFull] = useState(/** @type {any} */ (null));
  const [showOriginal, setShowOriginal] = useState(false);
  const needFull = useRef(false);

  useEffect(() => {
    setBatch(null); setFull(null); setShowOriginal(false); needFull.current = false;
    if (!active) return undefined;
    let alive = true;
    load(`/api/translations/${kind}?lang=${code}`).then((d) => { if (alive) setBatch(d?.items?.[slug] || { status: 'unavailable', fields: {} }); });
    return () => { alive = false; };
  }, [active, kind, slug, code]);

  // the page asked for a field beyond title/summary (a detail page): load the record's full translation once
  useEffect(() => {
    if (!active || full || !needFull.current) return undefined;
    let alive = true;
    load(`/api/translations/${kind}/${encodeURIComponent(slug)}?lang=${code}`).then((d) => { if (alive) setFull(d || { status: 'unavailable', fields: {}, fieldStatus: {} }); });
    return () => { alive = false; };
  });

  return useMemo(() => {
    if (!active) return sourceView(kind, record, code);
    const data = full || batch;
    const fields = showOriginal ? {} : (data?.fields || {});
    const here = { lang: code, dir: /** @type {'ltr'|'rtl'} */ (languageOf(code)?.dir || 'ltr') };
    const fr = { lang: SOURCE_LANGUAGE, dir: /** @type {'ltr'} */ ('ltr') };
    const summary = SUMMARY[kind] || [];
    const key = (/** @type {string} */ f) => ALIAS[kind]?.[f] || f;
    const translated = (/** @type {string} */ f) => Object.prototype.hasOwnProperty.call(fields, key(f));
    return {
      kind,
      language: code,
      status: data ? data.status : 'loading',
      fields,
      fieldStatus: full?.fieldStatus || {},
      meta: full ? { engine: full.engine, translatedAt: full.translatedAt, review: full.review, source: full.source } : null,
      showOriginal,
      setShowOriginal,
      value: (/** @type {string} */ f) => {
        if (!summary.includes(key(f))) needFull.current = true;
        if (!translated(f)) return record?.[f];
        const v = fields[key(f)]; const orig = record?.[f];
        return typeof orig === 'string' && typeof v !== 'string' ? JSON.stringify(v) : v;   // a field stored as JSON text stays text
      },
      attrs: (/** @type {string} */ f) => (translated(f) ? here : fr),
      original: (/** @type {string} */ f) => record?.[f],
    };
  }, [active, kind, record, code, batch, full, showOriginal]);
}

/** the French view of a record, used whenever no translation may be shown @param {string} kind @param {any} record @param {string} code */
export function sourceView(kind, record, code) {
  const isSource = code === SOURCE_LANGUAGE;
  const fr = { lang: SOURCE_LANGUAGE, dir: /** @type {'ltr'} */ ('ltr') };
  const here = { lang: code, dir: /** @type {'ltr'|'rtl'} */ (languageOf(code)?.dir || 'ltr') };
  return {
    kind,
    language: code,
    status: isSource ? 'source' : 'unavailable',
    fields: /** @type {Record<string, any>} */ ({}),
    fieldStatus: {},
    meta: null,
    showOriginal: false,
    setShowOriginal: () => {},
    value: (/** @type {string} */ field) => record?.[field],
    attrs: (/** @type {string} */ _field) => (isSource ? here : fr),
    original: (/** @type {string} */ field) => record?.[field],
  };
}
