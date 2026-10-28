import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolveAssistantTerritory } from '../../api/lib/geography/AssistantTerritoryResolver.js';

let connection;
let database;
let caseOpen = false;
let serial = 0;

function checkedTestUrl() {
  const raw = process.env.WS4_TERRITORY_SQL_TEST_URL || process.env.DATABASE_URL_TEST;
  if (!raw) throw new Error('LOCAL_TEST_DATABASE_REQUIRED_NO_SKIP');
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.search || url.hash || !/^[A-Za-z0-9_]+$/.test(name)
      || !/(^|_)test(_|$)/.test(name)) throw new Error('UNSAFE_TEST_DATABASE_REFUSED');
  return { raw, name };
}

async function territory(id, type, code, status = 'CURRENT') {
  await connection.query(`INSERT INTO pg_temp."Territory"
    (id, authority, type, official_code, status, created_at, updated_at)
    VALUES ($1, 'INSEE', $2, $3, $4, NOW(), NOW())`, [id, type, code, status]);
}

async function label(territoryId, name, options = {}) {
  serial += 1;
  await connection.query(`INSERT INTO pg_temp."TerritoryLabelHistory"
    (id, territory_id, name, valid_from, valid_to, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())`, [
    `label-${serial}`, territoryId, name, options.validFrom || null, options.validTo || null,
  ]);
}

async function relation(sourceId, targetId, options = {}) {
  serial += 1;
  await connection.query(`INSERT INTO pg_temp."TerritoryRelation"
    (id, source_territory_id, target_territory_id, type, valid_from, valid_to, created_at)
    VALUES ($1, $2, $3, 'PART_OF', $4, $5, NOW())`, [
    `rel-${serial}`, sourceId, targetId, options.validFrom || null, options.validTo || null,
  ]);
}

beforeAll(async () => {
  const { raw, name } = checkedTestUrl();
  connection = new pg.Client({ connectionString: raw, ssl: false, connectionTimeoutMillis: 5000 });
  await connection.connect();
  const current = await connection.query('SELECT current_database() AS name');
  expect(current.rows[0].name).toBe(name);
  await connection.query('BEGIN');
  await connection.query("SET LOCAL statement_timeout = '8s'");
  await connection.query('CREATE TEMP TABLE "Territory" (LIKE public."Territory" INCLUDING DEFAULTS) ON COMMIT DROP');
  await connection.query('CREATE TEMP TABLE "TerritoryLabelHistory" (LIKE public."TerritoryLabelHistory" INCLUDING DEFAULTS) ON COMMIT DROP');
  await connection.query('CREATE TEMP TABLE "TerritoryRelation" (LIKE public."TerritoryRelation" INCLUDING DEFAULTS) ON COMMIT DROP');
  await connection.query('SET LOCAL search_path = pg_temp, public');
  database = drizzle(connection);
}, 30000);

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_NETWORK_IN_TERRITORY_RESOLVER'); }));
  await connection.query('SAVEPOINT ws4_territory_case');
  caseOpen = true;
});

afterEach(async () => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (caseOpen) {
      await connection.query('ROLLBACK TO SAVEPOINT ws4_territory_case');
      await connection.query('RELEASE SAVEPOINT ws4_territory_case');
      caseOpen = false;
    }
  }
});

afterAll(async () => {
  if (connection) {
    try { await connection.query('ROLLBACK'); } finally { await connection.end(); }
  }
});

