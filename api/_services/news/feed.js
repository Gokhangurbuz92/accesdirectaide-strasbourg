/**
 * Actualités v2 — the public feed built from published rows: rights per source (fail-closed), geography and categories (editorial.js), one card per
 * story with its other reports as « Sources et couverture », filters (place, category, source, dates, search), newest/relevant sorting, the
 * configurable France/Monde balance and the counts shown next to each filter. Pure: the rows and the source registry are passed in.
 *
 * What a visitor receives depends on the SOURCE's rights, never on a guess: lane A (licence or permission evidenced for the full text) — the item as
 * published; lane B (link only) — publisher, date and link, never the publisher's words or images; blocked/unknown — nothing. ADA's own articles
 * (« ada_original ») were approved by a person in the editorial workflow (news-editorial.js) and carry their sources and corrections.
 */
import fs from 'node:fs';
import path from 'node:path';
import { balanceFeed, classifyGeo, classifyTopics, clusterStories, fold, sourceRights } from './editorial.js';

/** @typedef {{ id: string, name: string, publisher?: string, hosts?: string[], domain?: string, status?: string, rights?: Record<string, boolean>, evidenceUrl?: string, verifiedAt?: string, licence?: string, licenceUrl?: string, scope?: string, territory?: string, country?: string, language?: string, enabled?: boolean }} RegistrySource */

/** the registry: data/news-sources.json (the same manifest the ingestion reads), by host @param {RegistrySource[]} [list] */
export function loadRegistry(list) {
  let sources = list;
  if (!sources) { try { sources = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'news-sources.json'), 'utf8')); } catch { sources = []; } }
  /** @type {Map<string, RegistrySource>} */ const byHost = new Map();
  for (const s of sources || []) {
    const hosts = Array.isArray(s.hosts) && s.hosts.length ? s.hosts : (s.domain ? [s.domain, `www.${s.domain}`] : []);
    for (const h of hosts) if (!byHost.has(String(h).toLowerCase())) byHost.set(String(h).toLowerCase(), s);
  }
  return { sources: sources || [], byHost, of: (/** @type {string | null | undefined} */ url) => { try { return byHost.get(new URL(String(url)).hostname.toLowerCase()) || null; } catch { return null; } } };
}

const SAFE_IMG = /^https:\/\/[^\s"'<>]+$/i;
/** only an image whose rights are recorded on the item (ADA articles, licensed images); never a publisher's Open Graph picture taken from the page */
/** @param {any} row @param {{ allow: Record<string, boolean> }} rights */
function imageOf(row, rights) {
  const meta = row?.raw_payload_json?.ada?.image;
  if (meta && SAFE_IMG.test(String(meta.url || '')) && meta.licence && meta.credit && meta.alt) {
    return { url: meta.url, alt: String(meta.alt).slice(0, 300), credit: String(meta.credit).slice(0, 200), licence: String(meta.licence).slice(0, 120),
      licenceUrl: SAFE_IMG.test(String(meta.licenceUrl || '')) ? meta.licenceUrl : null, kind: ['licensed', 'commons', 'ai'].includes(meta.kind) ? meta.kind : 'licensed',
      aiGenerated: meta.kind === 'ai' };
  }
  if (rights.allow.images && row.image_url && SAFE_IMG.test(row.image_url)) return { url: row.image_url, alt: '', credit: null, licence: null, licenceUrl: null, kind: 'source', aiGenerated: false };
  return null;   // the page shows the category illustration (an original ADA drawing)
}

/** ADA's own article: its sources and corrections, as a person approved them (news-editorial.js); anything malformed is dropped */
/** @param {any} row */
function adaMeta(row) {
  const a = row?.raw_payload_json?.ada || {};
  const link = (/** @type {unknown} */ u) => (/^https:\/\//.test(String(u || '')) ? String(u) : null);
  return {
    sources: (Array.isArray(a.sources) ? a.sources : []).map((/** @type {any} */ s) => ({ publisher: String(s?.publisher || '').slice(0, 120), url: link(s?.url), note: String(s?.note || '').slice(0, 300) })).filter((/** @type {any} */ s) => s.publisher && s.url),
    corrections: (Array.isArray(a.corrections) ? a.corrections : []).map((/** @type {any} */ c) => ({ at: c?.at || null, kind: c?.kind === 'update' ? 'update' : 'correction', note: String(c?.note || '').slice(0, 500) })).filter((/** @type {any} */ c) => c.at && c.note),
    reviewedAt: a.editorial?.approvedAt || null,
    factLabels: a.factLabels && typeof a.factLabels === 'object' ? a.factLabels : null,
  };
}

const hostOf = (/** @type {unknown} */ u) => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; } };

