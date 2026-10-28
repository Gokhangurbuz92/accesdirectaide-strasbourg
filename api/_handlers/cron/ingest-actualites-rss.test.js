import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    rssSourceUpsert: vi.fn().mockResolvedValue({}),
    rssSourceFindMany: vi.fn().mockResolvedValue([
      {
        id: 'src1',
        name: 'Test Source',
        feed_url: 'https://test.com/rss',
        trust_level: 'OFFICIAL',
        enabled: true,
      },
    ]),
    dbOnConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
    dbReturning: vi.fn().mockResolvedValue([{}]),
    fetch: vi.fn(),
    parseString: vi.fn(),
    dbValues: vi.fn(() => ({
      onConflictDoUpdate: mocks.dbOnConflictDoUpdate,
      returning: mocks.dbReturning,
    })),
    dbSet: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{}]),
    })),
    db: {
      query: {
        RssSource: {
          findMany: vi.fn().mockImplementation(async () => mocks.rssSourceFindMany()),
        },
        Actualite: {
          findFirst: vi.fn(),
        },
        SourceDocument: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    },
  };
});

const insertMock = vi.fn(() => ({ values: mocks.dbValues }));
const updateMock = vi.fn(() => ({ set: mocks.dbSet }));
const typedDb = /** @type {typeof mocks.db & { insert: typeof insertMock; update: typeof updateMock }} */ (mocks.db);
typedDb.insert = insertMock;
typedDb.update = updateMock;

vi.mock('../../../src/db/index.js', () => {
  return {
    db: mocks.db,
  };
});

vi.mock('rss-parser', () => {
  return {
    default: class {
      /** @param {string} xml */
      parseString(xml) {
        return mocks.parseString(xml);
      }
    },
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const mocked = {
    ...actual,
    existsSync: vi.fn((filePath) => String(filePath).includes(`${String(process.cwd())}/data/news-sources.json`)),
    readFileSync: vi.fn(() =>
      JSON.stringify([
        {
          id: 'enabled',
          name: 'Test Source',
          feedUrl: 'https://test.com/rss',
          domain: 'test.com',
          trustLevel: 'OFFICIAL',
          enabled: true,
          category: 'general',
          territory: 'FRANCE',
        },
        {
          id: 'disabled',
          name: 'Disabled Source',
          feedUrl: 'https://disabled.test/rss',
          domain: 'disabled.test',
          trustLevel: 'OFFICIAL',
          enabled: false,
          category: 'general',
          territory: 'FRANCE',
        },
      ]),
    ),
  };
  return { ...mocked, default: mocked };
});

describe('runIngestActualitesRss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    global.fetch = mocks.fetch;
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('<xml />'),
    });

    mocks.parseString.mockResolvedValue({
      items: [
        {
          title: 'Test News',
          link: 'https://test.com/news/1',
          contentSnippet: 'Summary',
          isoDate: '2026-01-01T00:00:00.000Z',
        },
        {
          title: 'Test News (duplicate link)',
          link: 'https://test.com/news/1',
          contentSnippet: 'Updated Summary',
          isoDate: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('does not ingest disabled sources from the manifest (seeding sets enabled=false)', async () => {
    const { runIngestActualitesRss } = await import('./ingest-actualites-rss.js');
    await runIngestActualitesRss({ limit: 5, runId: 'run-1' });

    expect(mocks.dbOnConflictDoUpdate).toHaveBeenCalled();
    expect(mocks.dbOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ enabled: false })
      })
    );
  });

  it('upserts by canonical_url and does not create duplicates', async () => {
    mocks.db.query.Actualite.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'a1', slug: 'keep-slug', statut: 'publie', published_at: null });

    const { runIngestActualitesRss } = await import('./ingest-actualites-rss.js');
    const stats = await runIngestActualitesRss({ limit: 10, runId: 'run-2' });

    expect(stats.created).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.processed).toBe(2);

    // Total db.insert calls: 2 for sources + 2 for SourceDocument + 2 for Actualite = 6
    expect(typedDb.insert).toHaveBeenCalledTimes(6);
  });
});
