import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect, beforeEach } from 'vitest';
import { runIngestAids } from '../../api/_handlers/cron/ingest-aids.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

// Mock Prisma
vi.mock('../../api/_utils/prisma.js', () => ({
    default: {
        aide: {
            deleteMany: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            count: vi.fn()
        },
        importLog: {
            create: vi.fn()
        },
        sourceDocument: {
            findFirst: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'source-doc-test' }),
            update: vi.fn().mockResolvedValue({ id: 'source-doc-test' })
        }
    }
}));

// Mock Fetch
global.fetch = vi.fn();

// Mock Logger to avoid clutter
vi.mock('../../api/lib/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe.skip('Ingestion Pipeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should crawl and process items', async () => {
        // 1. Mock Grand Est Listing
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => `<html><a href="https://www.grandest.fr/vos-aides-regionales/test">Aide Test</a></html>`
        });

        // 2. Mock Grand Est Detail
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => `<html><h1>Titre Grand Est</h1><p>Contenu</p></html>`
        });

        // 3. Mock Agefiph Listing (updated to match new URL pattern)
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => `<html><a href="/aides-financieres/aide-test">Aide Agefiph</a></html>`
        });

        // 4. Mock Agefiph Detail
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => `<html><h1>Titre Agefiph</h1><p>Contenu</p></html>`
        });

        // 5. Mock Aides Territoires Auth (connexion endpoint)
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Unauthorized',
        });

        // DREES connector loads from JSON file — 32 static items, no fetch calls.
        // AT will fail auth (no API key in test) → 0 AT aides.
        // Total expected creates: 1 (GrandEst) + 1 (Agefiph) + 0 (AT, auth fail) + 32 (DREES) = 34

        const stats = await runIngestAids({ limit: 100, runId: 'test', wipe: true });

        const prisma = (await import('../../api/_utils/prisma.js')).default;
        expect(prisma.aide.deleteMany).toHaveBeenCalled(); // Wipe called
        expect(prisma.aide.create).toHaveBeenCalledTimes(34); // 34 items created
        expect(stats.created).toBe(34);
    });
});
