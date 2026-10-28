import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

// Real shared retrieval and real Drizzle/Postgres; only the DB singleton is
// rebound to this connection. No model, remote service or live catalog fixture.
const bridge = vi.hoisted(() => ({ execute: null }));
vi.mock('../../src/db/index.js', () => ({
  db: { execute: (query) => {
    if (!bridge.execute) throw new Error('WS4_SQL_TEST_CONNECTION_NOT_READY');
    return bridge.execute(query);
  } },
}));

const MODEL = 'nomic-embed-text';
const WHEN = '2026-01-02T03:04:05.000Z';
const LOCAL = 'ws4-synthetic-commune-id';
const PARENT = 'ws4-synthetic-department-id';
const WORD = 'ws4synthetic';
const vec = (axis = 0) => Array.from({ length: 768 }, (_, i) => i === axis ? 1 : 0);
let connection;
let search;
let caseOpen = false;
let statements = [];

function checkedTestUrl() {
  const raw = process.env.WS4_HYBRID_SQL_TEST_URL || process.env.DATABASE_URL_TEST;
  if (!raw) throw new Error('LOCAL_TEST_DATABASE_REQUIRED_NO_SKIP');
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.search || url.hash || !/^[A-Za-z0-9_]+$/.test(name)
      || !/(^|_)test(_|$)/.test(name)) throw new Error('UNSAFE_TEST_DATABASE_REFUSED');
  return { raw, name };
}

async function addAide(id, options = {}) {
  const v = options.embedding === null ? null : `[${(options.embedding || vec()).join(',')}]`;
  const source = options.sourceUrl === undefined ? 'https://example.test/synthetic/' + id : options.sourceUrl;
  const exact = options.sourceUrlExact === undefined ? null : options.sourceUrlExact;
  const date = options.verifiedAt === undefined ? WHEN : options.verifiedAt;
  await connection.query(`INSERT INTO pg_temp."Aide"
    (id,slug,titre,title,description,cest_quoi,summary_falc,"status_code",statut,"category_code",
     source_url,source_url_exact,date_verification,embedding,embedding_model,geo_scope,"updatedAt")
    VALUES ($1,$1,$2,$3,$4,$4,$4,$5,$6,'AUTRE',$7,$8,$9,$10::vector,$11,$12,$13)`,
  [id, options.titre || WORD + ' synthetic title', options.title === undefined ? WORD + ' synthetic title' : options.title,
    options.description || 'Synthetic unpublished fixture only.', options.status || 'PUBLISHED',
    options.statut || 'publie', source, exact, date, v, options.model || MODEL, options.geoScope || 'NATIONAL', WHEN]);
}
async function rule(id, territory, excluded) {
  await connection.query(`INSERT INTO pg_temp."Applicability"
    (id,entity_type,entity_id,territory_id,is_exclusion)
    VALUES ($1,'BENEFIT',$2,$3,$4)`, [id + '-' + territory + '-' + excluded, id, territory, excluded]);
}
function ask(overrides = {}) {
  return search({ query: WORD, limit: 5, embedding: vec(), embeddingModel: MODEL,
    territoryFilter: { userTerritoryIds: [LOCAL, PARENT] }, ...overrides });
}
const ids = (result) => result.items.map((item) => item.id);

beforeAll(async () => {
  const { raw, name } = checkedTestUrl();
  connection = new pg.Client({ connectionString: raw, ssl: false, connectionTimeoutMillis: 5000 });
  await connection.connect();
  const db = await connection.query('SELECT current_database() AS name');
  expect(db.rows[0].name).toBe(name);
  await connection.query('BEGIN');
  await connection.query("SET LOCAL statement_timeout = '8s'");
  // LIKE keeps the real captured schema's types, defaults and NOT NULL rules.
  // Data stays in connection-private temporary tables and is rolled back.
  await connection.query('CREATE TEMP TABLE "Aide" (LIKE public."Aide" INCLUDING DEFAULTS) ON COMMIT DROP');
  await connection.query('CREATE TEMP TABLE "Applicability" (LIKE public."Applicability" INCLUDING DEFAULTS) ON COMMIT DROP');
  await connection.query('SET LOCAL search_path = pg_temp, public');
  const binding = await connection.query(`SELECT to_regclass('"Aide"') = to_regclass('pg_temp."Aide"') AS aide,
    to_regclass('"Applicability"') = to_regclass('pg_temp."Applicability"') AS applicability`);
  expect(binding.rows[0]).toEqual({ aide: true, applicability: true });
  const database = drizzle(connection, { logger: { logQuery: (query, params) => statements.push({ query, params }) } });
  bridge.execute = (query) => database.execute(query);
}, 30000);

