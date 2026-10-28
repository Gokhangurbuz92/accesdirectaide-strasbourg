// @ts-nocheck
/**
 * Automatic verification chain — reading an official page (service-public.gouv.fr procedure sheets first; any page of the allow-list as a fallback).
 *
 * The reader keeps only the substance: the main article, cut into chapters (its headings), without menus, sharing dialogs, scripts or the « Vérifié le »
 * line. Its fingerprint (sha-256 of the normalized chapters) changes only when the content does, so a new fingerprint means « the source changed ». The key
 * facts (amounts in euros, percentages, ages, durations, dates) are extracted so a change can be named (« le montant est passé de … à … »), and the official
 * « Vérifié le … » date of Service-Public is kept as evidence of the source's own freshness.
 */
import { createHash } from 'node:crypto';
import { officialGet } from './fetcher.js';

const MONTHS = { janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12 };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', euro: '€', hellip: '…', ndash: '–', mdash: '—' };

export const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const textOf = (fragment) => decode(String(fragment || '').replace(/<(script|style|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|tr|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** « 01 juillet 2026 » → « 2026-07-01 » */
export function frenchDate(s) {
  const m = String(s || '').toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Amounts, percentages, ages, durations and dates found in a text — what a change of conditions usually touches. @param {string} text */
export function keyFacts(text) {
  const t = String(text || '');
  const pick = (re) => [...new Set([...t.matchAll(re)].map((m) => m[0].replace(/\s+/g, ' ').trim()))];
  return {
    amounts: pick(/\d{1,3}(?:[ \u00a0\u202f.]\d{3})*(?:,\d{1,2})?\s?(?:€|euros?)/gi).slice(0, 60),
    percentages: pick(/\d{1,3}(?:,\d{1,2})?\s?%/g).slice(0, 40),
    ages: pick(/\b(?:moins|plus) de \d{1,2} ans\b|\b\d{1,2} ans (?:ou plus|et plus|au moins)\b/gi).slice(0, 30),
    durations: pick(/\b\d{1,3} (?:jours?|mois|semaines?|ans)\b/gi).slice(0, 40),
    dates: pick(/\b\d{1,2}(?:er)? (?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre) \d{4}\b/gi).slice(0, 30),
  };
}

/**
 * Parse an official page. Service-Public sheets: chapters of the main article; other sites: the <main> (or <article>, or <body>) text as one chapter.
 * @param {string} html @param {string} url
 */
export function parseOfficialPage(html, url = '') {
  const h = String(html || '');
  const title = textOf((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || (h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').split('|')[0].trim() || null;
  const verified = frenchDate((decode(h).match(/V[ée]rifi[ée] le\s*([0-9]{1,2}(?:er)?\s+[a-zéû]+\s+[0-9]{4})/i) || [])[1]);
  const scope = (h.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || h.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || h.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [null, h])[1]
    .replace(/<(nav|header|footer|form|dialog|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const parts = scope.split(/(?=<h[2-4][^>]*>)/i);
  const chapters = [];
  for (const part of parts) {
    const heading = textOf((part.match(/^<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i) || [])[1] || '') || null;
    const body = textOf(part.replace(/^<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>/i, ''))
      .split('\n').filter((l) => !/^v[ée]rifi[ée] le\b/i.test(l) && !/^(partager|imprimer|copier le lien|cette page vous a-t-elle été utile)/i.test(l)).join('\n').trim();
    if (heading && /lien vers cette page a été envoyé|partager la page|vous a-t-elle été utile/i.test(heading)) continue;   // sharing / feedback dialogs, not content
    if (body.length >= 20 || (heading && body)) chapters.push({ heading, text: body });
  }
  const fullText = chapters.map((c) => `${c.heading ? `## ${c.heading}\n` : ''}${c.text}`).join('\n\n');
  return { url, title, officialCheckedAt: verified, chapters, text: fullText, fingerprint: sha256(normalize(fullText)), facts: keyFacts(fullText), chars: fullText.length };
}

/**
 * Fetch and read an official page. { exists: false } for 404 / 410 (the page was removed); throws SourceError for network refusals (« non consultée »).
 * @param {string} url @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 */
export async function readOfficialPage(url, opts = {}) {
  const r = await officialGet(url, opts);
  if (r.status === 404 || r.status === 410) return { exists: false, status: r.status, url: r.url, fetchedAt: r.fetchedAt };
  if (r.status !== 200) return { exists: null, status: r.status, url: r.url, fetchedAt: r.fetchedAt };
  const page = parseOfficialPage(r.text, r.url);
  // a page that answers 200 but says it does not exist any more
  const gone = /page (?:introuvable|non trouvée)|cette page n.existe (?:pas|plus)|erreur 404/i.test(`${page.title || ''} ${page.text.slice(0, 400)}`);
  return { exists: !gone, status: r.status, fetchedAt: r.fetchedAt, ...page };
}

/**
 * What changed between two readings of a page: fingerprint, chapters added / removed / modified, facts that appeared or disappeared.
 * @param {{ fingerprint: string, chapters: { heading: string | null, text: string }[], facts: Record<string, string[]> } | null} before
 * @param {{ fingerprint: string, chapters: { heading: string | null, text: string }[], facts: Record<string, string[]> }} after
 */
export function comparePages(before, after) {
  if (!before) return { changed: false, firstReading: true, chapters: [], facts: {} };
  if (before.fingerprint === after.fingerprint) return { changed: false, chapters: [], facts: {} };
  const key = (c) => normalize(c.heading || '(intro)');
  const b = new Map(before.chapters.map((c) => [key(c), sha256(normalize(c.text))]));
  const a = new Map(after.chapters.map((c) => [key(c), sha256(normalize(c.text))]));
  const chapters = [];
  for (const [k, v] of a) if (!b.has(k)) chapters.push({ heading: k, change: 'added' }); else if (b.get(k) !== v) chapters.push({ heading: k, change: 'modified' });
  for (const k of b.keys()) if (!a.has(k)) chapters.push({ heading: k, change: 'removed' });
  const facts = {};
  for (const kind of Object.keys(after.facts || {})) {
    const was = new Set(before.facts?.[kind] || []); const now = new Set(after.facts[kind] || []);
    const added = [...now].filter((x) => !was.has(x)); const removed = [...was].filter((x) => !now.has(x));
    if (added.length || removed.length) facts[kind] = { added, removed };
  }
  return { changed: true, chapters, facts, conditionsTouched: Boolean(facts.amounts || facts.percentages || facts.ages) || chapters.some((c) => /condition|montant|calcul|bénéficier|qui peut|plafond/.test(c.heading)) };
}
