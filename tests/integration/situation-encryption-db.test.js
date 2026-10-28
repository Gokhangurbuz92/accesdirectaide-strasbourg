/**
 * Launch-readiness item 60 (DPIA A2) on REAL PostgreSQL — the answers of a shared dossier (SharedDiagnostic.situation) are encrypted at rest through the column
 * type (src/db/sealed-json.ts), with the byte-pinned share/create.js and share/get.js untouched:
 *  - what the database holds is { enc: "v2:…" } — the answers never appear in it;
 *  - the pinned handlers write and read the plain answers as before;
 *  - a dossier stored in clear before stays readable, and the sealing job encrypts it (dry run first);
 *  - the key rotation sees the encrypted column (nothing left on an old key here).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ANSWER = `PLANTED-ANSWER-${TS}`;
const LEGACY = `sit-legacy-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; } });

describe.skipIf(!hasDatabase)('shared dossier answers encrypted at rest (real DB)', () => {
  let db, schema, isSealedJson, rot; let created = null;
  const raw = async (id) => (await db.execute(sql`SELECT situation FROM "SharedDiagnostic" WHERE id = ${id}`)).rows[0]?.situation;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    ({ isSealedJson } = await import('../../src/db/sealed-json.js'));
    rot = await import('../../api/_services/key-rotation.js');
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const ids = [LEGACY, created?.shareId].filter(Boolean);
    for (const id of ids) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`).catch(() => {});
  });

  it('the pinned create / get handlers keep working; the database holds only the envelope', async () => {
    const create = (await import('../../api/_handlers/share/create.js')).default;
    const r = mk();
    await create({ method: 'POST', url: '/api/share/create', query: {}, headers: { host: 'localhost' }, body: { situation: { foyer: 'seul', revenus: ANSWER }, results: { assessment: { items: [] } } } }, r);
    expect(r.statusCode).toBe(200);
    created = r.body;
    const stored = await raw(created.shareId);
    expect(isSealedJson(stored)).toBe(true);
    expect(stored.enc).toMatch(/^v2:[0-9a-f]{8}:d:/);
    expect(JSON.stringify(stored)).not.toContain(ANSWER);
    const capability = decodeURIComponent(String(created.shareUrl).split('#capability=')[1]);
    const get = (await import('../../api/_handlers/share/get.js')).default;
    const g = mk();
    await get({ method: 'POST', url: '/api/share/get', query: {}, headers: { host: 'localhost' }, body: { id: created.shareId, capability } }, g);
    expect(g.statusCode).toBe(200);
    expect(JSON.stringify(g.body)).toContain(ANSWER);
    const row = await db.query.SharedDiagnostic.findFirst({ where: (t, { eq }) => eq(t.id, created.shareId) });
    expect(row.situation).toEqual({ foyer: 'seul', revenus: ANSWER });
  });

  it('a dossier stored in clear stays readable; the sealing job encrypts it, dry run first', async () => {
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${LEGACY}, NOW() + interval '1 day', ${JSON.stringify({ ancien: ANSWER })}::jsonb, '{}'::jsonb, 0)`);
    expect((await db.query.SharedDiagnostic.findFirst({ where: (t, { eq }) => eq(t.id, LEGACY) })).situation).toEqual({ ancien: ANSWER });
    expect(await rot.sealPlainSituations({ idPrefix: LEGACY })).toMatchObject({ apply: false, plain: 1, sealed: 0, failed: 0 });
    expect(JSON.stringify(await raw(LEGACY))).toContain(ANSWER);   // the dry run wrote nothing
    expect(await rot.sealPlainSituations({ idPrefix: LEGACY, apply: true })).toMatchObject({ plain: 1, sealed: 1, failed: 0 });
    const stored = await raw(LEGACY);
    expect(isSealedJson(stored)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(ANSWER);
    expect((await db.query.SharedDiagnostic.findFirst({ where: (t, { eq }) => eq(t.id, LEGACY) })).situation).toEqual({ ancien: ANSWER });
  });

  it('the key rotation covers the encrypted column', async () => {
    const st = await rot.rotationStatus();
    expect(st.byKind['SharedDiagnostic.situation']?.needing || 0).toBe(0);
    expect(schema.SharedDiagnostic.situation).toBeTruthy();
  });
});