beforeEach(async () => {
  vi.resetModules();
  statements = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_NETWORK_IN_SQL_FIXTURE'); }));
  await connection.query('SAVEPOINT ws4_case');
  caseOpen = true;
  ({ searchAidesHybrid: search } = await import('../../api/lib/hybrid-search.js'));
});
afterEach(async () => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (caseOpen) {
      await connection.query('ROLLBACK TO SAVEPOINT ws4_case');
      await connection.query('RELEASE SAVEPOINT ws4_case');
      caseOpen = false;
    }
  }
});
afterAll(async () => {
  bridge.execute = null;
  if (connection) {
    try { await connection.query('ROLLBACK'); } finally { await connection.end(); }
  }
});

describe('WS4 shared hybrid SQL on synthetic temporary rows', () => {
  it('executes both ranking CTEs with the appended territory predicate', async () => {
    await addAide('ws4-matching');
    await rule('ws4-matching', LOCAL, false);
    const result = await ask();
    expect(ids(result)).toEqual(['ws4-matching']);
    expect(result.items[0].lexicalScore).toBeGreaterThan(0);
    expect(result.items[0].semanticScore).toBeCloseTo(1, 7);
    const executed = statements.find((entry) => entry.query.includes('FULL OUTER JOIN'));
    expect(executed).toBeDefined();
    expect((executed.query.match(/AND\s*\(\s*NOT EXISTS/g) || []).length).toBe(2);
  });

  it('rejects the old missing-AND mutation as real invalid SQL', async () => {
    await addAide('ws4-syntax-witness');
    await ask();
    const executed = statements.find((entry) => entry.query.includes('FULL OUTER JOIN'));
    const broken = executed.query.replace(/AND\s*\(\s*NOT EXISTS/, '( NOT EXISTS');
    expect(broken).not.toBe(executed.query);
    await connection.query('SAVEPOINT ws4_expected_sql_fault');
    try {
      await expect(connection.query(broken, executed.params)).rejects.toHaveProperty('code', '42601');
    } finally {
      await connection.query('ROLLBACK TO SAVEPOINT ws4_expected_sql_fault');
      await connection.query('RELEASE SAVEPOINT ws4_expected_sql_fault');
    }
  });

  it('preserves exact stored provenance and the title alias for chat normalization', async () => {
    await addAide('ws4-provenance', { sourceUrlExact: 'https://example.test/exact-original' });
    const item = (await ask()).items[0];
    expect(item.title).toBe(WORD + ' synthetic title');
    expect(item.titre).toBe(item.title);
    expect(item.source_url).toBe('https://example.test/synthetic/ws4-provenance');
    expect(item.source_url_exact).toBe('https://example.test/exact-original');
    expect(new Date(item.date_verification).toISOString()).toBe(WHEN);
    expect(item).not.toHaveProperty('verified');
  });

  it('does not manufacture missing provenance or a verification date', async () => {
    await addAide('ws4-no-provenance', { sourceUrl: null, sourceUrlExact: null, verifiedAt: null });
    const item = (await ask()).items[0];
    expect(item.source_url).toBeNull();
    expect(item.source_url_exact).toBeNull();
    expect(item.date_verification).toBeNull();
  });

  it('preserves source_url_exact when source_url is absent', async () => {
    await addAide('ws4-exact-only', { sourceUrl: null, sourceUrlExact: 'https://example.test/exact-only' });
    const item = (await ask()).items[0];
    expect(item.source_url).toBeNull();
    expect(item.source_url_exact).toBe('https://example.test/exact-only');
  });

  it('makes same-depth exclusion win over inclusion', async () => {
    await addAide('ws4-same-depth');
    await rule('ws4-same-depth', LOCAL, false);
    await rule('ws4-same-depth', LOCAL, true);
    expect(ids(await ask())).toEqual([]);
  });

  it('retains the established narrowest-depth precedence', async () => {
    await addAide('ws4-narrow-include');
    await rule('ws4-narrow-include', LOCAL, false);
    await rule('ws4-narrow-include', PARENT, true);
    expect(ids(await ask())).toEqual(['ws4-narrow-include']);
  });

  it('rejects an explicit narrower exclusion and unrelated territory rules', async () => {
    await addAide('ws4-excluded');
    await rule('ws4-excluded', PARENT, false);
    await rule('ws4-excluded', LOCAL, true);
    await addAide('ws4-unrelated');
    await rule('ws4-unrelated', 'ws4-other-commune', false);
    expect(ids(await ask())).toEqual([]);
  });

  it('applies the territorial filter before the candidate limit', async () => {
    for (let i = 0; i < 30; i += 1) {
      const id = 'ws4-000-excluded-' + String(i).padStart(2, '0');
      await addAide(id);
      await rule(id, LOCAL, true);
    }
    await addAide('ws4-zzz-allowed', { embedding: vec(1) });
    await rule('ws4-zzz-allowed', LOCAL, false);
    expect(ids(await ask({ limit: 1 }))).toEqual(['ws4-zzz-allowed']);
  });

  it('executes semantic-only retrieval with the exact model filter', async () => {
    await addAide('ws4-vector-match');
    await addAide('ws4-wrong-model', { model: 'SYNTHETIC_OTHER_MODEL' });
    const result = await ask({ query: 'wordnotpresentinanyfixture' });
    expect(ids(result)).toEqual(['ws4-vector-match']);
    expect(result.items[0].lexicalScore).toBeNull();
    expect(result.items[0].semanticScore).toBeCloseTo(1, 7);
  });

  it('keeps the existing lexical-only path available to other callers', async () => {
    await addAide('ws4-lexical', { embedding: null });
    const result = await ask({ embedding: null, embeddingModel: null, territoryFilter: null });
    expect(ids(result)).toEqual(['ws4-lexical']);
    expect(result.items[0].lexicalScore).toBeGreaterThan(0);
    expect(result.items[0].semanticScore).toBeNull();
  });

  it('keeps publication and explicit geoScope filters intact', async () => {
    await addAide('ws4-kept');
    await addAide('ws4-archived', { status: 'ARCHIVED' });
    await addAide('ws4-other-scope', { geoScope: 'REGIONAL' });
    expect(ids(await ask({ geoScope: 'NATIONAL' }))).toEqual(['ws4-kept']);
  });

  it('also composes the territory filter in the full-text branch', async () => {
    await connection.query('ALTER TABLE pg_temp."Aide" ADD COLUMN ts_content tsvector, ADD COLUMN search_vector tsvector');
    await addAide('ws4-fts');
    await rule('ws4-fts', LOCAL, false);
    await connection.query("UPDATE pg_temp.\"Aide\" SET ts_content=to_tsvector('french', title), search_vector=to_tsvector('french', description)");
    const result = await ask();
    expect(ids(result)).toEqual(['ws4-fts']);
    expect(result.items[0].lexicalScore).toBeGreaterThan(0);
    expect(statements.some((entry) => entry.query.includes('ts_rank_cd'))).toBe(true);
  });

  it('keeps adversarial territory strings parameterized', async () => {
    const hostile = "ws4-territory'); DROP TABLE \"Aide\"; --";
    await addAide('ws4-unmatched-rule');
    await rule('ws4-unmatched-rule', LOCAL, false);
    expect(ids(await ask({ territoryFilter: { userTerritoryIds: [hostile] } }))).toEqual([]);
    const executed = statements.find((entry) => entry.query.includes('FULL OUTER JOIN'));
    expect(executed.query).not.toContain(hostile);
    expect(executed.params).toContain(hostile);
    const count = await connection.query('SELECT count(*)::int AS n FROM pg_temp."Aide"');
    expect(count.rows[0].n).toBe(1);
  });
});
