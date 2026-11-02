import Parser from 'rss-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { db } from '../../../src/db/index.js';
import { Actualite, RssSource, SourceDocument } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../../_utils/env.js';
import { computeContentHash, computeRawContentHash } from '../../_utils/contentHash.js';
import { ensureSlugOrNull } from '../../_utils/slug.js';
import { upsertSourceDocument } from '../../_utils/sourceDocument.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_ITEMS_PER_SOURCE = 20;
const USER_AGENT = 'AccesDirectAideBot/1.0 (+https://www.accesdirectaide.fr)';

/**
 * @typedef {object} NewsSourceManifestItem
 * @property {string=} id
 * @property {string=} name
 * @property {string=} feedUrl
 * @property {string=} url
 * @property {string=} homepageUrl
 * @property {string=} domain
 * @property {string=} trustLevel
 * @property {string=} trust_level
 * @property {string=} category
 * @property {boolean=} enabled
 * @property {string=} language
 * @property {string=} territory
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}

/**
 * @param {string | null} raw
 * @returns {string | null}
 */
function guessDomain(raw) {
  if (!raw) return null;
  try {
    return new URL(raw).hostname || null;
  } catch {
    return null;
  }
}

/**
 * PKG-11 audit pass 2: an item without a (valid) date keeps the date it was first given — « now » on every run changed its hash each time, so an undated item
 * went back to review (« brouillon ») and got a new source document every six hours, and an undated official item's date kept moving.
 * @param {unknown} value
 * @param {Date | string | null} [known]
 * @returns {Date}
 */
function parsePublishedAt(value, known = null) {
  const raw = safeString(value);
  const d = raw ? new Date(raw) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  const k = known ? new Date(known) : null;
  return k && !Number.isNaN(k.getTime()) ? k : new Date();
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string,string> }} options
 */
