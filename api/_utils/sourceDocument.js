import { computeRawContentHash } from './contentHash.js';
import { env } from './env.js';
import { db } from '../../src/db/index.js';
import { SourceDocument } from '../../src/db/schema.js';
import { and, eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeShortString(value) {
  const normalized = safeString(value);
  if (!normalized) return null;
  return normalized.slice(0, 200);
}

/**
 * Create/update a traceability SourceDocument row and return its id.
 * Reuses the latest row when `(source_url, content_hash)` already exists.
 *
 * @param {{
 *   sourceUrl?: string | null,
 *   rawContent?: string | null,
 *   metadata?: Record<string, unknown> | null,
 * }} input
 * @returns {Promise<{ id: string | null, contentHash: string | null }>}
 */
export async function upsertSourceDocument(input) {
  const sourceUrl = safeString(input?.sourceUrl);
  const rawContent = safeString(input?.rawContent);

  if (!sourceUrl && !rawContent) {
    return { id: null, contentHash: null };
  }

  const contentHash = computeRawContentHash(rawContent || sourceUrl || '');
  const parserVersion = safeShortString(env.ingestion.parserVersion) || 'v1';

  const metadata = {
    parserVersion,
    ...(input?.metadata || {}),
  };

  const conditions = [eq(SourceDocument.content_hash, contentHash)];
  if (sourceUrl) conditions.push(eq(SourceDocument.source_url, sourceUrl));
  const whereFilter = and(...conditions);

  const existing = await db.query.SourceDocument.findFirst({
    where: whereFilter,
    orderBy: (sd, { desc }) => [desc(sd.fetched_at)],
    columns: { id: true },
  });

  if (existing) {
    await db.update(SourceDocument).set({
      fetched_at: new Date(),
      metadata,
    }).where(eq(SourceDocument.id, existing.id));
    return { id: existing.id, contentHash };
  }

  const [created] = await db.insert(SourceDocument).values({
    id: randomUUID(),
    source_url: sourceUrl,
    fetched_at: new Date(),
    content_hash: contentHash,
    raw_content: rawContent,
    metadata,
  }).returning({ id: SourceDocument.id });

  return { id: created.id, contentHash };
}
