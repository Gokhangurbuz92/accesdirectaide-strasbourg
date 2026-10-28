import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'mock-url');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.mock('@vercel/kv', () => ({
  createClient: vi.fn(),
  kv: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
  }
}));

import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql, and } from 'drizzle-orm';
import crypto from 'crypto';
import { scanDataQuality } from '../../api/_utils/dataQuality.js';
import { upsertActualiteFromFeedItem } from '../../api/_handlers/cron/ingest-actualites-rss.js';
import { ensureSlugOrNull } from '../../api/_utils/slug.js';

/** @type {{ actualiteIds: string[], aideIds: string[], demarcheIds: string[], sourceDocumentIds: string[] }} */
const created = {
  actualiteIds: [],
  aideIds: [],
  demarcheIds: [],
  sourceDocumentIds: [],
};

afterEach(async () => {
  const entityIds = [...created.actualiteIds, ...created.aideIds, ...created.demarcheIds];
  if (entityIds.length > 0) {
    await await db.delete(schema.ReviewQueueItem);
  }

  if (created.actualiteIds.length > 0) {
    await await db.delete(schema.Actualite);
  }
  if (created.aideIds.length > 0) {
    await await db.delete(schema.Aide);
  }
  if (created.demarcheIds.length > 0) {
    await await db.delete(schema.Demarche);
  }
  if (created.sourceDocumentIds.length > 0) {
    await await db.delete(schema.SourceDocument);
  }

  created.actualiteIds = [];
  created.aideIds = [];
  created.demarcheIds = [];
  created.sourceDocumentIds = [];
});

describe('P8-D ingestion hardening contracts', () => {
  it('is idempotent on rerun, links SourceDocument, and skips unchanged payloads', async () => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const canonicalUrl = `https://example.org/p8d/${uniqueSuffix}`;

    const source = { id: `src-${uniqueSuffix}`, name: 'P8D Source' };
    const item = {
      title: 'Aide Étudiant Strasbourg',
      link: canonicalUrl,
      contentSnippet: 'Résumé stable',
      content: 'Contenu stable',
      isoDate: '2026-02-01T10:00:00.000Z',
      guid: canonicalUrl,
    };

    const first = await upsertActualiteFromFeedItem({
      db,
      source,
      feedUrl: 'https://example.org/rss.xml',
      category: 'general',
      territory: 'FRANCE',
      item,
      runId: `run-${uniqueSuffix}`,
      isOfficial: true,
    });

    expect(first.action).toBe('created');

    const createdActualite = await db.query.Actualite.findFirst({
      where: eq(schema.Actualite.canonical_url, canonicalUrl),
      columns: { id: true, updatedAt: true, source_document_id: true }
    });
    expect(createdActualite?.id).toBeTruthy();
    expect(createdActualite?.source_document_id).toBeTruthy();

    created.actualiteIds.push(createdActualite.id);
    created.sourceDocumentIds.push(String(createdActualite.source_document_id));

    const linkedSource = await db.query.SourceDocument.findFirst({
      where: eq(schema.SourceDocument.id, String(createdActualite.source_document_id)),
      columns: { source_url: true, content_hash: true }
    });
    expect(linkedSource?.source_url).toBe(canonicalUrl);
    expect(typeof linkedSource?.content_hash).toBe('string');

    const second = await upsertActualiteFromFeedItem({
      db,
      source,
      feedUrl: 'https://example.org/rss.xml',
      category: 'general',
      territory: 'FRANCE',
      item,
      runId: `run-${uniqueSuffix}-2`,
      isOfficial: true,
    });

    expect(second.action).toBe('skipped');

    const afterSecondRun = await db.query.Actualite.findFirst({
      where: eq(schema.Actualite.canonical_url, canonicalUrl),
      columns: { id: true, updatedAt: true }
    });

    expect(afterSecondRun?.id).toBe(createdActualite.id);
    expect(afterSecondRun?.updatedAt.getTime()).toBe(createdActualite.updatedAt.getTime());

    const duplicateCount = Number(await (await db.select({ count: sql`count(*)` }).from(schema.Actualite))[0].count);
    expect(duplicateCount).toBe(1);
  });

  it('normalizes slugs and maps invalid slugs to null', async () => {
    expect(ensureSlugOrNull('  Àide Été 2026 !!! ')).toBe('aide-ete-2026');
    expect(ensureSlugOrNull('###')).toBeNull();
  });

  it('feeds review queue for missing slug, missing source document and missing source URL', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const aideMissingSlug = await (await db.insert(schema.Aide).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        titre: `P8D aide missing slug ${suffix}`,
        slug: ensureSlugOrNull('###'),
        territoires: ['FRANCE'],
        situations_vie: ['test'],
        departements: ['75'],
        documents_necessaires: ['piece-identite'],
        date_verification: new Date(),
        statut: 'publie',
        is_pro_enabled: false,
        categoryId: null,
      }).returning({ id: schema.Aide.id }))[0];
    created.aideIds.push(aideMissingSlug.id);

    const sourceWithoutUrl = await (await db.insert(schema.SourceDocument).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        source_url: null,
        content_hash: `p8d-${suffix}`,
        metadata: {},
      }).returning({ id: schema.SourceDocument.id }))[0];
    created.sourceDocumentIds.push(sourceWithoutUrl.id);

    const demarcheWithBrokenSource = await (await db.insert(schema.Demarche).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        titre: `P8D demarche source url ${suffix}`,
        slug: `p8d-demarche-${suffix}`,
        date_verification: new Date(),
        documents_necessaires: ['piece-identite'],
        statut: 'publie',
        source_document_id: sourceWithoutUrl.id,
      }).returning({ id: schema.Demarche.id }))[0];
    created.demarcheIds.push(demarcheWithBrokenSource.id);

    const summary = await scanDataQuality({
      db,
      limitPerType: 1000,
    });
    expect(summary.openTotal).toBeGreaterThan(0);

    const aideOpenItems = await db.select({ reason: schema.ReviewQueueItem.reason }).from(schema.ReviewQueueItem).where(
      and(
        eq(schema.ReviewQueueItem.entityType, 'AIDE'),
        eq(schema.ReviewQueueItem.entityId, aideMissingSlug.id),
        eq(schema.ReviewQueueItem.status, 'OPEN')
      )
    );
    const aideReasons = new Set(aideOpenItems.map((item) => item.reason));
    expect(aideReasons.has('MISSING_SLUG')).toBe(true);
    expect(aideReasons.has('MISSING_SOURCE_DOCUMENT')).toBe(true);

    const demarcheOpenItems = await db.select({ reason: schema.ReviewQueueItem.reason }).from(schema.ReviewQueueItem).where(
      and(
        eq(schema.ReviewQueueItem.entityType, 'DEMARCHE'),
        eq(schema.ReviewQueueItem.entityId, demarcheWithBrokenSource.id),
        eq(schema.ReviewQueueItem.status, 'OPEN')
      )
    );
    const demarcheReasons = new Set(demarcheOpenItems.map((item) => item.reason));
    expect(demarcheReasons.has('MISSING_SOURCE_URL')).toBe(true);
  });
});