describe('WS4 AssistantTerritoryResolver on synthetic temporary rows', () => {
  it('resolves an active label and returns the narrowest-first canonical hierarchy', async () => {
    await territory('commune-strasbourg', 'COMMUNE', '67482');
    await label('commune-strasbourg', 'Strasbourg');
    await territory('department-67', 'DEPARTEMENT', '67');
    await label('department-67', 'Bas-Rhin');
    await territory('region-44', 'REGION', '44');
    await label('region-44', 'Grand Est');
    await relation('commune-strasbourg', 'department-67');
    await relation('department-67', 'region-44');

    const result = await resolveAssistantTerritory({ rawTerritory: 'Strasbourg' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.territory.id).toBe('commune-strasbourg');
    expect(result.territory.territoryIds).toEqual(['commune-strasbourg', 'department-67', 'region-44']);
    expect(result.territory.communeCode).toBe('67482');
    expect(result.territory.departmentCode).toBe('67');
    expect(result.territory.regionCode).toBe('44');
  });

  it('resolves an exact current official code', async () => {
    await territory('commune-code', 'COMMUNE', '67482');
    await label('commune-code', 'Strasbourg');
    const result = await resolveAssistantTerritory({ rawTerritory: '67482' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.matchedBy).toBe('SUPPLIED_TERRITORY');
    expect(result.territory.id).toBe('commune-code');
  });

  it('resolves an exact current canonical id', async () => {
    await territory('canonical-id', 'COMMUNE', '67482');
    const result = await resolveAssistantTerritory({ rawTerritory: 'canonical-id' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.territory.id).toBe('canonical-id');
  });

  it('gives an exact canonical id precedence over a colliding active label', async () => {
    await territory('canonical-priority', 'COMMUNE', '11111');
    await territory('other-territory', 'COMMUNE', '22222');
    await label('other-territory', 'canonical-priority');
    const result = await resolveAssistantTerritory({ rawTerritory: 'canonical-priority' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.territory.id).toBe('canonical-priority');
  });

  it('can detect one active territory label in the citizen message when no context is supplied', async () => {
    await territory('message-strasbourg', 'COMMUNE', '67482');
    await label('message-strasbourg', 'Strasbourg');
    const result = await resolveAssistantTerritory({ message: 'Quelles aides logement à Strasbourg ?' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.matchedBy).toBe('MESSAGE_LABEL');
    expect(result.territory.id).toBe('message-strasbourg');
  });

  it('fails closed when the supplied label is ambiguous', async () => {
    await territory('same-name-a', 'COMMUNE', '10001');
    await territory('same-name-b', 'COMMUNE', '20002');
    await label('same-name-a', 'Saint-Test');
    await label('same-name-b', 'Saint-Test');
    const result = await resolveAssistantTerritory({ rawTerritory: 'Saint-Test' }, database);
    expect(result).toEqual({ status: 'AMBIGUOUS' });
  });

  it('fails closed for a historical-only territory', async () => {
    await territory('old-commune', 'COMMUNE', '99999', 'HISTORICAL');
    await label('old-commune', 'Ancienne Commune');
    const result = await resolveAssistantTerritory({ rawTerritory: 'Ancienne Commune' }, database);
    expect(result).toEqual({ status: 'HISTORICAL_ONLY' });
  });

  it('fails closed for an unknown territory without using a network fallback', async () => {
    const result = await resolveAssistantTerritory({ rawTerritory: 'Territoire Inconnu' }, database);
    expect(result).toEqual({ status: 'UNRESOLVED' });
  });

  it('ignores expired labels', async () => {
    await territory('expired-label', 'COMMUNE', '30003');
    await label('expired-label', 'Ancien Nom', { validTo: '2000-01-01T00:00:00Z' });
    const result = await resolveAssistantTerritory({ rawTerritory: 'Ancien Nom' }, database);
    expect(result).toEqual({ status: 'UNRESOLVED' });
  });

  it('bounds relation cycles and returns each canonical territory once', async () => {
    await territory('cycle-a', 'COMMUNE', '40004');
    await territory('cycle-b', 'DEPARTEMENT', '40');
    await relation('cycle-a', 'cycle-b');
    await relation('cycle-b', 'cycle-a');
    const result = await resolveAssistantTerritory({ rawTerritory: 'cycle-a' }, database);
    expect(result.status).toBe('RESOLVED');
    expect(result.territory.territoryIds).toEqual(['cycle-a', 'cycle-b']);
  });
});
