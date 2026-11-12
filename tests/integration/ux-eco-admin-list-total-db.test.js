/**
 * UX ecosystem (2026-11-12) on REAL PostgreSQL — the administration catalogue list stops at 500 records: it now returns how many match (total), counts every
 * verification status over the whole catalogue (the screen counted only the first 500) and filters by status on the server, with the same rule as the screen
 * (a hold first — EDIT for a change after a verification or a source update, else a person's DECISION —, then VERIFIED / REJECTED / never).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const T = `UX liste ${TS}`;

describe.skipIf(!hasDatabase)('admin catalogue list: total, status counts and server filter (real DB)', () => {
  let db, content, edit;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    content = await import('../../api/_services/admin-content.js'); edit = await import('../../api/_services/content-versions.js');
    const rows = [['v1', 'VERIFIED', null], ['v2', 'VERIFIED', null], ['r1', 'REJECTED', null], ['n1', 'UNVERIFIED', null],
      ['h1', 'UNVERIFIED', 'Montant à confirmer (QA)'], ['e1', 'VERIFIED', `${edit.EDIT_HOLD_PREFIX} (titre) : à revérifier`], ['s1', 'VERIFIED', `${edit.SOURCE_UPDATE_HOLD_PREFIX} : à revérifier`]];
    for (const [k, vs, hold] of rows) {
      await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, data_origin, cest_quoi, verification_status, publication_hold, "updatedAt")
        VALUES (${`ux-${TS}-${k}`}, ${`ux-${TS}-${k}`}, ${`${T} ${k}`}, 'publie', 'official', 'QA', ${vs}, ${hold}, NOW())`);
    }
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`ux-${TS}-%`}`).catch(() => {}); });

  it('counts every status of the matching records and says how many match', async () => {
    const r = await content.listContent('aide', { q: T }, db);
    expect(r.total).toBe(7); expect(r.limit).toBe(500); expect(r.items).toHaveLength(7);
    expect(r.counts).toEqual({ verified: 2, rejected: 1, never: 1, hold: 1, edit: 2 });
  });

  it('filters by status on the server with the screen’s rule; counts stay those of the whole search', async () => {
    const edits = await content.listContent('aide', { q: T, status: 'edit' }, db);
    expect(edits.total).toBe(2); expect(edits.items.map((x) => x.holdKind)).toEqual(['EDIT', 'EDIT']);
    expect(edits.counts.verified).toBe(2);
    const hold = await content.listContent('aide', { q: T, status: 'hold' }, db);
    expect(hold.items.map((x) => x.id)).toEqual([`ux-${TS}-h1`]); expect(hold.items[0].holdKind).toBe('DECISION');
    const unknown = await content.listContent('aide', { q: T, status: 'nonsense' }, db);
    expect(unknown.total).toBe(7);
  });

  it('a kind without a verification register (guides) has a total and no status counts', async () => {
    const g = await content.listContent('guide', { q: `${T}-none` }, db);
    expect(g.total).toBe(0); expect(g.counts).toBeUndefined();
  });
});

describe.skipIf(!hasDatabase)('organisations: decision filter with the « À traiter » predicates, and the total (real DB)', () => {
  let db, orgs, tasks;
  const O = `UX org ${TS}`;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    orgs = await import('../../api/_services/org-lifecycle.js'); tasks = await import('../../api/_services/admin-tasks.js');
    for (const [k, vs, hold, statut] of [['n', 'UNVERIFIED', null, 'actif'], ['h', 'UNVERIFIED', 'à confirmer (QA)', 'actif'], ['r', 'REJECTED', null, 'actif'], ['v', 'VERIFIED', null, 'actif'], ['a', 'UNVERIFIED', null, 'archive']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, ville, statut, verification_status, publication_hold, services, publics_accueillis, categories_aidees, data_origin, "updatedAt", "createdAt")
        VALUES (${`uxo-${TS}-${k}`}, ${`${O} ${k}`}, ${`uxo-${TS}-${k}`}, 'Strasbourg', ${statut}, ${vs}, ${hold}, '{}', '{}', '{}', 'official', NOW(), NOW())`);
    }
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`uxo-${TS}-%`}`).catch(() => {}); });

  it('each decision returns the records the dashboard counts; archived records are out of a decision filter; total and limit are given', async () => {
    const ids = async (decision) => (await orgs.listOrganizations({ q: O, decision }, db)).organizations.map((o) => o.id.split('-').pop()).sort();
    expect(await ids('never')).toEqual(['n']); expect(await ids('hold')).toEqual(['h']);
    expect(await ids('rejected')).toEqual(['r']); expect(await ids('verified')).toEqual(['v']);
    const all = await orgs.listOrganizations({ q: O }, db);
    expect(all.total).toBe(5); expect(all.limit).toBe(200);
    // the predicates are the dashboard's: the global « sans décision » count equals the global never-filter total
    const t = await tasks.adminTasks({ db });
    expect((await orgs.listOrganizations({ decision: 'never' }, db)).total).toBe(t.organizations.never);
    expect((await orgs.listOrganizations({ decision: 'hold' }, db)).total).toBe(t.organizations.onHold);
  });
});
