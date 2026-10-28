import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

// Mock the Drizzle db module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockThen = vi.fn();

vi.mock('../src/db/index.js', () => ({
    db: {
        select: (...args) => {
            mockSelect(...args);
            return {
                from: (...a) => {
                    mockFrom(...a);
                    return {
                        where: (...w) => {
                            mockWhere(...w);
                            return {
                                limit: (...l) => {
                                    mockLimit(...l);
                                    return {
                                        then: (cb) => mockThen().then(cb),
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    },
}));

import { generateUniqueSlug, ensureSlug } from '../api/lib/slug.js';

beforeEach(() => {
    vi.clearAllMocks();
    // Default: no collision (no existing row found)
    mockThen.mockResolvedValue([]);
});

describe('generateUniqueSlug', () => {
    test('should generate a simple slug from title', async () => {
        const slug = await generateUniqueSlug('aide', 'Ma  Super   Aide  ');
        expect(slug).toBe('ma-super-aide');
    });

    test('should handle accents and special characters', async () => {
        const slug = await generateUniqueSlug('aide', "L'été à Noël : ça coûte cher !");
        expect(slug).toBe('l-ete-a-noel-ca-coute-cher');
    });

    test('should handle collisions by adding a suffix', async () => {
        // First call returns existing item, second call returns null (unique)
        mockThen
            .mockResolvedValueOnce([{ id: 'existing-id' }])
            .mockResolvedValueOnce([]);

        const slug = await generateUniqueSlug('aide', 'Collision');
        expect(slug).toBe('collision-1');
    });

    test('should truncate overly long titles', async () => {
        const longTitle = 'a'.repeat(300);
        const slug = await generateUniqueSlug('aide', longTitle);
        expect(slug.length).toBeLessThanOrEqual(200);
    });

    test('should return "item" fallback for empty resulting slug', async () => {
        const slug = await generateUniqueSlug('aide', '???');
        expect(slug).toBe('item');
    });

    test('should throw on unknown model', async () => {
        await expect(generateUniqueSlug('unknown', 'test')).rejects.toThrow('Unknown model');
    });
});

describe('ensureSlug', () => {
    test('should return existing slug if present', async () => {
        const item = { id: '1', slug: 'existing-slug', titre: 'Ignore Me' };
        const result = await ensureSlug('aide', item);
        expect(result).toBe('existing-slug');
    });

    test('should generate new slug if missing', async () => {
        const item = { id: '1', slug: null, titre: 'New Item' };
        const result = await ensureSlug('aide', item);
        expect(result).toBe('new-item');
    });
});