/**
 * One published row as a visitor may see it. @param {any} row @param {ReturnType<typeof loadRegistry>} registry @param {Date} now
 * @returns {any | null} null when the source's rights do not allow it to be shown
 */
export function enrichItem(row, registry, now = new Date(), { internal = false } = {}) {
  const url = row.canonical_url || row.lien_url || row.url || row.source_url || null;
  const isAda = row.type_actu === 'ada_original';
  const src = isAda ? null : registry.of(url);
  const rights = isAda ? { lane: 'ADA', allow: { headline: true, excerpt: true, fullText: true, images: true }, reason: null } : sourceRights(src, now);
  if (rights.lane === 'BLOCKED') return null;
  const geo = classifyGeo(row, src);
  const topics = classifyTopics(row, geo);
  if (row.est_important) topics.unshift('une');
  const base = {
    id: row.id, slug: row.slug, date_publication: row.date_publication, updatedAt: row.updatedAt, published_at: row.published_at,
    lane: rights.lane, geo, topics: [...new Set(topics)], est_important: Boolean(row.est_important),
    publisher: isAda ? 'AccesDirectAide' : (src?.publisher || src?.name || hostOf(url).replace(/^www\./, '')),
    sourceUrl: url, licence: isAda ? null : (src?.licence || null), licenceUrl: isAda ? null : (src?.licenceUrl || null), rightsEvidenceUrl: isAda ? null : (src?.evidenceUrl || null),
    language: src?.language || 'fr',
    ...(internal ? { _t: String(row.titre || '') } : {}),   // internal only (feed grouping): never part of a returned item
  };
  if (rights.lane === 'B') {
    // link only: the publisher's title, words and images are not shown; the card says where to read it
    return { ...base, titre: null, resume: null, image: null, externalOnly: true };
  }
  return { ...base, titre: row.titre, resume: row.resume ?? null, summary_falc: row.summary_falc ?? null, contenu: rights.allow.fullText ? (row.contenu ?? null) : null,
    image: imageOf(row, rights), externalOnly: false, ada: isAda ? adaMeta(row) : null, auto_publish: Boolean(row.auto_publish) };
}

/** a search score: EVERY word of the query must appear (title or summary); each word in the title counts 3, in the summary 1; 0 = no match */
/** @param {any} card @param {string} q */
function score(card, q) {
  const words = fold(q).split(' ').filter((w) => w.length > 1); if (!words.length) return 0;
  const t = fold(card.titre); const r = fold(card.resume);
  if (!words.every((w) => t.includes(w) || r.includes(w))) return 0;
  return words.reduce((s, w) => s + (t.includes(w) ? 3 : 0) + (r.includes(w) ? 1 : 0), 0);
}

/**
 * @param {any[]} rows published rows, any order @param {{ geo?: string, topic?: string, source?: string, q?: string, from?: string, to?: string,
 *   sort?: 'recent' | 'relevant', group?: boolean, balance?: boolean, franceShare?: number, page?: number, pageSize?: number }} p
 * @param {ReturnType<typeof loadRegistry>} registry @param {Date} [now]
 */