async function fetchText(url, options = {}) {
  // R12 (P10): a feed is only read over https (an OFFICIAL source over http could be altered in transit)
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('feed is not an https address');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body ? `- ${body.substring(0, 120)}` : ''}`.trim());
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} baseSlug
 * @param {string} canonicalHash
 * @returns {string}
 */
function buildActualiteSlug(baseSlug, canonicalHash) {
  const root = ensureSlugOrNull(baseSlug) || 'actu';
  const slug = ensureSlugOrNull(`${root}-${canonicalHash.slice(0, 6)}`);
  return slug || `actu-${canonicalHash.slice(0, 6)}`;
}

/**
 * @param {{
 *   source: { id: string, name: string },
 *   feedUrl: string,
 *   category: string | null,
 *   territory: string | null,
 *   item: Record<string, unknown>,
 *   runId: string,
 *   isOfficial: boolean,
 * }} input
 * @returns {Promise<{ action: 'created' | 'updated' | 'skipped' }>}
 */
export async function upsertActualiteFromFeedItem(input) {
  const title = safeString(input.item?.title) || 'Sans titre';
  const canonicalUrl = safeString(input.item?.link) || safeString(input.item?.guid);
  if (!canonicalUrl) {
    throw new Error('missing item link/guid');
  }
  // PKG-11 audit: the link becomes an href on the public pages: only a web address is kept (a javascript: or data: link is refused)
  // R12 (P10): https only — an official item read or linked over plain http can be altered in transit
  if (!/^https:\/\//i.test(canonicalUrl)) {
    throw new Error('item link is not an https address');
  }

  const known = await db.query.Actualite.findFirst({ where: eq(Actualite.canonical_url, canonicalUrl), columns: { date_publication: true } });
  const publishedAt = parsePublishedAt(input.item?.isoDate || input.item?.pubDate, known?.date_publication || null);
  const now = new Date();

  const snippet =
    safeString(input.item?.contentSnippet) ||
    safeString(input.item?.summary) ||
    safeString(input.item?.content) ||
    null;
  const resume = snippet ? snippet.slice(0, 600) : null;
  const contenu = safeString(input.item?.content) || resume || null;

  const canonicalHash = computeRawContentHash(canonicalUrl);
  const computedSlug = buildActualiteSlug(title, canonicalHash);
  const entityPayloadHash = computeContentHash({
    title,
    resume,
    contenu,
    canonicalUrl,
    publishedAt: publishedAt.toISOString(),
    sourceId: input.source.id,
    sourceName: input.source.name,
    category: input.category || null,
    territory: input.territory || null,
  });

  let sourceDocumentId = null;
  const sourceDocument = await upsertSourceDocument({
    sourceUrl: canonicalUrl,
    rawContent: JSON.stringify({
      title,
      canonicalUrl,
      guid: safeString(input.item?.guid),
      snippet,
      contenu,
      publishedAt: publishedAt.toISOString(),
    }),
    metadata: {
      entityType: 'actualite',
      sourceName: input.source.name,
      sourceId: input.source.id,
      feedUrl: input.feedUrl,
      category: input.category,
      territory: input.territory,
    },
  });
  sourceDocumentId = sourceDocument.id;

  const existing = await db.query.Actualite.findFirst({
    where: eq(Actualite.canonical_url, canonicalUrl),
    columns: {
      id: true,
      slug: true,
      statut: true,
      raw_data_hash: true,
      source_document_id: true,
    },
  });

  const finalSlug = safeString(existing?.slug) || computedSlug;
  const unchanged =
    Boolean(existing) &&
    existing?.raw_data_hash === entityPayloadHash &&
    (existing?.source_document_id || null) === sourceDocumentId;

  if (unchanged || env.ingestion.dryRun) {
    return { action: 'skipped' };
  }

  // R29 (owner decision 31/10/2026): the ingestion itself never publishes. Every item is a draft; the automatic verification that follows
  // (api/_services/news-verification.js: reuse rights, audience, date, publisher's own words, duplicate, live original page) publishes the ones that pass
  const autoPublish = false;
  const publicationData = autoPublish
    ? {
        statut: 'publie',
        auto_publish: true,
        published_at: publishedAt,
      }
    : {};

  const insertData = {
    id: crypto.randomUUID(),
    createdAt: now,
    titre: title,
    slug: finalSlug,
    contenu,
    resume,
    canonical_url: canonicalUrl,
    lien_url: canonicalUrl,
    url: canonicalUrl,
    source_url: canonicalUrl,
    guid: safeString(input.item?.guid) || canonicalUrl,
    source_id: input.source.id,
    source_name: input.source.name,
    source_nom: input.source.name,
    fetched_at: now,
    date_publication: publishedAt,
    raw_data_hash: entityPayloadHash,
    dedupe_hash: canonicalHash,
    ingest_batch: input.runId,
    categorie: input.category || null,
    territoire: input.territory || null,
    type_actu: 'info',
    source_document_id: sourceDocumentId,
    ...publicationData,
    statut: autoPublish ? 'publie' : 'brouillon',
    auto_publish: autoPublish,
    published_at: autoPublish ? publishedAt : null,
    falc_status: 'pending',
    quality_score: input.isOfficial ? 60 : 40,
    score_fiabilite: input.isOfficial ? 95 : 40,
    tags: [],
    departements: [],
    key_points_falc: [],
    est_important: false,
    updatedAt: now,
  };

  // PKG-11 / P10: a refresh keeps the row's identity (id, slug; the table has no createdAt) and never overrides a human decision: a rejected or archived item stays so.
  // A changed item from a non-official source goes back to review ('brouillon'), as before; an official one stays published.
  const { id: _id, createdAt: _createdAt, slug: _slug, ...refresh } = insertData;
  const humanFinal = ['rejected', 'archive', 'archived'].includes(String(existing?.statut || ''));
  const { statut: _statut, auto_publish: _auto, published_at: _pub, ...refreshKeepingDecision } = refresh;
  // R28/R29: a refresh never overrides a rejection or an archiving. R34: an item reaches this point only when its source text CHANGED (an unchanged one is
  // skipped above), so a published item goes back to a draft and the automatic verification checks the new words again — before, the changed text stayed
  // published without any check (the verification had read the old words)
  const updateData = humanFinal ? refreshKeepingDecision : refresh;


  await db.insert(Actualite).values(insertData).onConflictDoUpdate({
    target: [Actualite.canonical_url],
    set: updateData,
  });

  return { action: existing ? 'updated' : 'created' };
}

/**
 * Load sources manifest from the repo, preferring `data/news-sources.json`.
 * Falls back to legacy `config/rss-sources.json`.
 *
 * @returns {{ sources: NewsSourceManifestItem[], categoryByFeedUrl: Map<string, string>, territoryByFeedUrl: Map<string, string> }}
 */
function loadSourcesManifest() {
  const candidates = [
    path.join(process.cwd(), 'data', 'news-sources.json'),
    path.join(process.cwd(), 'config', 'rss-sources.json'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const list = Array.isArray(raw) ? raw : [];
      const categoryByFeedUrl = new Map();
      const territoryByFeedUrl = new Map();

      for (const item of list) {
        const feedUrl = safeString(item?.feedUrl) || safeString(item?.url);
        if (!feedUrl) continue;
        const category = safeString(item?.category);
        const territory = safeString(item?.territory);
        if (category) categoryByFeedUrl.set(feedUrl, category);
        if (territory) territoryByFeedUrl.set(feedUrl, territory);
      }

      return { sources: list, categoryByFeedUrl, territoryByFeedUrl };
    } catch {
      // ignore malformed manifest
    }
  }

  return { sources: [], categoryByFeedUrl: new Map(), territoryByFeedUrl: new Map() };
}

/**
 * Pure ingestion logic for RSS/Atom Actualites.
 *
 * IMPORTANT: This function is used by the cron pipeline and by the local script.
 * It must not log secrets and must avoid throwing on single-item errors.
 *
 * @param {{ limit?: number, runId?: string }} params
 * @returns {Promise<{ fetched: number, processed: number, created: number, updated: number, skippedExisting: number, errors: string[], durationByStage: { fetchMs: number, processingMs: number } }>}
 */
export async function runIngestActualitesRss({ limit, runId } = {}) {
  /** @type {{ fetched: number, processed: number, created: number, updated: number, skippedExisting: number, errors: string[], durationByStage: { fetchMs: number, processingMs: number } }} */
  const stats = {
    fetched: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skippedExisting: 0,
    errors: [],
    durationByStage: {
      fetchMs: 0,
      processingMs: 0,
    },
  };

  const effectiveRunId = runId || crypto.randomUUID();
  const globalLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(Number(limit), env.ingestion.maxItemsPerRun))
    : env.ingestion.maxItemsPerRun;

  const { sources: manifestSources, categoryByFeedUrl, territoryByFeedUrl } = loadSourcesManifest();

  // Seed/refresh sources in DB so admin can manage them.
  for (const src of manifestSources) {
    const feedUrl = safeString(src?.feedUrl) || safeString(src?.url);
    if (!feedUrl) continue;

    const name = safeString(src?.name) || guessDomain(feedUrl) || 'RSS source';
    const domain = safeString(src?.domain) || guessDomain(feedUrl) || 'unknown';
    const trustLevel = safeString(src?.trustLevel) || safeString(src?.trust_level) || 'OFFICIAL';
    const enabled = typeof src?.enabled === 'boolean' ? src.enabled : true;

    try {
      await db.insert(RssSource).values({
        name,
        feed_url: feedUrl,
        domain,
        trust_level: trustLevel,
        enabled,
        error_count: 0,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [RssSource.feed_url],
        set: { name, domain, trust_level: trustLevel, enabled, updatedAt: new Date() },
      });
    } catch (e) {
      stats.errors.push(`${name}: seed failed - ${getErrorMessage(e)}`);
    }
  }

  /** @type {Array<{ id: string, name: string, feed_url: string, trust_level: string }>} */
  let dbSources = [];
  try {
    dbSources = await db.query.RssSource.findMany({
      where: eq(RssSource.enabled, true),
    });
  } catch (e) {
    stats.errors.push(`rssSource.findMany failed - ${getErrorMessage(e)}`);
    return stats;
  }

  const parser = new Parser();
  let processedCount = 0;

  for (const source of dbSources) {
    if (processedCount >= globalLimit) break;

    const feedUrl = safeString(source?.feed_url);
    if (!feedUrl) continue;

    const isOfficial = String(source?.trust_level || '').toUpperCase() === 'OFFICIAL';
    const category = categoryByFeedUrl.get(feedUrl) || null;
    const territory = territoryByFeedUrl.get(feedUrl) || null;

    /** @type {Array<Record<string, unknown>>} */
    let feedItems = [];

    try {
      const startFetch = Date.now();
      const xml = await fetchText(feedUrl);
      const feed = await parser.parseString(xml);
      stats.durationByStage.fetchMs += Date.now() - startFetch;

      const items = Array.isArray(feed?.items) ? feed.items : [];
      const remaining = Math.max(0, globalLimit - processedCount);
      const perSourceLimit = Math.min(DEFAULT_MAX_ITEMS_PER_SOURCE, remaining);
      feedItems = perSourceLimit ? items.slice(0, perSourceLimit) : [];

      stats.fetched += feedItems.length;
    } catch (e) {
      stats.errors.push(`${source.name}: fetch/parse failed - ${getErrorMessage(e)}`);
      continue;
    }

    const startProc = Date.now();
    for (const item of feedItems) {
      stats.processed += 1;

      try {
        const result = await upsertActualiteFromFeedItem({
          source: {
            id: source.id,
            name: source.name,
          },
          feedUrl,
          category,
          territory,
          item,
          runId: effectiveRunId,
          isOfficial,
        });

        if (result.action === 'updated') {
          stats.updated += 1;
        } else if (result.action === 'created') {
          stats.created += 1;
        } else {
          stats.skippedExisting += 1;
        }

        processedCount += 1;
      } catch (e) {
        stats.errors.push(`${source.name}: upsert failed - ${getErrorMessage(e)}`);
      }
    }
    stats.durationByStage.processingMs += Date.now() - startProc;
  }

  return stats;
}
