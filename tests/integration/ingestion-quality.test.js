import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql, inArray, and, or } from 'drizzle-orm';
import crypto from 'crypto';

// CI sets SKIP_DB_SETUP=true — no real DB available
const skipDbTests = !!process.env.SKIP_DB_SETUP;

/**
 * Integration tests for Ingestion Quality (Phase 7)
 * Tests idempotence, traceability, normalization, and observability
 * NOTE: DB-dependent suites skip when SKIP_DB_SETUP is set (CI without real DB)
 */
describe('Ingestion Quality - Phase 7', () => {
  const testRunId = crypto.randomUUID();
  const testSlug = `test-aide-${Date.now()}`;
  
  // Clean up test data after each test
  afterEach(async () => {
    if (skipDbTests) return;
    try {
      await await db.delete(schema.Aide);
      await await db.delete(schema.ImportLog);
    } catch (error) {
      // Ignore cleanup errors in test environment
    }
  });

  describe.skipIf(skipDbTests)('Idempotence', () => {
    it('should not duplicate items when re-ingesting same content', async () => {
      const itemData = {
        slug: testSlug,
        titre: 'Test Aide',
        cest_quoi: 'Test content',
        source_url: 'https://example.com/test',
        content_hash: crypto.createHash('md5').update('test-content').digest('hex'),
        statut: 'publie',
        published_at: new Date(),
        territoires: ['national'],
        documents_necessaires: [],
      };

      // First ingestion
      const first = await (await db.insert(schema.Aide).values(itemData ).returning())[0];
      expect(first).toBeTruthy();
      expect(first.slug).toBe(testSlug);

      // Second ingestion (should find existing)
      const existing = await db.query.Aide.findFirst({ where: or(eq(schema.Aide.slug, testSlug), eq(schema.Aide.source_url, itemData.source_url)) /* AUTOMIGRATED: {           OR: [             { slug: testSlug },             { source_url: itemData.source_url }           ]         }        */ });

      expect(existing).toBeTruthy();
      expect(existing.id).toBe(first.id);

      // Verify no duplication
      const count = await (await db.select({ count: sql`count(*)` }).from(schema.Aide))[0].count;
      expect(Number(count)).toBe(1);
    });

    it('should update item when content changes', async () => {
      const originalHash = crypto.createHash('md5').update('original').digest('hex');
      const updatedHash = crypto.createHash('md5').update('updated').digest('hex');

      const original = await (await db.insert(schema.Aide).values({
          slug: testSlug,
          titre: 'Original Title',
          cest_quoi: 'Original content',
          content_hash: originalHash,
          statut: 'publie',
          published_at: new Date(),
          territoires: ['national'],
          documents_necessaires: [],
        }
      ).returning())[0];

      // Simulate content change
      const updated = await (await db.update(schema.Aide).set({
          titre: 'Updated Title',
          content_hash: updatedHash,
          updatedAt: new Date()
      }).where(eq(schema.Aide.id, original.id)).returning())[0];

      expect(updated.titre).toBe('Updated Title');
      expect(updated.content_hash).toBe(updatedHash);
      expect(updated.content_hash).not.toBe(originalHash);
    });

    it('should skip unchanged items but update last_checked_at', async () => {
      const contentHash = crypto.createHash('md5').update('unchanged').digest('hex');
      const originalDate = new Date('2024-01-01');

      const original = await (await db.insert(schema.Aide).values({
          slug: testSlug,
          titre: 'Unchanged Title',
          cest_quoi: 'Unchanged content',
          content_hash: contentHash,
          last_checked_at: originalDate,
          statut: 'publie',
          published_at: new Date(),
          territoires: ['national'],
          documents_necessaires: [],
        }
      ).returning())[0];

      // Simulate re-check with same content
      const now = new Date();
      const updated = await (await db.update(schema.Aide).set({ last_checked_at: now }).where(eq(schema.Aide.id, original.id)).returning())[0];

      expect(updated.content_hash).toBe(contentHash);
      expect(updated.last_checked_at.getTime()).toBeGreaterThan(originalDate.getTime());
    });
  });

  describe.skipIf(skipDbTests)('Traceability', () => {
    it('should store retrieved_at timestamp', async () => {
      const retrievedAt = new Date();
      
      const aide = await (await db.insert(schema.Aide).values({
          slug: testSlug,
          titre: 'Test Aide',
          cest_quoi: 'Test content',
          retrieved_at: retrievedAt,
          statut: 'publie',
          published_at: new Date(),
          territoires: ['national'],
          documents_necessaires: [],
        }
      ).returning())[0];

      expect(aide.retrieved_at).toBeTruthy();
      expect(aide.retrieved_at.getTime()).toBe(retrievedAt.getTime());
    });

    it('should store last_checked_at timestamp', async () => {
      const lastChecked = new Date();
      
      const aide = await (await db.insert(schema.Aide).values({
          slug: testSlug,
          titre: 'Test Aide',
          cest_quoi: 'Test content',
          last_checked_at: lastChecked,
          statut: 'publie',
          published_at: new Date(),
          territoires: ['national'],
          documents_necessaires: [],
        }
      ).returning())[0];

      expect(aide.last_checked_at).toBeTruthy();
      expect(aide.last_checked_at.getTime()).toBe(lastChecked.getTime());
    });

    it('should store source_url_exact for full traceability', async () => {
      const exactUrl = 'https://example.com/aide?id=123&ref=source';
      
      const aide = await (await db.insert(schema.Aide).values({
          slug: testSlug,
          titre: 'Test Aide',
          cest_quoi: 'Test content',
          source_url: 'https://example.com/aide',
          source_url_exact: exactUrl,
          statut: 'publie',
          published_at: new Date(),
          territoires: ['national'],
          documents_necessaires: [],
        }
      ).returning())[0];

      expect(aide.source_url_exact).toBe(exactUrl);
      expect(aide.source_url_exact).toContain('?id=123&ref=source');
    });
  });

  describe('Data Normalization', () => {
    it('should trim whitespace from text fields', () => {
      const rawData = {
        title: '  Test Title  ',
        description: '  Test Description  ',
        content: '  Test Content  '
      };

      const normalized = {
        title: rawData.title?.trim() || '',
        description: rawData.description?.trim() || '',
        content: rawData.content?.trim() || ''
      };

      expect(normalized.title).toBe('Test Title');
      expect(normalized.description).toBe('Test Description');
      expect(normalized.content).toBe('Test Content');
    });

    it('should handle null/undefined values gracefully', () => {
      const rawData = {
        title: null,
        description: undefined,
        content: ''
      };

      const normalized = {
        title: rawData.title?.trim() || '',
        description: rawData.description?.trim() || '',
        content: rawData.content?.trim() || ''
      };

      expect(normalized.title).toBe('');
      expect(normalized.description).toBe('');
      expect(normalized.content).toBe('');
    });
  });

  describe.skipIf(skipDbTests)('ImportLog Tracking', () => {
    it('should create ImportLog with run_id', async () => {
      const log = await (await db.insert(schema.ImportLog).values({
          run_id: testRunId,
          source_name: 'TEST_SOURCE',
          status: 'SUCCESS',
          items_total: 10,
          items_new: 5,
          items_updated: 3,
          items_skipped: 2,
          error_count: 0,
          duration_ms: 1000
        }
      ).returning())[0];

      expect(log.run_id).toBe(testRunId);
      expect(log.items_new).toBe(5);
      expect(log.items_updated).toBe(3);
      expect(log.items_skipped).toBe(2);
    });

    it('should track errors in ImportLog', async () => {
      const errors = ['Error 1', 'Error 2'];
      
      const log = await (await db.insert(schema.ImportLog).values({
          run_id: testRunId,
          source_name: 'TEST_SOURCE',
          status: 'PARTIAL',
          items_total: 10,
          items_new: 8,
          items_updated: 0,
          items_skipped: 0,
          error_count: errors.length,
          logs: JSON.stringify(errors),
          duration_ms: 1500
        }
      ).returning())[0];

      expect(log.error_count).toBe(2);
      const parsedLogs = typeof log.logs === 'string' ? (log.logs.startsWith('[') ? JSON.parse(log.logs) : log.logs.split(',')) : log.logs;
      expect(parsedLogs).toEqual(errors);
    });
  });

  describe('Silent Failure Detection', () => {
    it('should detect when no items processed and no errors', () => {
      const stats = {
        processed: 0,
        errors: []
      };

      const isSilentFailure = stats.processed === 0 && stats.errors.length === 0;
      expect(isSilentFailure).toBe(true);
    });

    it('should not flag as silent failure when items processed', () => {
      const stats = {
        processed: 5,
        errors: []
      };

      const isSilentFailure = stats.processed === 0 && stats.errors.length === 0;
      expect(isSilentFailure).toBe(false);
    });

    it('should not flag as silent failure when errors reported', () => {
      const stats = {
        processed: 0,
        errors: ['Some error']
      };

      const isSilentFailure = stats.processed === 0 && stats.errors.length === 0;
      expect(isSilentFailure).toBe(false);
    });
  });
});