export function buildNewsFeed(rows, p, registry, now = new Date()) {
  let cards = rows.map((r) => enrichItem(r, registry, now, { internal: true })).filter(Boolean);
  // lane B items exist only as coverage of a story told by a licensed or ADA report (a card with no words of its own is no article)
  const fromTs = p.from ? Date.parse(`${p.from}T00:00:00Z`) : null; const toTs = p.to ? Date.parse(`${p.to}T23:59:59Z`) : null;
  const inDates = (/** @type {any} */ c) => { const t = new Date(c.date_publication).getTime(); return (fromTs === null || t >= fromTs) && (toTs === null || t <= toTs); };
  const inGeo = (/** @type {any} */ c) => !p.geo || (p.geo === 'france' ? c.geo.scope !== 'monde' : c.geo.scope === p.geo);
  const inSource = (/** @type {any} */ c) => !p.source || fold(c.publisher).includes(fold(p.source));
  cards = cards.filter((c) => inDates(c) && inGeo(c) && inSource(c));
  cards.sort((a, b) => new Date(b.date_publication).getTime() - new Date(a.date_publication).getTime() || String(b.id).localeCompare(String(a.id)));
  const stories = p.group === false ? cards.map((c) => ({ key: `story:${c.id}`, lead: c, members: [c] }))
    : clusterStories(cards.map((c) => ({ ...c, titre: c._t })), {});
  const strip = (/** @type {any} */ o) => { const { _t, ...rest } = o; return rest; };
  /** @type {any[]} */
  let out = stories.filter((s) => !s.lead.externalOnly).map((s) => ({
    ...strip(s.lead), storyKey: s.key,   // leads are lane A or ADA only (filtered above): their internal title is their public title
    coverage: s.members.filter((m) => m.id !== s.lead.id).map((m) => ({ publisher: m.publisher, url: m.sourceUrl, date: m.date_publication, lane: m.lane })),
  }));
  // facets before the category filter (so every category shows how many it would give)
  /** @type {{ topics: Record<string, number>, geo: Record<string, number>, sources: Record<string, number> }} */
  const facets = { topics: {}, geo: { france: 0, monde: 0, alsace: 0 }, sources: {} };
  for (const c of out) {
    for (const t of c.topics) facets.topics[t] = (facets.topics[t] || 0) + 1;
    facets.geo[c.geo.scope === 'monde' ? 'monde' : 'france'] += 1; if (c.geo.scope === 'alsace') facets.geo.alsace += 1;
    facets.sources[c.publisher] = (facets.sources[c.publisher] || 0) + 1;
  }
  if (p.topic) out = out.filter((c) => c.topics.includes(p.topic));
  if (p.q) { const q = p.q; out = out.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => (p.sort === 'recent' ? 0 : b.s - a.s)).map((x) => x.c); }
  if (!p.geo && !p.topic && !p.q && p.balance !== false && (p.sort || 'recent') === 'recent') out = balanceFeed(out, { franceShare: p.franceShare ?? 0.7 });
  const pageSize = Math.min(50, Math.max(1, p.pageSize || 12)); const page = Math.max(1, p.page || 1);
  return { items: out.slice((page - 1) * pageSize, page * pageSize), total: out.length, page, pageSize, facets };
}

/** related stories for an article: same category and place first, newest first, never the article itself */
/** @param {any} card @param {any[]} others @param {number} [limit] @returns {any[]} */
export function relatedTo(card, others, limit = 4) {
  return others.filter((/** @type {any} */ o) => o.id !== card.id && o.storyKey !== card.storyKey)
    .map((/** @type {any} */ o) => ({ o, s: o.topics.filter((/** @type {string} */ t) => card.topics.includes(t) && t !== 'une').length * 2 + (o.geo.scope === card.geo.scope ? 1 : 0) }))
    .filter((/** @type {any} */ x) => x.s > 0).sort((/** @type {any} */ a, /** @type {any} */ b) => b.s - a.s || new Date(b.o.date_publication).getTime() - new Date(a.o.date_publication).getTime()).slice(0, limit).map((/** @type {any} */ x) => x.o);
}
